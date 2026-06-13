/**
 * Редизайн кабинета Ф5а (2026-06-13) — авто-название встречи.
 *
 * `MeetingTitleService.generateMeetingTitle` — best-effort генерация короткого
 * названия встречи из типа + первых реплик транскрипта через taskType
 * `meeting-title`. Перезаписывает `Meeting.title` ТОЛЬКО если текущий title —
 * плейсхолдер (см. `isPlaceholderMeetingTitle`). Идемпотентно: повторный вызов
 * на уже осмысленном title — no-op.
 *
 * Живёт в knowledge-core (а не в @Global MeetingsService), чтобы избежать
 * цикла meetings ↔ ai и тащить LlmRouterService только туда, где он уже есть
 * (worker-процесс). Вызывается из `MeetingReportFastWorker` после готовности
 * транскрипта.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import type { DialogTurn } from '../../ai/services/prompts/common';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import { isPlaceholderMeetingTitle } from '../../meetings/meeting-title.util';
import {
  MEETING_TITLE_MAX_CHARS,
  MEETING_TITLE_MAX_TOKENS,
  MEETING_TITLE_MAX_TURNS,
  MEETING_TITLE_SYSTEM_PROMPT,
  MEETING_TITLE_USER_PROMPT,
} from '../../meetings/prompts/meeting-title.prompt';

/** Жёсткий потолок на длину сохраняемого title (страховка). */
const MEETING_TITLE_PERSIST_MAX_LEN = 120;

@Injectable()
export class MeetingTitleService {
  private readonly logger = new Logger(MeetingTitleService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  /**
   * Сгенерировать и сохранить авто-название встречи. Best-effort: любая ошибка
   * (LLM упал, пустой ответ) логируется warn'ом и НЕ роняет вызывающий поток.
   *
   * @returns сохранённый title, либо null если перезапись не выполнена
   *   (placeholder-гейт не прошёл / пустой транскрипт / LLM не дал ответа).
   */
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

      // Гейт перезаписи: осмысленный пользовательский title не трогаем.
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

      // Повторно проверяем гейт под обновление (защита от гонки: title мог
      // быть задан осмысленно между чтением и записью).
      const updateResult = await this.prisma.meeting.updateMany({
        where: { id: meetingId, tenantId },
        data: { title: cleaned },
      });
      if (updateResult.count === 0) {
        this.logger.debug({ meetingId }, 'meeting-title: updateMany 0 строк — skip');
        return null;
      }

      this.logger.log({ meetingId, tenantId, title: cleaned }, 'meeting-title: авто-название сохранено');
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

// ─────────────────────────── helpers ───────────────────────────────────────

/** Безопасно достаёт `DialogTurn[]` из `Transcript.turns` (Json). */
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

/**
 * Склеивает первые `MEETING_TITLE_MAX_TURNS` реплик в текст `Speaker: text`,
 * обрезая по `MEETING_TITLE_MAX_CHARS`.
 */
function buildExcerpt(turns: DialogTurn[]): string {
  const head = turns.slice(0, MEETING_TITLE_MAX_TURNS);
  const joined = head
    .map((t) => (t.speaker ? `${t.speaker}: ${t.text}` : t.text))
    .join('\n');
  return joined.slice(0, MEETING_TITLE_MAX_CHARS).trim();
}

/**
 * Чистит сырой ответ LLM: убирает кавычки/код-фенсы/префиксы, берёт первую
 * строку, обрезает точку в конце и потолок длины.
 */
function cleanTitle(raw: string): string {
  let s = (raw ?? '').trim();
  // Снимаем обрамляющие тройные бэктики (на случай code-fence).
  s = s.replace(/```[a-z]*/giu, '').trim();
  // Первая непустая строка.
  const firstLine = s.split(/\r?\n/u).map((l) => l.trim()).find((l) => l.length > 0);
  s = firstLine ?? '';
  // Снимаем обрамляющие кавычки/точки/пробелы циклом — устойчиво к любому
  // порядку (например `«…».` — точка ПОСЛЕ кавычки).
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
