import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import type { DialogTurn } from '../../ai/services/prompts/common';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import { isPlaceholderMeetingTitle } from '../../meetings/meeting-title.util';
import {
  MEETING_TITLE_MAX_CHARS,
  MEETING_TITLE_MAX_TOKENS,
  MEETING_TITLE_MAX_TURNS,
  MEETING_TITLE_SYSTEM_PROMPT,
  MEETING_TITLE_USER_PROMPT,
} from '../../meetings/prompts/meeting-title.prompt';

const MEETING_TITLE_PERSIST_MAX_LEN = 120;

@Injectable()
export class MeetingTitleService {
  private readonly logger = new Logger(MeetingTitleService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  async generateMeetingTitle(args: {
    tenantId: string;
    meetingId: string;
  }): Promise<string | null> {
    const { tenantId, meetingId } = args;
    try {
      const meeting = await this.prisma.meeting.findFirst({
        where: { id: meetingId, tenantId },
        select: {
          id: true,
          title: true,
          type: true,
          ownerId: true,
          transcript: { select: { turns: true } },
        },
      });
      if (!meeting) {
        this.logger.debug({ meetingId, tenantId }, 'meeting-title: meeting не найден — skip');
        return null;
      }

      if (!isPlaceholderMeetingTitle(meeting.title)) {
        this.logger.debug(
          { meetingId, title: meeting.title },
          'meeting-title: title осмысленный — skip (идемпотентно)',
        );
        return null;
      }

      const turns = extractTurns(meeting.transcript?.turns);
      const excerpt = buildExcerpt(turns);
      if (excerpt.length === 0) {
        this.logger.debug({ meetingId }, 'meeting-title: пустой транскрипт — skip');
        return null;
      }

      const userText = wrapUserData(
        MEETING_TITLE_USER_PROMPT({
          meetingType: meeting.type,
          transcriptExcerpt: excerpt,
        }),
      );
      const result = await this.llm.call({
        taskType: 'meeting-title',
        tenantId,
        systemPrompt: withInjectionGuard(MEETING_TITLE_SYSTEM_PROMPT),
        userMessage: userText,
        maxTokens: MEETING_TITLE_MAX_TOKENS,
        meetingId,
        ...(meeting.ownerId ? { userId: meeting.ownerId } : {}),
        sourceRef: { type: 'meeting', id: meetingId },
        dataClass: 'internal',
      });

      const cleaned = cleanTitle(result.text);
      if (cleaned.length === 0) {
        this.logger.warn({ meetingId }, 'meeting-title: LLM вернул пустое название — skip');
        return null;
      }

      const updateResult = await this.prisma.meeting.updateMany({
        where: { id: meetingId, tenantId },
        data: { title: cleaned },
      });
      if (updateResult.count === 0) {
        this.logger.debug({ meetingId }, 'meeting-title: updateMany 0 строк — skip');
        return null;
      }

      this.logger.log(
        { meetingId, tenantId, title: cleaned },
        'meeting-title: авто-название сохранено',
      );
      return cleaned;
    } catch (err) {
      this.logger.warn(
        { meetingId, tenantId, err: err instanceof Error ? err.message : String(err) },
        'meeting-title: генерация упала (best-effort) — оставляем старый title',
      );
      return null;
    }
  }
}

function extractTurns(raw: unknown): DialogTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: DialogTurn[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const turn = t as Record<string, unknown>;
    const speaker = typeof turn['speaker'] === 'string' ? turn['speaker'] : '';
    const text = typeof turn['text'] === 'string' ? turn['text'] : '';
    if (text.length === 0) continue;
    const startSec = typeof turn['startSec'] === 'number' ? turn['startSec'] : 0;
    const endSec = typeof turn['endSec'] === 'number' ? turn['endSec'] : 0;
    out.push({ speaker, text, startSec, endSec });
  }
  return out;
}

function buildExcerpt(turns: DialogTurn[]): string {
  const head = turns.slice(0, MEETING_TITLE_MAX_TURNS);
  const joined = head.map((t) => (t.speaker ? `${t.speaker}: ${t.text}` : t.text)).join('\n');
  return joined.slice(0, MEETING_TITLE_MAX_CHARS).trim();
}

function cleanTitle(raw: string): string {
  let s = (raw ?? '').trim();
  s = s.replace(/```[a-z]*/giu, '').trim();
  const firstLine = s
    .split(/\r?\n/u)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  s = firstLine ?? '';
  let prev: string;
  do {
    prev = s;
    s = s
      .replace(/^[«"“'.\s]+/u, '')
      .replace(/[»"”'.\s]+$/u, '')
      .trim();
  } while (s !== prev);
  if (s.length > MEETING_TITLE_PERSIST_MAX_LEN) {
    s = s.slice(0, MEETING_TITLE_PERSIST_MAX_LEN).trim();
  }
  return s;
}
