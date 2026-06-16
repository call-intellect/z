import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';

export interface Segment {
  startMs: number;
  endMs: number;
  speakers: string[];
  text: string;
  speakerParticipantId?: string | null;
  authorPersonId?: string | null;
}

interface MeetingTurn {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
  speakerParticipantId?: string | null;
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
}

@Injectable()
export class SegmentBuilderService {
  private readonly logger = new Logger(SegmentBuilderService.name);

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  buildSegments(payload: unknown): Segment[] {
    const meeting = this.tryAsMeeting(payload);
    if (meeting) {
      return this.buildFromMeeting(meeting);
    }
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
    const freeNote = this.tryGetFreeNoteText(payload);
    if (freeNote) {
      return [{ startMs: 0, endMs: 0, speakers: [], text: freeNote }];
    }
    const report = this.tryGetReportSegments(payload);
    if (report) {
      return report;
    }
    const notificationResponse = this.tryGetNotificationResponseText(payload);
    if (notificationResponse) {
      return [{ startMs: 0, endMs: 0, speakers: [], text: notificationResponse }];
    }
    return this.buildFallback(payload);
  }

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

    if (Array.isArray(p.reportFacts)) {
      for (const f of p.reportFacts) {
        if (f && typeof f === 'object') {
          push((f as { text?: unknown }).text as string | undefined);
        }
      }
    }

    push(p.reportSummaryMarkdown as string | undefined);

    if (Array.isArray(p.chapters)) {
      for (const c of p.chapters) {
        if (c && typeof c === 'object') {
          const ch = c as { title?: unknown; summary?: unknown };
          const title = typeof ch.title === 'string' ? ch.title.trim() : '';
          const summary = typeof ch.summary === 'string' ? ch.summary.trim() : '';
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
          speakerParticipantId: group[0]?.speakerParticipantId ?? null,
          ...(group[0]?.authorPersonId !== undefined
            ? { authorPersonId: group[0].authorPersonId }
            : {}),
        });
        buffer = [];
        bufferChars = 0;
      };
      for (const turn of group) {
        const turnChars = turn.text.length + speaker.length + 3;
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
