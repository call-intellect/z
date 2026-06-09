import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { tryParseJson } from '../services/json-extract.util';
import { LlmRouterService } from '../services/llm-router.service';
import type { DialogTurn } from '../services/prompts/common';

/**
 * Meeting-Speaker-Analyzer (Pulse Wave 4 §4.4, plans/tz/2026-05-30-pulse-full.md).
 *
 * Hourly batch (`@Cron('20 * * * *')`): для каждой `MeetingParticipantBehavior`
 * с `sentimentTextPerSpeakerJson IS NULL` и встречей, завершившейся за
 * последние 24ч, собирает реплики этого спикера из `Transcript.turns`
 * (DialogTurn[]) и пишет в JSON структурированный анализ:
 *
 *   { topics: string[3..5], textSentiment: 'positive'|'neutral'|'negative',
 *     confidence: 0..1 }
 *
 * Спикер ↔ Participant матчится по livekitIdentity или name (case-insensitive),
 * аналогично `behavior-metrics-calculator.ts`.
 *
 * EU AI Act §1.3: НЕ анализирует audio/video, только TEXT транскрипта.
 * Это поведенческая аналитика на основе слов, не emotion recognition.
 *
 * Если реплик < 50 символов — пишем заглушку `neutral` с низким confidence.
 * Best-effort: ошибка по одной MPB не валит проход.
 */
const SYSTEM_PROMPT = `Ты — аналитик встреч. На вход — текст реплик одного спикера за встречу. Определи:
- topics: 3-5 главных тем, о которых он говорил (короткие фразы на русском).
- textSentiment: общий sentiment ТЕКСТА его реплик ('positive' / 'neutral' / 'negative').
- confidence: твоя уверенность 0..1.

Жёсткие правила:
- Анализируй ТОЛЬКО текст, не пытайся угадывать эмоции по голосу/невербалике (их нет в данных).
- На основе только переданных реплик. Не додумывай.
- Имена сотрудников НЕ цитируй в topics.
- Верни строго JSON: { topics: string[], textSentiment, confidence }`;

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    topics: { type: 'array', items: { type: 'string' } },
    textSentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['topics', 'textSentiment', 'confidence'],
} as const;

interface ParsedSentiment {
  topics: string[];
  textSentiment: 'positive' | 'neutral' | 'negative';
  confidence: number;
}

