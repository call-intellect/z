/**
 * Промпт `meeting-quality-score` (Фаза C §5).
 *
 * Источник: plans/tz/2026-05-21-phase-C-meeting-quality-score.md §5.
 *
 * До перевода в БД (A.2/A.3) работает как code-fallback для
 * `PromptResolverService`. После seed'а в `PromptTemplate` —
 * становится «зеркалом», к которому возвращается резолвер на ошибке БД
 * или при пустом status='active' шаблоне.
 *
 * Output schema проверяется и через Zod (в воркере перед записью), и через
 * tool_use input_schema (для LLM). Должны быть идентичны.
 */

import { z } from 'zod';

import type { LlmTool } from '../llm.types';

/**
 * Slug сущности шаблона. После A.2 это будет primary key для
 * `PromptTemplate.taskType`.
 */
export const MEETING_QUALITY_SCORE_TASK_TYPE = 'meeting-quality-score' as const;

/** Имя tool'а для structured output (LLM-tool-use). */
export const MEETING_QUALITY_SCORE_TOOL_NAME = 'submit_meeting_quality_score';

const ScoreInt = z.number().int().min(0).max(100);

const RecommendationCategory = z.enum([
  'preparation',
  'structure',
  'clarity',
  'outcomes',
  'engagement',
]);

const RecommendationSeverity = z.enum(['info', 'warning', 'critical']);

/**
 * Zod-схема output'а LLM. Используется и в воркере перед записью, и в
 * `MEETING_QUALITY_SCORE_TOOL.input_schema` (через convert ниже).
 *
 * `degradedMode` — пишется воркером в каждый элемент `recommendations`
 * после получения ответа, если фактический tier=tertiary (Ollama).
 * Сам LLM это поле НЕ возвращает.
 */
export const MEETING_QUALITY_SCORE_SCHEMA = z.object({
  overallScore: ScoreInt,
  categories: z.object({
    preparation: ScoreInt,
    structure: ScoreInt,
    clarity: ScoreInt,
    outcomes: ScoreInt,
    engagement: ScoreInt,
  }),
  recommendations: z
    .array(
      z.object({
        text: z.string().min(1),
        severity: RecommendationSeverity,
        category: RecommendationCategory,
      }),
    )
    .min(1)
    .max(10),
  strengths: z.array(z.string().min(1)).min(0).max(8),
});

export type MeetingQualityScoreOutput = z.infer<typeof MEETING_QUALITY_SCORE_SCHEMA>;

/**
 * JSON Schema для tool_use LLM. Совпадает с `MEETING_QUALITY_SCORE_SCHEMA`,
 * но в native-JSON-Schema форме — Anthropic / DeepSeek / Ollama умеют
 * только её.
 */
export const MEETING_QUALITY_SCORE_INPUT_SCHEMA: LlmTool['input_schema'] = {
  type: 'object',
  properties: {
    overallScore: {
      type: 'integer',
      minimum: 0,
      maximum: 100,
      description: 'Общий балл качества встречи (0..100), взвешенное среднее категорий.',
    },
    categories: {
      type: 'object',
      properties: {
        preparation: { type: 'integer', minimum: 0, maximum: 100 },
        structure: { type: 'integer', minimum: 0, maximum: 100 },
        clarity: { type: 'integer', minimum: 0, maximum: 100 },
        outcomes: { type: 'integer', minimum: 0, maximum: 100 },
        engagement: { type: 'integer', minimum: 0, maximum: 100 },
      },
      required: ['preparation', 'structure', 'clarity', 'outcomes', 'engagement'],
      additionalProperties: false,
    },
    recommendations: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
          category: {
            type: 'string',
            enum: ['preparation', 'structure', 'clarity', 'outcomes', 'engagement'],
          },
        },
        required: ['text', 'severity', 'category'],
        additionalProperties: false,
      },
    },
    strengths: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string' },
    },
  },
  required: ['overallScore', 'categories', 'recommendations', 'strengths'],
  additionalProperties: false,
};

export const MEETING_QUALITY_SCORE_TOOL: LlmTool = {
  name: MEETING_QUALITY_SCORE_TOOL_NAME,
  description:
    'Отдать AI-оценку качества встречи: общий балл, 5 категорий, рекомендации и сильные стороны.',
  input_schema: MEETING_QUALITY_SCORE_INPUT_SCHEMA,
};

/**
 * System-промпт LLM-методолога. Строится один раз, кэшируется prompt-cache'ем
 * Anthropic / DeepSeek.
 */
