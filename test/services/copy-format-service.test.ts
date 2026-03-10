import { describe, expect, it, vi } from 'vitest';
import {
  createCopyFormatService,
  isHostMatched,
  simplePatternToRegexSource,
} from '../../src/services/copy-format-service.js';

describe('copy-format-service', () => {
  it('converts simple pattern wildcard to regex source', () => {
    expect(simplePatternToRegexSource('| by ** | Medium')).toBe('\\| by .*? \\| Medium');
  });

  it('matches exact and subdomain hosts', () => {
    expect(isHostMatched('medium.com', 'medium.com')).toBe(true);
    expect(isHostMatched('foo.medium.com', 'medium.com')).toBe(true);
    expect(isHostMatched('linux.do', 'medium.com')).toBe(false);
  });

  it('applies simple site-specific replacement for medium title', async () => {
    const service = createCopyFormatService(async () => ({
      version: 1,
      rules: [
        {
          id: 'medium-clean-byline',
          enabled: true,
          target: 'title',
          formats: ['link-with-date'],
          hosts: ['medium.com'],
          patternType: 'simple',
          oldText: '| by ** | Medium',
          newText: '| Medium',
          flags: 'i',
          stopAfterMatch: true,
        },
      ],
    }));

    const result = await service.rewriteTitle({
      title: 'QMD: Local hybrid search engine  by 95%+. | by DevSphere | Coding Nexus | Feb, 2026 | Medium',
      format: 'link-with-date',
      url: 'https://medium.com/coding-nexus/example',
    });

    expect(result).toBe('QMD: Local hybrid search engine  by 95%+. | Medium');
  });

  it('applies simple site-specific replacement for linux.do title', async () => {
    const service = createCopyFormatService(async () => ({
      version: 1,
      rules: [
        {
          id: 'linuxdo-clean-author',
          enabled: true,
          target: 'title',
          formats: ['link-with-date'],
          hosts: ['linux.do'],
          patternType: 'simple',
          oldText: ' - ** / ** - LINUX DO',
          newText: ' - LINUX DO',
          flags: '',
          stopAfterMatch: true,
        },
      ],
    }));

    const result = await service.rewriteTitle({
      title: '白嫖DO服务器自建稳定节点 - 搞七捻三 / 搞七捻三, Lv1 - LINUX DO',
      format: 'link-with-date',
      url: 'https://linux.do/t/topic/1715886',
    });

    expect(result).toBe('白嫖DO服务器自建稳定节点 - LINUX DO');
  });

  it('does not apply when format does not match', async () => {
    const service = createCopyFormatService(async () => ({
      version: 1,
      rules: [
        {
          id: 'medium-clean-byline',
          enabled: true,
          target: 'title',
          formats: ['link-with-date'],
          hosts: ['medium.com'],
          patternType: 'simple',
          oldText: '| by ** | Medium',
          newText: '| Medium',
          flags: 'i',
          stopAfterMatch: true,
        },
      ],
    }));

    const inputTitle = 'QMD: Local hybrid search engine  by 95%+. | by DevSphere | Coding Nexus | Feb, 2026 | Medium';
    const result = await service.rewriteTitle({
      title: inputTitle,
      format: 'link',
      url: 'https://medium.com/coding-nexus/example',
    });

    expect(result).toBe(inputTitle);
  });

  it('skips invalid regex rule without failing rewrite', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = createCopyFormatService(async () => ({
      version: 1,
      rules: [
        {
          id: 'broken-regex',
          enabled: true,
          target: 'title',
          formats: ['link-with-date'],
          hosts: ['medium.com'],
          patternType: 'regex',
          oldText: '(',
          newText: '',
          flags: '',
          stopAfterMatch: true,
        },
      ],
    }));

    const inputTitle = 'Any Title';
    const result = await service.rewriteTitle({
      title: inputTitle,
      format: 'link-with-date',
      url: 'https://medium.com/coding-nexus/example',
    });

    expect(result).toBe(inputTitle);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('skips rule when formats/hosts schema is invalid', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = createCopyFormatService(async () => ({
      version: 1,
      rules: [
        {
          id: 'bad-schema',
          enabled: true,
          target: 'title',
          formats: 'link-with-date',
          hosts: 123,
          patternType: 'simple',
          oldText: '| by ** | Medium',
          newText: '| Medium',
          flags: 'i',
          stopAfterMatch: true,
        },
      ],
    }));

    const inputTitle = 'QMD: Local hybrid search engine  by 95%+. | by DevSphere | Coding Nexus | Feb, 2026 | Medium';
    const result = await service.rewriteTitle({
      title: inputTitle,
      format: 'link-with-date',
      url: 'https://medium.com/coding-nexus/example',
    });

    expect(result).toBe(inputTitle);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
