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
    return this.buildFallback(payload);
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
    const maxTokens = this.cfg.knowledgeCore.blockIngestMaxTokensPerSegment;

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
      const flush = () => {
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
        });
        buffer = [];
        bufferChars = 0;
      };
      for (const turn of group) {
        const turnChars = turn.text.length + speaker.length + 3;
        // Если уже есть содержимое и добавление этого turn перегонит лимит —
        // флашим и начинаем новый сегмент. Если один turn сам больше лимита —
        // попадает в свой сегмент целиком (резать turn посимвольно опаснее
        // для семантики, чем оставить большой сегмент).
        const projectedChars = bufferChars + turnChars;
        if (buffer.length > 0 && Math.ceil(projectedChars / 4) > maxTokens) {
          flush();
        }
        buffer.push(turn);
        bufferChars += turnChars;
      }
      flush();
    }

    return segments;
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