@Injectable()
export class MeetingSpeakerAnalyzerWorker {
  private readonly logger = new Logger(MeetingSpeakerAnalyzerWorker.name);
  private static readonly MAX_BATCH = 100;
  private static readonly MAX_TEXT_CHARS = 6000;
  private static readonly MIN_TEXT_CHARS = 50;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  /** Hourly при минуте :20 (после behavior-metrics.worker для свежих встреч). */
  @Cron('20 * * * *')
  async run(): Promise<void> {
    try {
      const stats = await this.runOnce();
      this.logger.log(stats, 'meeting-speaker-analyzer: проход завершён');
    } catch (err) {
      this.logger.error(
        `meeting-speaker-analyzer fail: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async runOnce(): Promise<{
    processed: number;
    skippedNoText: number;
    skippedNoTranscript: number;
    errors: number;
  }> {
    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 3600 * 1000);

    // Берём pending MeetingParticipantBehavior со свежих встреч.
    // JSON-поле IS NULL фильтруем через `equals: Prisma.AnyNull` (Prisma 7).
    const pending = await this.prisma.meetingParticipantBehavior.findMany({
      where: {
        sentimentTextPerSpeakerJson: { equals: Prisma.AnyNull },
        metrics: {
          meeting: { endedAt: { gte: since24h, lte: now } },
        },
      },
      select: {
        id: true,
        tenantId: true,
        participantId: true,
        displayName: true,
        metrics: {
          select: {
            meetingId: true,
          },
        },
      },
      take: MeetingSpeakerAnalyzerWorker.MAX_BATCH,
    });

    let processed = 0;
    let skippedNoText = 0;
    let skippedNoTranscript = 0;
    let errors = 0;

    // Кэш транскриптов по meetingId, чтобы не перечитывать для нескольких MPB
    // одного meeting'а в одном проходе.
    const turnsCache = new Map<string, DialogTurn[] | null>();
    const participantsCache = new Map<
      string,
      Array<{ id: string; livekitIdentity: string; name: string }>
    >();

    for (const mpb of pending) {
      try {
        const meetingId = mpb.metrics.meetingId;

        let turns = turnsCache.get(meetingId);
        if (turns === undefined) {
          const transcript = await this.prisma.transcript.findUnique({
            where: { meetingId },
            select: { turns: true },
          });
          turns =
            transcript?.turns === null || transcript?.turns === undefined
              ? null
              : (transcript.turns as unknown as DialogTurn[]);
          turnsCache.set(meetingId, turns);
        }
        if (!turns || turns.length === 0) {
          skippedNoTranscript++;
          continue;
        }

        let participants = participantsCache.get(meetingId);
        if (!participants) {
          participants = await this.prisma.participant.findMany({
            where: { meetingId },
            select: { id: true, livekitIdentity: true, name: true },
          });
          participantsCache.set(meetingId, participants);
        }

        // Собираем реплики текущего участника по speaker-key matching
        // (identity + displayName, case-insensitive).
        const speakerKeys = this.buildSpeakerKeys(
          mpb.participantId,
          mpb.displayName,
          participants,
        );
        const speakerText = this.collectSpeakerText(turns, speakerKeys);

        if (speakerText.length < MeetingSpeakerAnalyzerWorker.MIN_TEXT_CHARS) {
          // Слишком мало текста — пишем нейтральную заглушку с низким confidence.
          await this.prisma.meetingParticipantBehavior.update({
            where: { id: mpb.id },
            data: {
              sentimentTextPerSpeakerJson: {
                topics: [],
                textSentiment: 'neutral',
                confidence: 0.3,
              } as unknown as Prisma.InputJsonValue,
            },
          });
          skippedNoText++;
          continue;
        }

        const truncated = speakerText.slice(0, MeetingSpeakerAnalyzerWorker.MAX_TEXT_CHARS);

        let parsed: ParsedSentiment | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          const out = await this.llm.call({
            taskType: 'meeting-speaker-analyzer',
            tenantId: mpb.tenantId,
            systemPrompt: SYSTEM_PROMPT,
            userMessage: truncated,
            sourceRef: { type: 'meeting_participant_behavior', id: mpb.id },
            maxTokens: 400,
            responseFormat: {
              type: 'json_schema',
              name: 'SpeakerTextAnalysis',
              schema: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
              strict: true,
            },
            validate: (text) => this.safeParse(text) !== null,
          });
          parsed = this.safeParse(out.text);
          if (parsed) break;
          this.logger.warn(
            `meeting-speaker-analyzer mpb ${mpb.id}: невалидный JSON LLM — повтор (attempt ${attempt})`,
          );
        }
        if (!parsed) {
          errors++;
          this.logger.warn(
            `meeting-speaker-analyzer mpb ${mpb.id}: невалидный JSON от LLM (2 попытки)`,
          );
          continue;
        }

        await this.prisma.meetingParticipantBehavior.update({
          where: { id: mpb.id },
          data: {
            sentimentTextPerSpeakerJson: parsed as unknown as Prisma.InputJsonValue,
          },
        });
        processed++;
      } catch (err) {
        errors++;
        this.logger.warn(
          `meeting-speaker-analyzer mpb ${mpb.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { processed, skippedNoText, skippedNoTranscript, errors };
  }

  /**
   * Формирует набор speaker-ключей (lowercase), по которым реплики в
   * `DialogTurn[]` относятся к данному участнику.
   *
   * Аналог логики `behavior-metrics-calculator.ts`: matches либо по
   * `livekitIdentity`, либо по `name`. Для NULL participantId fallback'имся
   * на displayName из MPB-снапшота.
   */
  private buildSpeakerKeys(
    participantId: string | null,
    displayName: string,
    participants: ReadonlyArray<{ id: string; livekitIdentity: string; name: string }>,
  ): Set<string> {
    const keys = new Set<string>();
    if (participantId) {
      const p = participants.find((x) => x.id === participantId);
      if (p) {
        keys.add(p.livekitIdentity.toLowerCase());
        keys.add(p.name.toLowerCase());
      }
    }
    keys.add(displayName.toLowerCase());
    return keys;
  }

  /**
   * Собирает текст реплик из `DialogTurn[]`, у которых
   * `turn.speaker.toLowerCase()` попадает в speakerKeys.
   */
  private collectSpeakerText(turns: DialogTurn[], speakerKeys: Set<string>): string {
    const parts: string[] = [];
    for (const t of turns) {
      const speaker = (t.speaker ?? '').toLowerCase();
      if (!speakerKeys.has(speaker)) continue;
      if (typeof t.text === 'string' && t.text.length > 0) {
        parts.push(t.text);
      }
    }
    return parts.join(' ');
  }

  /**
   * Парсит JSON-ответ модели. Терпим к мусору — возвращает null, если
   * структура не соответствует ожидаемой.
   */
  private safeParse(raw: string): ParsedSentiment | null {
    const obj = tryParseJson(raw);
    if (!obj || typeof obj !== 'object') return null;
    const o = obj as Record<string, unknown>;
    const topics = Array.isArray(o.topics)
      ? o.topics.filter((s): s is string => typeof s === 'string')
      : null;
    const ts = o.textSentiment;
    const textSentiment =
      ts === 'positive' || ts === 'neutral' || ts === 'negative' ? ts : null;
    const conf = o.confidence;
    const confidence =
      typeof conf === 'number' && Number.isFinite(conf) && conf >= 0 && conf <= 1
        ? conf
        : null;
    if (!topics || !textSentiment || confidence === null) return null;
    return { topics, textSentiment, confidence };
  }
}
