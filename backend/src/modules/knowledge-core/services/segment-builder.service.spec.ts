import { describe, expect, it } from 'vitest';

import { SegmentBuilderService } from './segment-builder.service';

/**
 * Фаза 10 (2026-06-04 razblokirovka-konveyera) — free_note распознаётся как
 * чистый текстовый сегмент, а не JSON-stringify обёртка.
 *
 * Корень: payload свободной заметки `{ kind:'free_note', userId, text, metadata }`
 * (ConversationalIngestAdapter) не имеет ни `transcript.turns`, ни `fullText`.
 * До фикса он падал в buildFallback → весь JSON попадал в Segment.text → LLM
 * в block-ingest получал шум (kind/userId/metadata). Тест фиксирует, что в
 * текст сегмента попадает только `text`.
 */
describe('SegmentBuilderService — free_note (Фаза 10)', () => {
  const makeCfg = (maxTokens = 2000) =>
    ({
      knowledgeCore: { blockIngestMaxTokensPerSegment: maxTokens },
    }) as unknown as ConstructorParameters<typeof SegmentBuilderService>[0];

  const makeSvc = (maxTokens = 2000) => new SegmentBuilderService(makeCfg(maxTokens));

  it('free_note с непустым text → ровно 1 сегмент с чистым текстом (без JSON-обёртки)', () => {
    const svc = makeSvc();
    const payload = {
      kind: 'free_note' as const,
      userId: 'u1',
      text: 'Записал мысль про X',
      metadata: {},
    };

    const segments = svc.buildSegments(payload);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe('Записал мысль про X');
    // kind/userId/metadata НЕ должны протекать в текст сегмента.
    expect(segments[0]!.text).not.toContain('free_note');
    expect(segments[0]!.text).not.toContain('userId');
    expect(segments[0]!.text).not.toContain('metadata');
    expect(segments[0]!.text).not.toContain('{');
    expect(segments[0]!.speakers).toEqual([]);
    expect(segments[0]!.startMs).toBe(0);
    expect(segments[0]!.endMs).toBe(0);
  });

  it('free_note с пустым/whitespace text → fallback (tryGetFreeNoteText вернул null)', () => {
    const svc = makeSvc();
    const payload = {
      kind: 'free_note' as const,
      userId: 'u1',
      text: '   ',
      metadata: {},
    };

    const segments = svc.buildSegments(payload);

    // Упал в buildFallback: текст — JSON-stringify обёртки, а не пустой/чистый.
    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toContain('free_note');
    expect(segments[0]!.text).toContain('userId');
  });

  it('meeting-payload (transcript.turns) → meeting-ветка, не регрессировал', () => {
    const svc = makeSvc();
    const payload = {
      meetingId: 'm1',
      transcript: {
        turns: [
          { speaker: 'Алиса', text: 'Привет', startSec: 0, endSec: 1 },
          { speaker: 'Боб', text: 'Здравствуй', startSec: 1, endSec: 2 },
        ],
      },
    };

    const segments = svc.buildSegments(payload);

    expect(segments).toHaveLength(2);
    expect(segments[0]!.text).toBe('Алиса: Привет');
    expect(segments[0]!.speakers).toEqual(['Алиса']);
    expect(segments[0]!.startMs).toBe(0);
    expect(segments[0]!.endMs).toBe(1000);
    expect(segments[1]!.text).toBe('Боб: Здравствуй');
    expect(segments[1]!.speakers).toEqual(['Боб']);
  });

  it('payload с fullText → fullText-ветка, не регрессировал', () => {
    const svc = makeSvc();
    const payload = { fullText: 'Текст задачи из трекера' };

    const segments = svc.buildSegments(payload);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe('Текст задачи из трекера');
    expect(segments[0]!.speakers).toEqual([]);
  });
});
