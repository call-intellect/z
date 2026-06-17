/**
 * Snapshot-тест сборки промта `classify.prompt.ts`.
 *
 * ⚠ НЕ про accuracy LLM. Snapshot фиксирует:
 *   - текст `DIALOG_CLASSIFY_SYSTEM_PROMPT` (system) — guard, что промпт
 *     не правится «по мелочи» без явного решения. Любая правка SYSTEM ломает
 *     prompt cache deepseek-v4-flash (hit ≈99.9% → 0%, см. ТЗ
 *     plans/tz/2026-05-29-telegram-self-initiated-checkins.md Приложение А);
 *   - содержимое `DIALOG_CLASSIFY_JSON_SCHEMA` (порядок enum-значений и
 *     набор полей);
 *   - текст user, который собирает `buildClassifyUserPrompt` для
 *     фиксированной фразы.
 *
 * Обновлять только при осознанном изменении (отдельным версионированным
 * шагом с обоснованием): `bunx vitest --update classify.snapshot`.
 *
 * Accuracy-тест с golden-фикстурами (30+30+30+30) идёт отдельным файлом
 * `classify-accuracy.eval.spec.ts` — он зависит от живого LLM и запускается
 * по ENV-флагу `CLASSIFY_ACCURACY_EVAL=1`. Этот snapshot — статика без LLM.
 */
import { describe, expect, it } from 'vitest';

import {
  DIALOG_CLASSIFY_JSON_SCHEMA,
  DIALOG_CLASSIFY_SYSTEM_PROMPT,
  buildClassifyUserPrompt,
} from './classify.prompt';

describe('dialog-classify — snapshot сборки промта (ТЗ 2026-05-29)', () => {
  it('SYSTEM-промпт стабилен (8 категорий + ловушки)', () => {
    expect(DIALOG_CLASSIFY_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('JSON Schema стабильна (порядок enum + required, для prompt cache)', () => {
    expect(DIALOG_CLASSIFY_JSON_SCHEMA).toMatchSnapshot('schema');
  });

  it('buildClassifyUserPrompt — стабильный префикс «Сообщение пользователя: »', () => {
    const user = buildClassifyUserPrompt({
      question: 'План на день: КП Заречному, созвон с дизайнером',
    });
    expect(user).toMatchSnapshot('user');
  });
});
