import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';

/**
 * Один сегмент диалога — единица скармливания LLM в block-ingest.
 * Группа подряд идущих turns одного speaker'а либо одиночный turn.
 */
export interface Segment {
  startMs: number;
  endMs: number;
  speakers: string[];
  text: string;
  /**
   * Фаза 1 (meeting-identity) — participantId дорожки спикера. Несёт identity
   * автора для атрибуции (role='subject') в block-ingest. undefined для
   * fullText/freeNote/fallback сегментов.
   */
  speakerParticipantId?: string | null;
  /**
   * Детерминированная identity автора сегмента как Person.id — для chatbox
   * (per-message сегментация). undefined — identity берётся из
   * speakerParticipantId (встречи) / session-level (одно-авторные источники).
   * null — автор известен как «не сотрудник» (клиент в переписке): subject НЕ
   * пишется (fail-closed). Свойство присутствует ТОЛЬКО у chatbox-сегментов.
   */
  authorPersonId?: string | null;
  authorExternalLabel?: string | null;
  messageExternalId?: string | null;
}

/** Структура turn'а в transcript meeting-payload. См. MeetingIngestAdapter. */
interface MeetingTurn {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
  /** Фаза 0.3 — participantId дорожки спикера (для атрибуции авторства). */
  speakerParticipantId?: string | null;
  /**
   * chatbox per-message — детерминированная identity автора turn'а как
   * Person.id (string=сотрудник) либо null (клиент). undefined для встреч.
   */
  authorPersonId?: string | null;
  messageExternalId?: string | null;
}

interface MeetingTranscript {
  turns?: MeetingTurn[];
  totalWords?: number | null;
  totalDurationSeconds?: number | null;
}

interface MeetingPayload {
  meetingId?: string;
  type?: string;
  title?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
  transcript?: MeetingTranscript;
  participants?: unknown[];
  roomChat?: unknown[];
  // Знак «meeting» — наличие transcript.turns. Иные источники падают в fallback.
}

/**
 * Строит сегменты из RawEvent.payload для скармливания LLM в block-ingest.
 *
 *  - Для meeting-payload: группирует подряд идущие turns одного speaker'а.
 *    Если текст группы превышает `cfg.knowledgeCore.blockIngestMaxTokensPerSegment`
 *    — режет посимвольно по границам turn'ов.
 *  - Для остальных payload — пока fallback: один сегмент со stringify'ем.
 *    Достаточно для baseline Фазы 2 (новые источники появятся позже).
 */
