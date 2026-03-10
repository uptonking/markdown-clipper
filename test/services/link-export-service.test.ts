import { describe, expect, it, vi } from 'vitest';
import {
  formatYearMonth,
  LinkExportService,
  renderCustomFormatLink,
  validateLinkExportOptions,
} from '../../src/services/link-export-service.js';
import type { CopyFormatTitleRewriter } from '../../src/services/copy-format-service.js';
import type {
  CustomFormat,
  CustomFormatsProvider,
  MarkdownFormatter,
} from '../../src/services/shared-types.js';

const mockMarkdown: MarkdownFormatter = {
  escapeLinkText: (text: string) => text.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]'),
  linkTo: (title: string, url: string) => `[${title}](${url})`,
  list: vi.fn().mockImplementation(() => {
    throw new Error('list() should not be called in link export tests');
  }),
  taskList: vi.fn().mockImplementation(() => {
    throw new Error('taskList() should not be called in link export tests');
  }),
};

describe('link Export Service - Pure Functions', () => {
  describe('validateLinkExportOptions', () => {
    it('should pass validation for link format', () => {
      expect(() => validateLinkExportOptions({
        format: 'link',
        title: 'Example',
        url: 'https://example.com',
      })).not.toThrow();
    });

    it('should pass validation for custom-format with slot', () => {
      expect(() => validateLinkExportOptions({
        format: 'custom-format',
        title: 'Example',
        url: 'https://example.com',
        customFormatSlot: '1',
      })).not.toThrow();
    });

    it('should pass validation for link-with-date format', () => {
      expect(() => validateLinkExportOptions({
        format: 'link-with-date',
        title: 'Example',
        url: 'https://example.com',
      })).not.toThrow();
    });

    it('should throw error when custom-format is missing customFormatSlot', () => {
      expect(() => validateLinkExportOptions({
        format: 'custom-format',
        title: 'Example',
        url: 'https://example.com',
      })).toThrow(/customFormatSlot is required/);
    });

    it('should throw error when customFormatSlot is null', () => {
      expect(() => validateLinkExportOptions({
        format: 'custom-format',
        title: 'Example',
        url: 'https://example.com',
        customFormatSlot: null,
      })).toThrow(/customFormatSlot is required/);
    });
  });

  describe('formatYearMonth', () => {
    it('formats date as YYYYMM', () => {
      expect(formatYearMonth(new Date('2026-03-10T08:09:10Z'))).toBe('202603');
    });
  });

  describe('renderCustomFormatLink', () => {
    it('should render link using custom format', async () => {
      const mockCustomFormat: CustomFormat = {
        render: vi.fn(input => `Custom: ${input.title} -> ${input.url}`),
      };

      const mockProvider: CustomFormatsProvider = {
        get: vi.fn(async () => mockCustomFormat),
      };

      const result = await renderCustomFormatLink(
        'Test [Link]',
        'https://example.com',
        '1',
        text => text.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]'),
        mockProvider,
      );

      expect(result).toBe('Custom: Test \\[Link\\] -> https://example.com');
      expect(mockProvider.get).toHaveBeenCalledWith('single-link', '1');
      expect(mockCustomFormat.render).toHaveBeenCalledWith({
        title: 'Test \\[Link\\]',
        url: 'https://example.com',
        number: 1,
      });
    });

    it('should escape link text before passing to custom format', async () => {
      const mockCustomFormat: CustomFormat = {
        render: vi.fn(input => `${input.title}`),
      };

      const mockProvider: CustomFormatsProvider = {
        get: vi.fn(async () => mockCustomFormat),
      };

      await renderCustomFormatLink(
        '[Special]',
        'https://example.com',
        '1',
        text => text.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]'),
        mockProvider,
      );

      expect(mockCustomFormat.render).toHaveBeenCalledWith({
        title: '\\[Special\\]',
        url: 'https://example.com',
        number: 1,
      });
    });
  });
});

