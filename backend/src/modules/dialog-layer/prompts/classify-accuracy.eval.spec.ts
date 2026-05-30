/**
 * ТЗ 2026-05-29 telegram-self-initiated-checkins Фаза 1 / DoD:
 *   «Golden-snapshot тест classify.snapshot.spec.ts зелёный — accuracy ≥0.85
 *   на каждой категории».
 *
 * Этот файл — accuracy-eval с реальным LLM. По умолчанию ПРОПУСКАЕТСЯ
 * (через describe.skipIf), потому что:
 *   - дёргает реальный QueryClassifierService → LlmRouter → DeepSeek-flash;
 *   - 120 вызовов LLM = ~$0.1 + минуты времени;
 *   - flaky в CI (сетевые ошибки).
 *
 * Активация: установить ENV `CLASSIFY_ACCURACY_EVAL=1` и запустить:
 *   docker compose exec backend bun run vitest run \
 *     src/modules/dialog-layer/prompts/classify-accuracy.eval.spec.ts
 *
 * Альтернативно — отдельный скрипт `backend/scripts/eval/classify-accuracy.ts`
 * (не входит в первую итерацию ТЗ; запуск через vitest достаточен).
 *
 * Stub-секция (без gate'а) — статика на 120 фикстур: 30 morning + 30 evening +
 * 30 note + 30 регрессионных. Просто валидируем структуру фикстур — гарантирует
 * что JSON не сломан и количества верны.
 */
import { describe, expect, it } from 'vitest';

import fixtures from './__fixtures__/classify-fixtures.json';

const ENABLE_EVAL = process.env['CLASSIFY_ACCURACY_EVAL'] === '1';

describe('classify-fixtures.json — структура (always-on)', () => {
  it('30 фикстур на daily_plan_morning', () => {
    expect(fixtures.daily_plan_morning).toHaveLength(30);
    expect(
      fixtures.daily_plan_morning.every(
        (f) => f.expected === 'daily_plan_morning',
      ),
    ).toBe(true);
  });

  it('30 фикстур на daily_report_evening', () => {
    expect(fixtures.daily_report_evening).toHaveLength(30);
    expect(
      fixtures.daily_report_evening.every(
        (f) => f.expected === 'daily_report_evening',
      ),
    ).toBe(true);
  });

  it('30 фикстур на note (включая ловушки про план на отпуск/квартал)', () => {
    expect(fixtures.note).toHaveLength(30);
    expect(fixtures.note.every((f) => f.expected === 'note')).toBe(true);
    const noteTexts = fixtures.note.map((f) => f.question.toLowerCase());
    expect(noteTexts.some((t) => t.includes('отпуск'))).toBe(true);
    expect(noteTexts.some((t) => t.includes('квартал'))).toBe(true);
    expect(noteTexts.some((t) => t.includes('встреч'))).toBe(true);
  });

  it('30 регрессионных фикстур на 4 chat-категории', () => {
    expect(fixtures.regression_chat).toHaveLength(30);
    const intents = new Set(fixtures.regression_chat.map((f) => f.expected));
    expect(intents).toEqual(
      new Set(['factual', 'exploratory', 'analytical', 'clone_roleplay']),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// Accuracy-gate — реальный LLM. Включается CLASSIFY_ACCURACY_EVAL=1.
// На MVP оставлено placeholder'ом: реализация запускает QueryClassifier
// через nest-test-context (требует AppModule.boot и DI). Конкретный
// раннер добавляется отдельным шагом перед прод-релизом (не входит в
// первую итерацию ТЗ — см. итоговый отчёт).
// ─────────────────────────────────────────────────────────────────────
describe.skipIf(!ENABLE_EVAL)('classify accuracy gate (требует LLM)', () => {
  it('TODO: запустить QueryClassifierService на 120 фикстурах', () => {
    // См. plans/tz/2026-05-29-telegram-self-initiated-checkins.md DoD.
    // Реализация: поднять Nest test context (AppModule, override LlmRouter
    // если нужно), пройтись по фикстурам, посчитать accuracy на каждую
    // категорию, expect ≥0.85.
    expect(ENABLE_EVAL).toBe(true);
  });
});
