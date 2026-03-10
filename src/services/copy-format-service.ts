import type { RuntimeAPI } from './shared-types.js';

export type CopyFormatTarget = 'title';
export type CopyFormatPatternType = 'simple' | 'regex';

export interface RewriteTitleInput {
  title: string;
  format: string;
  url: string;
}

export interface CopyFormatTitleRewriter {
  rewriteTitle: (input: RewriteTitleInput) => Promise<string>;
}

interface CopyFormatRule {
  id: string;
  enabled: boolean;
  target: CopyFormatTarget;
  formats: string[] | null;
  hosts: string[] | null;
  patternType: CopyFormatPatternType;
  oldText: string;
  newText: string;
  flags: string;
  stopAfterMatch: boolean;
}

interface CopyFormatConfig {
  version: number;
  rules: CopyFormatRule[];
}

interface CompiledCopyFormatRule {
  id: string;
  target: CopyFormatTarget;
  formats: Set<string> | null;
  hosts: string[] | null;
  regex: RegExp;
  newText: string;
  stopAfterMatch: boolean;
}

type CopyFormatLoader = () => Promise<unknown>;
type FetchLike = (input: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const EMPTY_CONFIG: CopyFormatConfig = {
  version: 1,
  rules: [],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

interface ParsedOptionalStringArray {
  value: string[] | null;
  valid: boolean;
}

function parseOptionalStringArray(value: unknown): ParsedOptionalStringArray {
  if (value === undefined) {
    return { value: null, valid: true };
  }
  if (!Array.isArray(value)) {
    return { value: null, valid: false };
  }

  if (!value.every(item => typeof item === 'string')) {
    return { value: null, valid: false };
  }

  const normalized = value
    .map(item => item as string)
    .map(item => item.trim())
    .filter(item => item.length > 0);

  return {
    value: normalized.length > 0 ? normalized : null,
    valid: true,
  };
}

function normalizeHostPattern(value: string): string | null {
  const hostOrUrl = value.trim().toLowerCase();
  if (hostOrUrl.length === 0) {
    return null;
  }

  if (hostOrUrl.includes('://')) {
    try {
      return new URL(hostOrUrl).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  return hostOrUrl.replace(/\.+$/, '');
}

function parseConfig(rawConfig: unknown): CopyFormatConfig {
  if (!isObject(rawConfig)) {
    return EMPTY_CONFIG;
  }

  const version = typeof rawConfig.version === 'number' ? rawConfig.version : 1;
  const rawRules = Array.isArray(rawConfig.rules) ? rawConfig.rules : [];

  const rules: CopyFormatRule[] = rawRules
    .filter(isObject)
    .map((rule): CopyFormatRule | null => {
      const id = typeof rule.id === 'string' ? rule.id : '';
      const target = rule.target === 'title' ? 'title' : null;
      const oldText = typeof rule.oldText === 'string' ? rule.oldText : '';
      const newText = typeof rule.newText === 'string' ? rule.newText : '';
      const flags = typeof rule.flags === 'string' ? rule.flags : '';
      const enabled = typeof rule.enabled === 'boolean' ? rule.enabled : true;
      const stopAfterMatch = typeof rule.stopAfterMatch === 'boolean' ? rule.stopAfterMatch : false;
      const patternType = rule.patternType === 'simple' ? 'simple' : 'regex';
      const parsedFormats = parseOptionalStringArray(rule.formats);
      const parsedHosts = parseOptionalStringArray(rule.hosts);
      const formats = parsedFormats.value;
      const hosts = parsedHosts.value;

      if (id.length === 0 || target === null || oldText.length === 0 || !parsedFormats.valid || !parsedHosts.valid) {
        console.warn(`copy-format rule '${id || '(missing id)'}' skipped: invalid schema`);
        return null;
      }

      return {
        id,
        enabled,
        target,
        formats,
        hosts,
        patternType,
        oldText,
        newText,
        flags,
        stopAfterMatch,
      };
    })
    .filter((rule): rule is CopyFormatRule => rule !== null);

  return {
    version,
    rules,
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function simplePatternToRegexSource(pattern: string): string {
  return escapeRegExp(pattern).replace(/\\\*\\\*/g, '.*?');
}

function compileRegex(rule: CopyFormatRule): RegExp | null {
  const source = rule.patternType === 'simple'
    ? simplePatternToRegexSource(rule.oldText)
    : rule.oldText;

  try {
    return new RegExp(source, rule.flags);
  } catch (error) {
    console.warn(`copy-format rule '${rule.id}' skipped: invalid regex`, error);
    return null;
  }
}

function compileRules(config: CopyFormatConfig): CompiledCopyFormatRule[] {
  return config.rules
    .filter(rule => rule.enabled)
    .map((rule): CompiledCopyFormatRule | null => {
      const regex = compileRegex(rule);
      if (regex === null) {
        return null;
      }

      const hosts = rule.hosts
        ? rule.hosts.map(normalizeHostPattern).filter((host): host is string => host !== null)
        : null;

      return {
        id: rule.id,
        target: rule.target,
        formats: rule.formats ? new Set(rule.formats) : null,
        hosts: hosts && hosts.length > 0 ? hosts : null,
        regex,
        newText: rule.newText,
        stopAfterMatch: rule.stopAfterMatch,
      };
    })
    .filter((rule): rule is CompiledCopyFormatRule => rule !== null);
}

function extractHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isHostMatched(host: string, pattern: string): boolean {
  const normalizedPattern = pattern.toLowerCase();
  if (normalizedPattern.length === 0) {
    return false;
  }

  if (normalizedPattern.startsWith('*.')) {
    const baseHost = normalizedPattern.slice(2);
    return host === baseHost || host.endsWith(`.${baseHost}`);
  }

  return host === normalizedPattern || host.endsWith(`.${normalizedPattern}`);
}

function shouldApplyRule(
  rule: CompiledCopyFormatRule,
  context: { target: CopyFormatTarget; format: string; host: string | null },
): boolean {
  if (rule.target !== context.target) {
    return false;
  }

  if (rule.formats && !rule.formats.has(context.format)) {
    return false;
  }

  if (rule.hosts) {
    if (context.host === null) {
      return false;
    }
    if (!rule.hosts.some(pattern => isHostMatched(context.host!, pattern))) {
      return false;
    }
  }

  return true;
}

async function loadConfigSafely(loader: CopyFormatLoader): Promise<CopyFormatConfig> {
  try {
    const loaded = await loader();
    return parseConfig(loaded);
  } catch (error) {
    console.warn('copy-format config load failed; using empty config', error);
    return EMPTY_CONFIG;
  }
}

export function createCopyFormatService(loader: CopyFormatLoader): CopyFormatTitleRewriter {
  let compiledRulesPromise: Promise<CompiledCopyFormatRule[]> | null = null;

  const getCompiledRules = async (): Promise<CompiledCopyFormatRule[]> => {
    if (compiledRulesPromise === null) {
      compiledRulesPromise = loadConfigSafely(loader)
        .then(compileRules)
        .catch((error) => {
          console.warn('copy-format compile failed; using empty config', error);
          return [];
        });
    }
    return compiledRulesPromise;
  };

  return {
    async rewriteTitle(input: RewriteTitleInput): Promise<string> {
      let output = input.title;
      const rules = await getCompiledRules();
      const host = extractHost(input.url);

      for (const rule of rules) {
        if (!shouldApplyRule(rule, { target: 'title', format: input.format, host })) {
          continue;
        }

        const replaced = output.replace(rule.regex, rule.newText);
        const changed = replaced !== output;
        output = replaced;

        if (changed && rule.stopAfterMatch) {
          break;
        }
      }

      return output;
    },
  };
}

export function createBrowserCopyFormatService(
  runtimeAPI: RuntimeAPI,
  fetchFn: FetchLike = url => fetch(url),
): CopyFormatTitleRewriter {
  return createCopyFormatService(async () => {
    const configUrl = runtimeAPI.getURL('dist/static/copy-format.json');
    const response = await fetchFn(configUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  });
}