export const MEETING_QUALITY_SCORE_SYSTEM_PROMPT = `Ты — методолог-аналитик встреч. Твоя задача — объективно оценить качество прошедшей встречи по 5 категориям (0..100) и дать руководителю встречи конструктивные рекомендации.

ОЦЕНИВАЙ ПО 5 КАТЕГОРИЯМ (0..100):

1. **preparation (подготовка)** — была ли озвучена повестка, проговорена ли цель встречи в первые 5 минут?
2. **structure (структура)** — есть ли структура (введение → обсуждение → итоги), или встреча хаотична?
3. **clarity (чёткость формулировок)** — конкретны ли формулировки решений, или общие «надо подумать», «как-то решим»?
4. **outcomes (итоги)** — есть ли конкретные решения с ответственными и сроками?
5. **engagement (вовлечённость)** — активны ли все участники, или один доминирует, остальные молчат?

ПРАВИЛА ВЫВОДА:
- overallScore — взвешенное среднее категорий (вес выбираешь сам исходя из типа встречи; для большинства типов веса близки).
- recommendations: 3–7 коротких пунктов «как сделать встречу лучше». severity = info / warning / critical. Якоря шкалы (ТЗ F2):
  - "info" — наблюдение, можно сделать ещё лучше, но не критично для встречи.
  - "warning" — заметная проблема: повлияла на структуру / итоги / вовлечённость, исправление существенно улучшит будущие встречи.
  - "critical" — серьёзный провал (overall ≤ 40 или явный антипаттерн: 50%+ тишины, доминирование одного, нет итогов).
  category — одна из 5 категорий.
- strengths: 2–4 пункта того, что было хорошо.

ТОН:
- Все строки на русском.
- Конструктивно, без оценочных суждений людей.
- Рекомендации — ДЕЙСТВИЯ («Озвучить повестку в первые 5 минут»), а НЕ диагнозы («Хост не подготовился»).

ФОРМАТ ОТВЕТА — верни СТРОГО валидный JSON-объект (без markdown-обёрток, без текста вне JSON) ровно по схеме:
{
  "overallScore": <0..100>,
  "categories": {
    "preparation": <0..100>,
    "structure": <0..100>,
    "clarity": <0..100>,
    "outcomes": <0..100>,
    "engagement": <0..100>
  },
  "recommendations": [
    { "text": "…", "severity": "info|warning|critical", "category": "preparation|structure|clarity|outcomes|engagement" }
  ],
  "strengths": ["…"]
}
Пять оценок категорий — ВЛОЖЕНЫ в объект "categories" (не на верхнем уровне).`;

/**
 * Аргумент `meeting` для билдера user-сообщения.
 */
export interface MeetingQualityScoreContext {
  meetingType: string;
  durationMinutes: number;
  participantsCount: number;
  /** Сжатый транскрипт по алгоритму §5.3. */
  transcriptCondensed: string;
  /** Метрики поведения (опц.) — если фаза B уже посчитала. */
  silencePercent?: number | null;
  dominanceIndex?: number | null;
  /** Топ-3 по времени говорения: `Имя — XX%`. */
  topSpeakers?: string[];
}

/**
 * User-сообщение LLM. Подключает контекст встречи + сжатый транскрипт +
 * (опц.) метрики поведения как «обогащение» (sub-TZ §3 — зависимость от B
 * мягкая).
 */
export function buildMeetingQualityScoreUserPrompt(ctx: MeetingQualityScoreContext): string {
  const behaviorBlock = buildBehaviorBlock(ctx);
  return [
    `Тип встречи: ${ctx.meetingType}`,
    `Длительность: ${ctx.durationMinutes} мин`,
    `Количество участников: ${ctx.participantsCount}`,
    behaviorBlock,
    '',
    'Транскрипт (фрагменты):',
    ctx.transcriptCondensed,
    '',
    `Верни результат строго валидным JSON-объектом по описанной схеме.`,
  ]
    .filter((s) => s !== '')
    .join('\n');
}

