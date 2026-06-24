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
      knowledgeCore: {
        blockIngestMaxTokensPerSegment: maxTokens,
        segmentMaxTokens: maxTokens,
        segmentOverlapRatio: 0,
      },
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
 * Фаза A4 (доводка провенанса) — email-payload кладёт тело письма в `fullText`
 * (subject + text). До фикса EmailFetchService писал только `text`, а
 * tryGetFullText ищет `fullText` → весь JSON письма (messageId/from/html/…)
 * уходил в buildFallback и в LLM как шум. Тест фиксирует, что в текст сегмента
 * попадает только subject+body, а служебные ключи не протекают.
 */
describe('SegmentBuilderService — email payload (Фаза A4)', () => {
  const makeSvc = (maxTokens = 2000) =>
    new SegmentBuilderService(
      {
        knowledgeCore: {
        blockIngestMaxTokensPerSegment: maxTokens,
        segmentMaxTokens: maxTokens,
        segmentOverlapRatio: 0,
      },
      } as unknown as ConstructorParameters<typeof SegmentBuilderService>[0],
    );

  it('email-payload с fullText → 1 сегмент с subject+body (без JSON-обёртки)', () => {
    const svc = makeSvc();
    const payload = {
      messageId: 'm1',
      from: { name: 'Алиса', address: 'alice@example.com' },
      to: [{ name: 'Боб', address: 'bob@example.com' }],
      cc: [],
      subject: 'Тема',
      date: '2026-06-20T00:00:00.000Z',
      folder: 'INBOX',
      text: 'Тело письма',
      fullText: 'Тема\n\nТело письма',
      html: null,
      attachments: [],
    };

    const segments = svc.buildSegments(payload);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe('Тема\n\nТело письма');
    expect(segments[0]!.text).not.toContain('messageId');
    expect(segments[0]!.text).not.toContain('{');
    expect(segments[0]!.speakers).toEqual([]);
  });
});

/**
 * Фаза 2 «отчёт встречи → граф» (ТЗ 2026-06-11-report-to-graph-phase2.md §2.1):
 * payload `{ kind:'meeting_report', reportFacts, reportSummaryMarkdown, chapters }`
 * разворачивается в ГРАНУЛЯРНЫЕ сегменты — по одному на факт/главу + один на
 * summary. Главное: НЕ один склеенный сегмент (иначе block-ingest не извлечёт
 * отдельный блок на каждый факт).
 */
describe('SegmentBuilderService — meeting_report (Фаза 2)', () => {
  const makeSvc = () =>
    new SegmentBuilderService(
      ({
        knowledgeCore: {
        blockIngestMaxTokensPerSegment: 2000,
        segmentMaxTokens: 2000,
        segmentOverlapRatio: 0,
      },
      }) as unknown as ConstructorParameters<typeof SegmentBuilderService>[0],
    );

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

    // 3 факта + 1 summary + 2 главы = 6 сегментов.
    expect(segments).toHaveLength(6);
    // По одному факту на сегмент (НЕ склеены).
    expect(segments[0]!.text).toBe('Релиз 15 июня');
    expect(segments[1]!.text).toBe('Не готова инфраструктура');
    expect(segments[2]!.text).toBe('Подготовить демо');
    // summary отдельным сегментом.
    expect(segments[3]!.text).toBe('Итоги встречи: договорились о релизе');
    // chapters: «title: summary».
    expect(segments[4]!.text).toBe('Обсуждение: Поговорили о сроках');
    expect(segments[5]!.text).toBe('Решения: Приняли план');
    // Все report-сегменты — без speakers/времени.
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

    // tryGetReportSegments вернул [] (а не null) → именно report-ветка, не fallback.
    expect(segments).toHaveLength(0);
  });

  it('payload без kind=meeting_report → НЕ report-ветка (fallback)', () => {
    const svc = makeSvc();
    const payload = { kind: 'something_else', reportFacts: [{ text: 'x' }] };

    const segments = svc.buildSegments(payload);

    // Упал в fallback (JSON-stringify), report-ветка не сработала.
    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toContain('something_else');
  });
});

/**
 * Б21 [K13] — одиночный сверхдлинный turn РАНЬШЕ уходил в LLM-окно целиком
 * (без усечения) → таймаут/обрезка JSON → потеря всего окна. Теперь длинный
 * turn режется посимвольно на куски ≤ лимита (maxTokens*4 символов с поправкой
 * на `speaker: ` префикс), каждый — отдельный сегмент того же speaker'а.
 */
