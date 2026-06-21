import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';

import { joinPagesWithOffsets } from './document-parser.service';

function cfg(): TypedConfigService {
  return {
    document: {
      parseTimeoutMs: 30_000,
      maxSizeMb: 50,
      maxSizeBytes: 50 * 1024 * 1024,
      inlineThresholdMb: 10,
      inlineThresholdBytes: 10 * 1024 * 1024,
      s3Bucket: 'z-documents',
    },
  } as unknown as TypedConfigService;
}

describe('joinPagesWithOffsets', () => {
  it('три страницы → склеенный текст и корректные смещения', () => {
    const { text, pageOffsets } = joinPagesWithOffsets(['aaa', 'bbb', 'cc']);
    expect(text).toBe('aaa\n\nbbb\n\ncc');
    expect(pageOffsets).toEqual([0, 5, 10]);
    expect(text.slice(pageOffsets[1])).toBe('bbb\n\ncc');
    expect(text.slice(pageOffsets[2])).toBe('cc');
  });

  it('пустой массив → пустой результат', () => {
    expect(joinPagesWithOffsets([])).toEqual({ text: '', pageOffsets: [] });
  });

  it('одна страница → один offset [0], без разделителя', () => {
    const { text, pageOffsets } = joinPagesWithOffsets(['only']);
    expect(text).toBe('only');
    expect(pageOffsets).toEqual([0]);
  });
});

describe('DocumentParserService.parsePdf (unpdf mocked)', () => {
  it('собирает pageCount / pageOffsets / text из ответа unpdf', async () => {
    const pages = ['Page one', 'Page two'];
    const extractText = vi.fn(async () => ({ totalPages: 2, text: pages }));
    const getDocumentProxy = vi.fn(async () => ({ __proxy: true }));
    const getMeta = vi.fn(async () => ({ info: { Title: 'Док', Author: 'Автор' } }));
    vi.doMock('unpdf', () => ({ extractText, getDocumentProxy, getMeta }));

    vi.resetModules();
    const { DocumentParserService: SvcMocked } = await import('./document-parser.service');
    const svc = new SvcMocked(cfg());

    const result = await svc.parse({
      kind: 'pdf',
      content: Buffer.from('%PDF-1.4 fake'),
      mimeType: 'application/pdf',
    });

    expect(result.metadata.pageCount).toBe(2);
    expect(result.metadata.pageOffsets).toEqual([0, 'Page one'.length + 2]);
    expect(result.text).toBe('Page one\n\nPage two');
    expect(result.metadata.title).toBe('Док');
    expect(result.metadata.author).toBe('Автор');
    expect(getDocumentProxy).toHaveBeenCalledTimes(1);

    vi.doUnmock('unpdf');
    vi.resetModules();
  });
});