@Injectable()
export class SegmentBuilderService {
  private readonly logger = new Logger(SegmentBuilderService.name);

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  buildSegments(payload: unknown): Segment[] {
    const meeting = this.tryAsMeeting(payload);
    if (meeting) {
      return this.buildFromMeeting(meeting);
    }
    // Sprint 3 B1-3.1: payload с `fullText` (например, TrackerAdapter:
    // issue.created или comment.created) — используем его как одиночный
    // сегмент натурального текста, а не JSON-stringify. Так LLM получит
    // тот же текст, что увидел бы человек, без шума метаданных.
    const fullText = this.tryGetFullText(payload);
    if (fullText) {
      return [
        {
          startMs: 0,
          endMs: 0,
          speakers: [],
          text: fullText,
        },
      ];
    }
    // Фаза 10 (2026-06-04 razblokirovka-konveyera): payload свободной заметки
    // `{ kind:'free_note', userId, text, metadata }` (см. ConversationalIngestAdapter)
    // не имеет ни transcript.turns, ни fullText — без этой ветки он падал в
    // buildFallback и весь JSON-объект (kind/userId/metadata) попадал в текст
    // сегмента как шум. Берём только чистый `text`.
    const freeNote = this.tryGetFreeNoteText(payload);
    if (freeNote) {
      return [{ startMs: 0, endMs: 0, speakers: [], text: freeNote }];
    }
    const chatMessage = this.tryGetChatMessageText(payload);
    if (chatMessage) {
      return [{ startMs: 0, endMs: 0, speakers: [], text: chatMessage }];
    }
    // Фаза 2 «отчёт встречи → граф» (ТЗ 2026-06-11-report-to-graph-phase2.md
    // §2.1): payload `{ kind:'meeting_report', reportFacts, reportSummaryMarkdown,
    // chapters }` (см. ReportIngestAdapter). Разворачиваем в ГРАНУЛЯРНЫЕ
    // сегменты — по одному на каждый факт/главу + один на summary, — чтобы
    // block-ingest извлёк отдельный блок на факт, а не один склеенный fullText.
    const report = this.tryGetReportSegments(payload);
    if (report) {
      return report;
    }
    // TZ clone-method Э3.1 — ответ на probe-уведомление
    // `{ kind:'notification_response', questionText, response }`
    // (см. ConversationalIngestAdapter.ingestNotificationResponse). До фикса
    // payload падал в buildFallback и ВЕСЬ JSON (userId, eventType,
    // respondsToNotificationId, объект response) уходил LLM как
    // stringify-шум. Чиним класс: ВСЕ probe-ответы (не только CDM) идут
    // чистым текстом «Вопрос Коры: … Ответ …».
    const notificationResponse = this.tryGetNotificationResponseText(payload);
    if (notificationResponse) {
      return [{ startMs: 0, endMs: 0, speakers: [], text: notificationResponse }];
    }
    return this.buildFallback(payload);
  }

  // ─────────────────────────── meeting_report ─────────────────────────────

  /**
   * Разворачивает payload отчёта встречи в гранулярные сегменты. Возвращает
   * null, если payload не является отчётом (`kind !== 'meeting_report'`) —
   * тогда buildSegments идёт в fallback.
   *
   * Гранулярность критична: каждый факт — отдельный сегмент → отдельный
   * IdeaBlock с нужным signalType. НЕ склеиваем в один сегмент.
   * signalType определит LLM-extraction; новое поле Segment НЕ вводим.
   */
  private tryGetReportSegments(payload: unknown): Segment[] | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const p = payload as {
      kind?: unknown;
      reportFacts?: unknown;
      reportSummaryMarkdown?: unknown;
      chapters?: unknown;
    };
    if (p.kind !== 'meeting_report') return null;

    const segments: Segment[] = [];
    const push = (text: string | null | undefined) => {
      if (typeof text === 'string' && text.trim().length > 0) {
        segments.push({ startMs: 0, endMs: 0, speakers: [], text: text.trim() });
      }
    };

    // 1. По одному сегменту на каждый структурный факт.
    if (Array.isArray(p.reportFacts)) {
      for (const f of p.reportFacts) {
        if (f && typeof f === 'object') {
          push((f as { text?: unknown }).text as string | undefined);
        }
      }
    }

    // 2. Быстрое саммари — отдельным сегментом.
    push(p.reportSummaryMarkdown as string | undefined);

    // 3. По одному сегменту на каждую главу: «title: summary» (или только title).
    if (Array.isArray(p.chapters)) {
      for (const c of p.chapters) {
        if (c && typeof c === 'object') {
          const ch = c as { title?: unknown; summary?: unknown };
          const title = typeof ch.title === 'string' ? ch.title.trim() : '';
          const summary =
            typeof ch.summary === 'string' ? ch.summary.trim() : '';
          if (title && summary) push(`${title}: ${summary}`);
          else if (title) push(title);
          else if (summary) push(summary);
        }
      }
    }

