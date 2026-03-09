import type { CustomFormatsProvider, MarkdownFormatter } from './shared-types.js';

// Type Definitions
export type LinkExportFormat = 'link' | 'link-with-date' | 'custom-format';

export interface LinkExportOptions {
  format: LinkExportFormat;
  title: string;
  url: string;
  customFormatSlot?: string | null;
}

export function formatYearMonth(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function validateLinkExportOptions(options: LinkExportOptions): void {
  if (options.format === 'custom-format' && !options.customFormatSlot) {
    throw new TypeError('customFormatSlot is required for custom-format');
  }
}

/**
 * Renders a link using a custom format template.
 */
export async function renderCustomFormatLink(
  title: string,
  url: string,
  slot: string,
  formatTitle: (text: string) => string,
  customFormatsProvider: CustomFormatsProvider,
): Promise<string> {
  const customFormat = await customFormatsProvider.get('single-link', slot);
  const input = {
    title: formatTitle(title),
    url,
    number: 1,
  };
  return customFormat.render(input);
}

export class LinkExportService {
  constructor(
    private markdown: MarkdownFormatter,
    private customFormatsProvider: CustomFormatsProvider,
    private nowProvider: () => Date = () => new Date(),
  ) { }

  /**
   * Export a link in the specified format.
   *
   * @param options - Export options
   * @param options.format - Export format: 'link' for markdown link, 'custom-format' for custom template
   * @param options.title - Link title text
   * @param options.url - Link URL
   * @param options.customFormatSlot - Custom format slot (required when format is 'custom-format')
   * @returns Formatted link string
   * @throws {TypeError} If format is invalid or customFormatSlot is missing for custom-format
   */
  async exportLink(options: LinkExportOptions): Promise<string> {
    // Validate options
    validateLinkExportOptions(options);

    // Route to appropriate formatter
    switch (options.format) {
      case 'link':
        return this.markdown.linkTo(options.title, options.url);

      case 'link-with-date': {
        const title = options.title === '' ? '(No Title)' : this.markdown.escapeLinkText(options.title);
        const yyyymm = formatYearMonth(this.nowProvider());
        return `[${title} _${yyyymm}](${options.url})`;
      }

      case 'custom-format':
        // We already validated that customFormatSlot exists
        return renderCustomFormatLink(
          options.title,
          options.url,
          options.customFormatSlot!,
          // TODO: implement flexible title formatter.
          // See https://github.com/yorkxin/copy-as-markdown/issues/133
          text => this.markdown.escapeLinkText(text),
          this.customFormatsProvider,
        );

      default:
        throw new TypeError(`invalid format: ${options.format}`);
    }
  }
}