describe('SegmentBuilderService — длинный turn усекается до лимита (Б21)', () => {
  const makeSvc = (maxTokens: number) =>
    new SegmentBuilderService(
      {
        knowledgeCore: {
        blockIngestMaxTokensPerSegment: maxTokens,
        segmentMaxTokens: maxTokens,
        segmentOverlapRatio: 0,
      },
      } as unknown as ConstructorParameters<typeof SegmentBuilderService>[0],
    );

  it('один turn длиннее лимита → несколько сегментов, каждый ≤ лимита по символам', () => {
    // maxTokens=10 → лимит ≈ 40 символов на сегмент. Один turn в 200 символов.
    const maxTokens = 10;
    const svc = makeSvc(maxTokens);
    const speaker = 'Алиса';
    const longText = 'я'.repeat(200);
    const payload = {
      meetingId: 'm1',
      transcript: {
        turns: [{ speaker, text: longText, startSec: 0, endSec: 5 }],
      },
    };

    const segments = svc.buildSegments(payload);

    // Раньше был бы РОВНО 1 сегмент в 200+ символов (вся «дыра»).
    expect(segments.length).toBeGreaterThan(1);
    const maxChars = maxTokens * 4; // 40
    for (const s of segments) {
      // Каждый сегмент (включая префикс `speaker: `) укладывается в лимит.
      expect(s.text.length).toBeLessThanOrEqual(maxChars);
      // Префикс speaker'а сохранён в каждом куске.
      expect(s.text.startsWith(`${speaker}: `)).toBe(true);
    }
    // Восстановленный текст (без префиксов) равен исходному — ничего не потеряли.
    const reconstructed = segments
      .map((s) => s.text.slice(`${speaker}: `.length))
      .join('');
    expect(reconstructed).toBe(longText);
  });

  it('turn в пределах лимита → ровно 1 сегмент (без дробления)', () => {
    const svc = makeSvc(2000);
    const payload = {
      meetingId: 'm1',
      transcript: {
        turns: [{ speaker: 'Боб', text: 'Короткая фраза', startSec: 0, endSec: 1 }],
      },
    };

    const segments = svc.buildSegments(payload);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe('Боб: Короткая фраза');
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
        knowledgeCore: {
        blockIngestMaxTokensPerSegment: maxTokens,
        segmentMaxTokens: maxTokens,
        segmentOverlapRatio: 0,
      },
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
        knowledgeCore: {
        blockIngestMaxTokensPerSegment: maxTokens,
        segmentMaxTokens: maxTokens,
        segmentOverlapRatio: 0,
      },
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
            messageExternalId: 'msg-1',
          },
          {
            speaker: 'Менеджер [N]',
            text: 'ответ',
            startSec: 1,
            endSec: 1.9,
            speakerParticipantId: null,
            authorPersonId: 'p-manager',
            messageExternalId: 'msg-2',
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
    expect(segments[0]!.messageExternalId).toBe('msg-1');
    expect(segments[1]!.messageExternalId).toBe('msg-2');
    expect(segments[0]!.authorExternalLabel).toBe('Клиент [A]');
    expect(
      Object.prototype.hasOwnProperty.call(segments[1]!, 'authorExternalLabel'),
    ).toBe(false);
    expect(segments[1]!.authorExternalLabel).toBeUndefined();
  });

  it('bitrix turns с authorPersonId автора → сегмент несёт authorPersonId', () => {
    const svc = makeSvc();
    const payload = {
      kind: 'bitrix_chat_session',
      fullText: 'Менеджер: ответ',
      transcript: {
        turns: [
          {
            speaker: 'Менеджер [Иван]',
            text: 'согласовал поставку',
            startSec: 0,
            endSec: 0.9,
            speakerParticipantId: null,
            authorPersonId: 'p-ivan',
            messageExternalId: 'b-1',
          },
        ],
      },
    };

    const segments = svc.buildSegments(payload);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.authorPersonId).toBe('p-ivan');
    expect(
      Object.prototype.hasOwnProperty.call(segments[0]!, 'authorExternalLabel'),
    ).toBe(false);
  });

  it('meeting turn (authorPersonId undefined) → authorExternalLabel НЕ задан', () => {
    const svc = makeSvc();
    const payload = {
      meetingId: 'm1',
      transcript: {
        turns: [{ speaker: 'Алиса', text: 'Привет', startSec: 0, endSec: 1 }],
      },
    };

    const segments = svc.buildSegments(payload);

    expect(segments).toHaveLength(1);
    expect(
      Object.prototype.hasOwnProperty.call(segments[0]!, 'authorExternalLabel'),
    ).toBe(false);
    expect(segments[0]!.authorExternalLabel).toBeUndefined();
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
    expect(
      Object.prototype.hasOwnProperty.call(segments[0]!, 'messageExternalId'),
    ).toBe(false);
    expect(segments[0]!.messageExternalId).toBeUndefined();
  });
});

/**
 * TZ clone-method Э3.1 — ответ на probe (`kind:'notification_response'`)
 * распознаётся как чистый текстовый сегмент «Вопрос Коры: … Ответ …»,
 * а не JSON-stringify обёртка (фикс класса: чинит ВСЕ probe-ответы,
 * не только CDM — раньше userId/eventType/respondsToNotificationId уходили
 * LLM как шум через buildFallback).
 */
describe('SegmentBuilderService — notification_response (clone-method Э3.1)', () => {
  const makeSvc = () =>
    new SegmentBuilderService(
      ({
        knowledgeCore: {
        blockIngestMaxTokensPerSegment: 2000,
        segmentMaxTokens: 2000,
        segmentOverlapRatio: 0,
      },
      }) as unknown as ConstructorParameters<typeof SegmentBuilderService>[0],
    );

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
    // Служебные поля payload НЕ протекают в текст сегмента.
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

    // Упал в buildFallback: текст — JSON-stringify обёртки.
    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toContain('notification_response');
  });
});