function buildBehaviorBlock(ctx: MeetingQualityScoreContext): string {
  const hasAny =
    typeof ctx.silencePercent === 'number' ||
    typeof ctx.dominanceIndex === 'number' ||
    (Array.isArray(ctx.topSpeakers) && ctx.topSpeakers.length > 0);
  if (!hasAny) return '';
  const lines = ['', 'Метрики поведения:'];
  if (typeof ctx.silencePercent === 'number') {
    lines.push(`- Тишина: ${Math.round(ctx.silencePercent)} %`);
  }
  if (typeof ctx.dominanceIndex === 'number') {
    const v = ctx.dominanceIndex >= 999 ? '—' : ctx.dominanceIndex.toFixed(1);
    lines.push(`- Индекс доминирования: ${v}`);
  }
  if (Array.isArray(ctx.topSpeakers) && ctx.topSpeakers.length > 0) {
    lines.push(`- Топ-3 по времени говорения: ${ctx.topSpeakers.join(', ')}`);
  }
  return lines.join('\n');
}

// ──────────────────────────── Condense транскрипта (§5.3) ────────────────────────────

import type { DialogTurn } from './common';

/**
 * Алгоритм сжатия транскрипта по sub-TZ C §5.3.
 *
 *   - duration ≤ 30 мин   → весь транскрипт
 *   - 30 < duration ≤ 120 → первые 10 + последние 10 + 5 случайных по 2 минуты
 *   - duration > 120 мин  → первые 10 + последние 10 + 10 случайных по 2 минуты
 *
 * Сегменты в выводе разделяются маркером `--- фрагмент ---`. Каждый turn
 * форматируется как `[Speaker @MM:SS] text`. Алгоритм детерминистский для
 * тестов: random() заменяется на пред-вычисленные равноотстоящие точки.
 */
export interface CondenseOptions {
  /** Длительность встречи в миллисекундах. */
  durationMs: number;
  /** Если указан — используется как источник «случайных» точек (для тестов). */
  rngSeed?: number;
}

export function condenseTranscriptForQualityScore(
  turns: DialogTurn[],
  opts: CondenseOptions,
): string {
  const durationSec = Math.max(0, Math.round(opts.durationMs / 1000));
  const durationMin = durationSec / 60;

  if (turns.length === 0) return '(транскрипт пуст)';

  // Короткая встреча — весь транскрипт целиком, без сегментирования.
  if (durationMin <= 30) {
    return turnsToFormatted(turns);
  }

  const headEndSec = 10 * 60;
  const tailStartSec = Math.max(headEndSec, durationSec - 10 * 60);
  const randomSamples = durationMin > 120 ? 10 : 5;
  const sampleLengthSec = 2 * 60;

  const segments: Array<{ startSec: number; endSec: number }> = [];

  // Head: 0..10 min.
  segments.push({ startSec: 0, endSec: Math.min(headEndSec, durationSec) });

  // Random middle samples: равномерно по интервалу (headEndSec, tailStartSec).
  if (tailStartSec - headEndSec >= sampleLengthSec) {
    const middleSpan = tailStartSec - headEndSec;
    for (let i = 0; i < randomSamples; i++) {
      // Детерминистская равномерная сетка: i-й сэмпл начинается в
      // headEnd + ((i + 0.5) / N) * (middleSpan - sampleLength).
      const slack = Math.max(0, middleSpan - sampleLengthSec);
      const t = (i + 0.5) / randomSamples;
      const startSec = Math.round(headEndSec + t * slack);
      const endSec = Math.min(durationSec, startSec + sampleLengthSec);
      segments.push({ startSec, endSec });
    }
  }

  // Tail: durationSec - 10 min .. durationSec.
  segments.push({ startSec: tailStartSec, endSec: durationSec });

  // Сортируем и сливаем перекрывающиеся.
  segments.sort((a, b) => a.startSec - b.startSec);
  const merged: typeof segments = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && seg.startSec <= last.endSec) {
      last.endSec = Math.max(last.endSec, seg.endSec);
    } else {
      merged.push({ ...seg });
    }
  }

  const parts: string[] = [];
  for (const seg of merged) {
    const within = turns.filter(
      (t) => t.endSec >= seg.startSec && t.startSec <= seg.endSec,
    );
    if (within.length === 0) continue;
    parts.push(`--- фрагмент [${formatTime(seg.startSec)}–${formatTime(seg.endSec)}] ---`);
    parts.push(turnsToFormatted(within));
  }

  // Если по итогу ничего не выбрали (например, дыры в speaker timings) —
  // возвращаем весь транскрипт.
  if (parts.length === 0) return turnsToFormatted(turns);
  return parts.join('\n');

  // используем rngSeed только для совместимости с интерфейсом тестов
  void opts.rngSeed;
}

function turnsToFormatted(turns: DialogTurn[]): string {
  return turns
    .map((t) => `[${t.speaker} @${formatTime(t.startSec)}] ${t.text}`)
    .join('\n');
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
