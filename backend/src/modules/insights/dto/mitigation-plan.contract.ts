import { z } from 'zod';

/**
 * TZ-1 Фаза 4.B (daily-value-engine) — контракт `Insight.mitigationPlan`.
 *
 * Поле `Insight.mitigationPlan` в схеме — `String? @db.Text` (исторически —
 * свободный текст плана реагирования). БЕЗ изменения схемы формализуем его
 * как JSON-контракт: митигация = список шагов + ответственный + дедлайн.
 *
 * Поле остаётся строкой; структурированный план хранится как СЕРИАЛИЗОВАННЫЙ
 * JSON внутри строки. Helper'ы ниже:
 *   - `parseMitigationPlan(raw)` — распознать структуру (или null, если это
 *     старый свободный текст / пусто);
 *   - `serializeMitigationPlan(plan)` — обратно в строку для записи;
 *   - `isStructuredMitigationPlan(raw)` — быстрый предикат.
 *
 * Совместимость: старые планы (просто текст) parse-функция возвращает как
 * `null` — вызывающий код трактует их как legacy free-text (через
 * `freeTextFromRaw`). Так миграция не нужна, а новые планы пишутся структурно.
 */

/** Один шаг плана митигации. */
export const MitigationStepSchema = z
  .object({
    text: z.string().min(1).max(2_000),
    /** Выполнен ли шаг (для прогресса). */
    done: z.boolean().optional().default(false),
  })
  .strict();
export type MitigationStep = z.infer<typeof MitigationStepSchema>;

/** Структурированный план митигации: шаги + ответственный + дедлайн. */
export const MitigationPlanSchema = z
  .object({
    /** Маркер версии контракта (для будущей эволюции). */
    v: z.literal(1).optional().default(1),
    steps: z.array(MitigationStepSchema).min(1).max(50),
    /** Ответственный — Person.id или User.id (резолвится на стороне UI). NULL допустим. */
    ownerPersonId: z.string().min(1).nullable().optional().default(null),
    /** Дедлайн в формате YYYY-MM-DD. NULL — без срока. */
    deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'deadline must be YYYY-MM-DD')
      .nullable()
      .optional()
      .default(null),
  })
  .strict();
export type MitigationPlan = z.infer<typeof MitigationPlanSchema>;

/**
 * Распарсить `Insight.mitigationPlan` (raw-строку из БД) в структурированный
 * план. Возвращает `null`, если:
 *   - строка пустая/NULL;
 *   - это не валидный JSON (старый свободный текст);
 *   - JSON не соответствует контракту.
 *
 * Не бросает — graceful degrade к legacy free-text.
 */
export function parseMitigationPlan(raw: string | null | undefined): MitigationPlan | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (!trimmed.startsWith('{')) return null; // явно free-text, не JSON-объект.
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const parsed = MitigationPlanSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** Структурированный ли план в этой строке. Чистый предикат. */
export function isStructuredMitigationPlan(
  raw: string | null | undefined,
): boolean {
  return parseMitigationPlan(raw) !== null;
}

/** Сериализовать структурированный план обратно в строку для записи в БД. */
export function serializeMitigationPlan(plan: MitigationPlan): string {
  const validated = MitigationPlanSchema.parse(plan);
  return JSON.stringify(validated);
}

/**
 * Достать человекочитаемый текст плана из raw-строки независимо от формата:
 *   - структурированный — конкатенация шагов;
 *   - free-text — как есть.
 * Удобно для рендера / промптов, где формат не важен.
 */
export function mitigationPlanToText(raw: string | null | undefined): string | null {
  const structured = parseMitigationPlan(raw);
  if (structured) {
    return structured.steps.map((s) => s.text).join('; ');
  }
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  return null;
}