    return segments;
  }

  private tryGetFullText(payload: unknown): string | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const v = (payload as { fullText?: unknown }).fullText;
    return typeof v === 'string' && v.trim().length > 0 ? v : null;
  }

  private tryGetFreeNoteText(payload: unknown): string | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const p = payload as { kind?: unknown; text?: unknown };
    if (p.kind !== 'free_note') return null;
    return typeof p.text === 'string' && p.text.trim().length > 0 ? p.text : null;
  }

  private tryGetChatMessageText(payload: unknown): string | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const p = payload as { kind?: unknown; text?: unknown };
    if (p.kind !== 'chat_message') return null;
    return typeof p.text === 'string' && p.text.trim().length > 0 ? p.text : null;
  }

  /**
   * TZ clone-method Э3.1 — чистый текст из payload ответа на probe
   * (`kind:'notification_response'`):
   *   - текст ответа достаём из `payload.response` по каскаду ключей
   *     ['text','response','body','answer'] (как ProbeResponseHandler.
   *     extractResponseText); если response — строка, берём её;
   *   - если есть `questionText` — склейка «Вопрос Коры: …\n\nОтвет …»
   *     (вопрос даёт LLM контекст, без него ответ «да, согласен» бесполезен);
   *   - пустой текст ответа → null (fallback на старое поведение).
   */
  private tryGetNotificationResponseText(payload: unknown): string | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const p = payload as {
      kind?: unknown;
      questionText?: unknown;
      response?: unknown;
    };
    if (p.kind !== 'notification_response') return null;

    let responseText: string | null = null;
    if (typeof p.response === 'string' && p.response.trim().length > 0) {
      responseText = p.response.trim();
    } else if (typeof p.response === 'object' && p.response !== null) {
      for (const key of ['text', 'response', 'body', 'answer'] as const) {
        const v = (p.response as Record<string, unknown>)[key];
        if (typeof v === 'string' && v.trim().length > 0) {
          responseText = v.trim();
          break;
        }
      }
    }
    if (!responseText) return null;

    const questionText =
      typeof p.questionText === 'string' && p.questionText.trim().length > 0
        ? p.questionText.trim()
        : null;
    return questionText
      ? `Вопрос Коры: ${questionText}\n\nОтвет сотрудника: ${responseText}`
      : responseText;
  }

  // ─────────────────────────── meeting ─────────────────────────────────────

  private tryAsMeeting(payload: unknown): MeetingPayload | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const p = payload as MeetingPayload;
    if (!p.transcript || !Array.isArray(p.transcript.turns)) return null;
    return p;
  }

  private buildFromMeeting(payload: MeetingPayload): Segment[] {
    const turns = payload.transcript?.turns ?? [];
    if (turns.length === 0) {
      this.logger.warn('SegmentBuilder: meeting payload без turns — нет сегментов');
      return [];
    }
    const ceiling = this.cfg.knowledgeCore.blockIngestMaxTokensPerSegment;
    const maxTokens = Math.min(this.cfg.knowledgeCore.segmentMaxTokens, ceiling);
    const overlapRatio = this.cfg.knowledgeCore.segmentOverlapRatio;

    // Шаг 1: схлопываем подряд идущих same-speaker.
    const groups: MeetingTurn[][] = [];
    let current: MeetingTurn[] = [];
    let lastSpeaker: string | null = null;
    for (const turn of turns) {
      if (turn.speaker !== lastSpeaker && current.length > 0) {
        groups.push(current);
        current = [];
      }
      current.push(turn);
      lastSpeaker = turn.speaker;
    }
    if (current.length > 0) groups.push(current);

    // Шаг 2: каждый group → 1+ сегмент с лимитом по токенам.
    const segments: Segment[] = [];
    for (const group of groups) {
      const speaker = group[0]?.speaker ?? 'unknown';
      let buffer: MeetingTurn[] = [];
      let bufferChars = 0;
      // Б21 — лимит в символах: 1 токен ≈ 4 символа. Запас под `speaker: `
      // префикс и перевод строки учитывается тем, что turnChars их прибавляет.
      const maxChars = Math.max(1, maxTokens * 4);
      const turnChars = (t: MeetingTurn) => t.text.length + speaker.length + 3;
      const flush = (keepOverlap: boolean) => {
        if (buffer.length === 0) return;
        const text = buffer.map((t) => `${speaker}: ${t.text}`).join('\n');
        const startSec = buffer[0]!.startSec;
        const endSec = buffer[buffer.length - 1]!.endSec;
        segments.push({
          startMs: Math.round(startSec * 1000),
          endMs: Math.round(endSec * 1000),
          speakers: [speaker],
          text,
          // В группе один speaker — берём participantId из первого turn'а.
          speakerParticipantId: group[0]?.speakerParticipantId ?? null,
          // chatbox per-message: поле присутствует ТОЛЬКО если turn его несёт
          // (иначе встречи получили бы authorPersonId=null вместо undefined).
          ...(group[0]?.authorPersonId !== undefined
            ? { authorPersonId: group[0].authorPersonId }
            : {}),
          ...(group[0]?.authorPersonId === null
            ? { authorExternalLabel: speaker }
            : {}),
          ...(buffer[0]?.messageExternalId !== undefined
            ? { messageExternalId: buffer[0].messageExternalId }
            : {}),
        });
        if (keepOverlap && overlapRatio > 0) {
          const overlapChars = Math.round(maxChars * overlapRatio);
          const tail: MeetingTurn[] = [];
          let tailChars = 0;
          for (let i = buffer.length - 1; i >= 0; i--) {
            const c = buffer[i]!;
            const cChars = turnChars(c);
            if (tailChars + cChars > overlapChars) break;
            tail.unshift(c);
            tailChars += cChars;
          }
          buffer = tail;
          bufferChars = tailChars;
        } else {
          buffer = [];
          bufferChars = 0;
        }
      };
      for (const turn of group) {
        const chunks = this.splitTurnByChars(turn, maxChars, speaker);
        for (const chunk of chunks) {
          const chunkChars = turnChars(chunk);
          const projectedChars = bufferChars + chunkChars;
          if (buffer.length > 0 && Math.ceil(projectedChars / 4) > maxTokens) {
            flush(true);
          }
          buffer.push(chunk);
          bufferChars += chunkChars;
        }
      }
      flush(false);
    }

    return segments;
  }

  /**
   * Б21 — режет один turn на куски так, чтобы каждый кусок (вместе с
   * `speaker: ` префиксом и переводом строки) укладывался в `maxChars`.
   * Возвращает массив turn'ов того же speaker'а с теми же тайм-границами и
   * атрибуцией (startSec/endSec/speakerParticipantId/authorPersonId не дробим —
   * для under-лимита turn'ов это исходный turn без изменений). Если turn
   * помещается целиком — возвращает `[turn]` (без аллокаций по символам).
   */
  private splitTurnByChars(
    turn: MeetingTurn,
    maxChars: number,
    speaker: string,
  ): MeetingTurn[] {
    // Бюджет на чистый текст внутри одного сегмента: лимит минус префикс
    // `${speaker}: ` (длина speaker + 2) — он добавляется в flush() на КАЖДУЮ
    // строку. Минимум 1, чтобы не зациклиться при гигантском speaker.
    const textBudget = Math.max(1, maxChars - speaker.length - 2);
    if (turn.text.length <= textBudget) {
      return [turn];
    }
    const pieces: MeetingTurn[] = [];
    for (let i = 0; i < turn.text.length; i += textBudget) {
      pieces.push({ ...turn, text: turn.text.slice(i, i + textBudget) });
    }
    return pieces;
  }

  // ─────────────────────────── fallback ────────────────────────────────────

  private buildFallback(payload: unknown): Segment[] {
    let text: string;
    try {
      text = JSON.stringify(payload);
    } catch {
      text = String(payload);
    }
    return [
      {
        startMs: 0,
        endMs: 0,
        speakers: [],
        text,
      },
    ];
  }
}
