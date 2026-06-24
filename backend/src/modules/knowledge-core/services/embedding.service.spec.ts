import { describe, expect, it, vi } from 'vitest';

import type { ExtractedBlock } from './block-extraction.service';
import { KnowledgeEmbeddingService } from './embedding.service';

function buildBlock(overrides: Partial<ExtractedBlock> = {}): ExtractedBlock {
  return {
    name: 'Блок',
    criticalQuestion: 'Что?',
    trustedAnswer: 'Ответ',
    signalType: 'fact',
    tags: [],
    confidence: 0.9,
    evidenceQuote: 'цитата',
    evidenceStartMs: 0,
    evidenceEndMs: 1000,
    mentionedEntities: [],
    role_relevant: false,
    ...overrides,
  } as ExtractedBlock;
}

function build(): {
  service: KnowledgeEmbeddingService;
  embed: ReturnType<typeof vi.fn>;
} {
  const embed = vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]));
  const fallback = { embed };
  const service = new KnowledgeEmbeddingService(fallback as never);
  return { service, embed };
}

describe('KnowledgeEmbeddingService.embedBlocks', () => {
  it('contextHeader непустой → каждый text начинается с header', async () => {
    const { service, embed } = build();
    const blocks = [
      buildBlock({ criticalQuestion: 'Q1', trustedAnswer: 'A1' }),
      buildBlock({ criticalQuestion: 'Q2', trustedAnswer: 'A2' }),
    ];
    await service.embedBlocks(blocks, 'Контекст: встреча «X»');
    const passedTexts = embed.mock.calls[0]![0] as string[];
    expect(passedTexts).toHaveLength(2);
    for (const t of passedTexts) {
      expect(t.startsWith('Контекст: встреча «X»\n')).toBe(true);
    }
    expect(passedTexts[0]).toBe('Контекст: встреча «X»\nQ1 A1');
  });

  it('без contextHeader → старое поведение «question answer»', async () => {
    const { service, embed } = build();
    await service.embedBlocks([buildBlock({ criticalQuestion: 'Q1', trustedAnswer: 'A1' })]);
    const passedTexts = embed.mock.calls[0]![0] as string[];
    expect(passedTexts[0]).toBe('Q1 A1');
  });

  it('пустой массив блоков → embed не зовётся', async () => {
    const { service, embed } = build();
    const out = await service.embedBlocks([]);
    expect(out).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
  });
});
