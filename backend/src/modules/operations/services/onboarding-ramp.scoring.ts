/**
 * TZ-1 Фаза 4.E (daily-value-engine) — чистая логика онбординг-рампа новичка.
 *
 * Без зависимостей от Prisma/NestJS — unit-тестируется без БД.
 */

export const DEFAULT_ONBOARDING_SILENT_DAYS = 5;

/**
 * «Заглох» ли онбординг новичка. Чистая функция.
 *
 * Новичок считается не активировавшимся (stalled), если:
 *   - он в окне онбординга: с `createdAt` прошло >= `silentDays` дней
 *     (раньше — рано бить тревогу), но не слишком давно (окно = 2×silentDays —
 *     после этого «новичок» уже не новичок, не наш сигнал);
 *   - и за это время НЕ было первой активности (`firstActivityAt === null`)
 *     ИЛИ первая активность случилась позже окна молчания.
 *
 * `firstActivityAt` — самый ранний артефакт (IdeaBlockEntity subject) или вопрос
 * памяти (ChatV2Message). NULL — активности не было вовсе.
 *
 * Возвращает `false`, если активность была в пределах окна молчания (новичок
 * включился) или если ещё рано / уже поздно.
 */
export function isOnboardingStalled(args: {
  createdAt: Date;
  firstActivityAt: Date | null;
  silentDays: number;
  now: Date;
}): boolean {
  const silentDays = safeNonNeg(args.silentDays) || DEFAULT_ONBOARDING_SILENT_DAYS;
  const ageDays =
    (args.now.getTime() - args.createdAt.getTime()) / 86_400_000;

  // Ещё рано — окно молчания не прошло.
  if (ageDays < silentDays) return false;
  // Уже не новичок — вышел за окно наблюдения (2× silentDays).
  if (ageDays > silentDays * 2) return false;

  // Активности не было вовсе → заглох.
  if (args.firstActivityAt === null) return true;

  // Активность была: заглох, только если она случилась ПОСЛЕ окна молчания
  // (т.е. в первые silentDays дней новичок молчал). Если включился в окне —
  // не stalled.
  const activityDays =
    (args.firstActivityAt.getTime() - args.createdAt.getTime()) / 86_400_000;
  return safeNonNeg(activityDays) >= silentDays;
}

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function safeNonNeg(v: unknown): number {
  const n = safeNumber(v);
  return n > 0 ? n : 0;
}
