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

/**
 * Фаза 1 (meeting-identity) — сегмент несёт identity спикера
 * (participantId дорожки) для атрибуции авторства (role='subject').
 */
describe('SegmentBuilderService — speakerParticipantId (Фаза 1)', () => {
  const makeSvc = (maxTokens = 2000) =>
    new SegmentBuilderService(
      {
        knowledgeCore: { blockIngestMaxTokensPerSegment: maxTokens },
      } as unknown as ConstructorParameters<typeof SegmentBuilderService>[0],
    );

  it('turn с speakerParticipantId → сегмент несёт его', () => {
    const svc = makeSvc();
    const payload = {
      meetingId: 'm1',
      transcript: {
        turns: [
          {
            speaker: 'Алиса',
            text: 'Привет',
            startSec: 0,
            endSec: 1,
            speakerParticipantId: 'p1',
          },
        ],
      },
    };

    const segments = svc.buildSegments(payload);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.speakerParticipantId).toBe('p1');
  });

  it('turn без speakerParticipantId → сегмент speakerParticipantId == null', () => {
    const svc = makeSvc();
    const payload = {
      meetingId: 'm1',
      transcript: {
        turns: [{ speaker: 'Боб', text: 'Здравствуй', startSec: 0, endSec: 1 }],
      },
    };

    const segments = svc.buildSegments(payload);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.speakerParticipantId).toBeNull();
  });

  it('fullText/free_note сегменты — speakerParticipantId не задан (undefined)', () => {
    const svc = makeSvc();
    const segs = svc.buildSegments({ fullText: 'Текст' });
    expect(segs[0]!.speakerParticipantId).toBeUndefined();
  });
});

/**
 * Фикс cross-attribution chatbox — chatbox-payload (transcript.turns с
 * authorPersonId) строит per-message сегменты, несущие authorPersonId;
 * meeting-payload (turns без authorPersonId) — сегменты БЕЗ этого поля.
 */
describe('SegmentBuilderService — authorPersonId (chatbox per-message)', () => {
  const makeSvc = (maxTokens = 2000) =>
    new SegmentBuilderService(
      {
        knowledgeCore: { blockIngestMaxTokensPerSegment: maxTokens },
      } as unknown as ConstructorParameters<typeof SegmentBuilderService>[0],
    );

  it('chatbox turns с authorPersonId → сегменты несут его (string для менеджера, null для клиента)', () => {
    const svc = makeSvc();
    const payload = {
      kind: 'chatbox_chat_session',
      fullText: 'Клиент: вопрос\nМенеджер: ответ',
      transcript: {
        turns: [
          {
            speaker: 'Клиент [A]',
            text: 'вопрос',
            startSec: 0,
            endSec: 0.9,
            speakerParticipantId: null,
            authorPersonId: null,
          },
          {
            speaker: 'Менеджер [N]',
            text: 'ответ',
            startSec: 1,
            endSec: 1.9,
            speakerParticipantId: null,
            authorPersonId: 'p-manager',
          },
        ],
      },
    };

    const segments = svc.buildSegments(payload);

    expect(segments).toHaveLength(2);
    expect(
      Object.prototype.hasOwnProperty.call(segments[0]!, 'authorPersonId'),
    ).toBe(true);
    expect(segments[0]!.authorPersonId).toBeNull();
    expect(segments[1]!.authorPersonId).toBe('p-manager');
  });

  it('meeting turns (без authorPersonId) → сегменты БЕЗ поля authorPersonId (undefined, не null)', () => {
    const svc = makeSvc();
    const payload = {
      meetingId: 'm1',
      transcript: {
        turns: [
          {
            speaker: 'Алиса',
            text: 'Привет',
            startSec: 0,
            endSec: 1,
            speakerParticipantId: 'p1',
          },
        ],
      },
    };

    const segments = svc.buildSegments(payload);

    expect(segments).toHaveLength(1);
    // REGRESSION-GUARD: поле отсутствует у meeting-сегментов (segHasAuthor=false).
    expect(
      Object.prototype.hasOwnProperty.call(segments[0]!, 'authorPersonId'),
    ).toBe(false);
    expect(segments[0]!.authorPersonId).toBeUndefined();
  });
});
