import { describe, expect, it } from 'vitest';

import { SegmentBuilderService } from './segment-builder.service';

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

describe('SegmentBuilderService — meeting_report (Фаза 2)', () => {
  const makeSvc = () =>
    new SegmentBuilderService({
      knowledgeCore: { blockIngestMaxTokensPerSegment: 2000 },
    } as unknown as ConstructorParameters<typeof SegmentBuilderService>[0]);

  it('reportFacts[N] + summary + chapters → N + 1 + chapters сегментов (НЕ один)', () => {
    const svc = makeSvc();
    const payload = {
      kind: 'meeting_report' as const,
      meetingId: 'm1',
      meetingType: 'team',
      reportSummaryMarkdown: 'Итоги встречи: договорились о релизе',
      chapters: [
        { title: 'Обсуждение', summary: 'Поговорили о сроках' },
        { title: 'Решения', summary: 'Приняли план' },
      ],
      reportFacts: [
        { reportKind: 'decision', text: 'Релиз 15 июня', speaker: 'Алиса' },
        { reportKind: 'blocker', text: 'Не готова инфраструктура' },
        { reportKind: 'task', text: 'Подготовить демо' },
      ],
    };

    const segments = svc.buildSegments(payload);

    expect(segments).toHaveLength(6);
    expect(segments[0]!.text).toBe('Релиз 15 июня');
    expect(segments[1]!.text).toBe('Не готова инфраструктура');
    expect(segments[2]!.text).toBe('Подготовить демо');
    expect(segments[3]!.text).toBe('Итоги встречи: договорились о релизе');
    expect(segments[4]!.text).toBe('Обсуждение: Поговорили о сроках');
    expect(segments[5]!.text).toBe('Решения: Приняли план');
    for (const s of segments) {
      expect(s.speakers).toEqual([]);
      expect(s.startMs).toBe(0);
      expect(s.endMs).toBe(0);
    }
  });

  it('chapter только с title (без summary) → сегмент = title', () => {
    const svc = makeSvc();
    const payload = {
      kind: 'meeting_report' as const,
      reportSummaryMarkdown: '',
      chapters: [{ title: 'Только заголовок', summary: '' }],
      reportFacts: [],
    };

    const segments = svc.buildSegments(payload);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe('Только заголовок');
  });

  it('пустые reportFacts + summary + chapters → 0 сегментов (не fallback на JSON)', () => {
    const svc = makeSvc();
    const payload = {
      kind: 'meeting_report' as const,
      reportSummaryMarkdown: '',
      chapters: [],
      reportFacts: [],
    };

    const segments = svc.buildSegments(payload);

    expect(segments).toHaveLength(0);
  });

  it('payload без kind=meeting_report → НЕ report-ветка (fallback)', () => {
    const svc = makeSvc();
    const payload = { kind: 'something_else', reportFacts: [{ text: 'x' }] };

    const segments = svc.buildSegments(payload);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toContain('something_else');
  });
});

describe('SegmentBuilderService — speakerParticipantId (Фаза 1)', () => {
  const makeSvc = (maxTokens = 2000) =>
    new SegmentBuilderService({
      knowledgeCore: { blockIngestMaxTokensPerSegment: maxTokens },
    } as unknown as ConstructorParameters<typeof SegmentBuilderService>[0]);

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

describe('SegmentBuilderService — authorPersonId (chatbox per-message)', () => {
  const makeSvc = (maxTokens = 2000) =>
    new SegmentBuilderService({
      knowledgeCore: { blockIngestMaxTokensPerSegment: maxTokens },
    } as unknown as ConstructorParameters<typeof SegmentBuilderService>[0]);

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
    expect(Object.prototype.hasOwnProperty.call(segments[0]!, 'authorPersonId')).toBe(true);
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
    expect(Object.prototype.hasOwnProperty.call(segments[0]!, 'authorPersonId')).toBe(false);
    expect(segments[0]!.authorPersonId).toBeUndefined();
  });
});

describe('SegmentBuilderService — notification_response (clone-method Э3.1)', () => {
  const makeSvc = () =>
    new SegmentBuilderService({
      knowledgeCore: { blockIngestMaxTokensPerSegment: 2000 },
    } as unknown as ConstructorParameters<typeof SegmentBuilderService>[0]);

  it('questionText + response.text → 1 сегмент «Вопрос Коры: …\\n\\nОтвет …» (НЕ JSON.stringify)', () => {
    const svc = makeSvc();
    const payload = {
      kind: 'notification_response' as const,
      userId: 'u1',
      respondsToNotificationId: 'notif-1',
      eventType: 'probe.question',
      questionText: 'Какие альтернативы вы рассматривали и почему отвергли?',
      response: { text: 'Рассматривал выкат в пятницу, но отказался из-за риска.' },
      signalTypeHint: 'reasoning',
    };

    const segments = svc.buildSegments(payload);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe(
      'Вопрос Коры: Какие альтернативы вы рассматривали и почему отвергли?\n\nОтвет сотрудника: Рассматривал выкат в пятницу, но отказался из-за риска.',
    );
    expect(segments[0]!.text).not.toContain('notification_response');
    expect(segments[0]!.text).not.toContain('userId');
    expect(segments[0]!.text).not.toContain('respondsToNotificationId');
    expect(segments[0]!.text).not.toContain('{');
  });

  it('без questionText → сегмент только из текста ответа', () => {
    const svc = makeSvc();
    const payload = {
      kind: 'notification_response' as const,
      userId: 'u1',
      questionText: null,
      response: { text: 'Да, всё подтверждаю.' },
    };

    const segments = svc.buildSegments(payload);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe('Да, всё подтверждаю.');
    expect(segments[0]!.text).not.toContain('Вопрос Коры');
  });

  it('каскад ключей response: answer тоже распознаётся; строковый response — как есть', () => {
    const svc = makeSvc();
    const byAnswer = svc.buildSegments({
      kind: 'notification_response' as const,
      response: { answer: 'Ответ через ключ answer' },
    });
    expect(byAnswer).toHaveLength(1);
    expect(byAnswer[0]!.text).toBe('Ответ через ключ answer');

    const byString = svc.buildSegments({
      kind: 'notification_response' as const,
      response: 'Ответ строкой',
    });
    expect(byString).toHaveLength(1);
    expect(byString[0]!.text).toBe('Ответ строкой');
  });

  it('пустой response → fallback на старое поведение (JSON.stringify)', () => {
    const svc = makeSvc();
    const payload = {
      kind: 'notification_response' as const,
      userId: 'u1',
      questionText: 'Вопрос есть, ответа нет',
      response: {},
    };

    const segments = svc.buildSegments(payload);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toContain('notification_response');
  });
});