describe('linkExportService', () => {
  describe('exportLink', () => {
    describe('markdown link format', () => {
      it('should export link in markdown format', async () => {
        const mockProvider: CustomFormatsProvider = {
          get: vi.fn().mockRejectedValue(new Error('Should not be called')),
        };

        const service = new LinkExportService(mockMarkdown, mockProvider);

        const result = await service.exportLink({
          format: 'link',
          title: 'Example',
          url: 'https://example.com',
        });

        expect(result).toBe('[Example](https://example.com)');
        expect(mockProvider.get).not.toHaveBeenCalled();
      });

      it('should not call customFormatsProvider when format is link', async () => {
        const getMock = vi.fn().mockRejectedValue(new Error('Should not be called'));

        const mockProvider: CustomFormatsProvider = {
          get: getMock,
        };

        const service = new LinkExportService(mockMarkdown, mockProvider);

        await service.exportLink({
          format: 'link',
          title: 'Test',
          url: 'https://test.com',
        });

        expect(getMock).not.toHaveBeenCalled();
      });

      it('should export link in markdown format with date', async () => {
        const mockProvider: CustomFormatsProvider = {
          get: vi.fn().mockRejectedValue(new Error('Should not be called')),
        };

        const service = new LinkExportService(
          mockMarkdown,
          mockProvider,
          () => new Date('2026-03-10T08:09:10Z'),
        );

        const result = await service.exportLink({
          format: 'link-with-date',
          title: 'Example',
          url: 'https://example.com',
        });

        expect(result).toBe('[Example _202603](https://example.com)');
        expect(mockProvider.get).not.toHaveBeenCalled();
      });

      it('should use default title when title is empty for link-with-date', async () => {
        const mockProvider: CustomFormatsProvider = {
          get: vi.fn().mockRejectedValue(new Error('Should not be called')),
        };

        const service = new LinkExportService(
          mockMarkdown,
          mockProvider,
          () => new Date('2026-03-10T08:09:10Z'),
        );

        const result = await service.exportLink({
          format: 'link-with-date',
          title: '',
          url: 'https://example.com',
        });

        expect(result).toBe('[(No Title) _202603](https://example.com)');
      });

      it('should apply rewritten title for link-with-date', async () => {
        const mockProvider: CustomFormatsProvider = {
          get: vi.fn().mockRejectedValue(new Error('Should not be called')),
        };
        const rewriteTitle = vi.fn(async () => 'QMD: Local hybrid search engine  by 95%+. | Medium');
        const rewriter: CopyFormatTitleRewriter = { rewriteTitle };

        const service = new LinkExportService(
          mockMarkdown,
          mockProvider,
          () => new Date('2026-03-10T08:09:10Z'),
          rewriter,
        );

        const result = await service.exportLink({
          format: 'link-with-date',
          title: 'QMD: Local hybrid search engine  by 95%+. | by DevSphere | Coding Nexus | Feb, 2026 | Medium',
          url: 'https://medium.com/coding-nexus/example',
        });

        expect(result).toBe('[QMD: Local hybrid search engine  by 95%+. | Medium _202603](https://medium.com/coding-nexus/example)');
        expect(rewriteTitle).toHaveBeenCalledWith({
          title: 'QMD: Local hybrid search engine  by 95%+. | by DevSphere | Coding Nexus | Feb, 2026 | Medium',
          format: 'link-with-date',
          url: 'https://medium.com/coding-nexus/example',
        });
      });
    });

    describe('custom format', () => {
      it('should export link using custom format', async () => {
        const mockCustomFormat: CustomFormat = {
          render: vi.fn(input => `Custom: ${input.title} -> ${input.url}`),
        };

        const mockProvider: CustomFormatsProvider = {
          get: vi.fn(async () => mockCustomFormat),
        };

        const service = new LinkExportService(mockMarkdown, mockProvider);

        const result = await service.exportLink({
          format: 'custom-format',
          title: 'Test [Link]',
          url: 'https://example.com',
          customFormatSlot: '1',
        });

        expect(result).toBe('Custom: Test \\[Link\\] -> https://example.com');
        expect(mockProvider.get).toHaveBeenCalledWith('single-link', '1');
        expect(mockCustomFormat.render).toHaveBeenCalledWith({
          title: 'Test \\[Link\\]',
          url: 'https://example.com',
          number: 1,
        });
      });

      it('should throw error when customFormatSlot is not provided', async () => {
        const mockProvider: CustomFormatsProvider = {
          get: vi.fn().mockRejectedValue(new Error('Should not be called')),
        };

        const service = new LinkExportService(mockMarkdown, mockProvider);

        await expect(
          service.exportLink({
            format: 'custom-format',
            title: 'Test',
            url: 'https://example.com',
          }),
        ).rejects.toThrow('customFormatSlot is required for custom-format');
      });

      it('should throw error when customFormatSlot is null', async () => {
        const mockProvider: CustomFormatsProvider = {
          get: vi.fn().mockRejectedValue(new Error('Should not be called')),
        };

        const service = new LinkExportService(mockMarkdown, mockProvider);

        await expect(
          service.exportLink({
            format: 'custom-format',
            title: 'Test',
            url: 'https://example.com',
            customFormatSlot: null,
          }),
        ).rejects.toThrow('customFormatSlot is required for custom-format');
      });
    });

    describe('invalid format', () => {
      it('should throw error for invalid format', async () => {
        const mockProvider: CustomFormatsProvider = {
          get: vi.fn().mockRejectedValue(new Error('Should not be called')),
        };

        const service = new LinkExportService(mockMarkdown, mockProvider);

        await expect(
          service.exportLink({
            format: 'invalid' as any,
            title: 'Test',
            url: 'https://example.com',
          }),
        ).rejects.toThrow('invalid format: invalid');
      });
    });
  });
});
