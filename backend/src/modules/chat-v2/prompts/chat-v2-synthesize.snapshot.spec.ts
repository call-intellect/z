/**
 * Snapshot-тест констант промтов `chat-v2-synthesize.prompt.ts`.
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot фиксирует:
 *   - mode-addon тексты `CHAT_V2_SYNTHESIZE_MODE_PROMPTS.factual` /
 *     `.synthetic` (подмешиваются в начало вопроса SynthesisService);
 *   - addon про uncertainty/conflicts.
 *
 * Build-функции здесь нет (на α-5 chat-v2 использует BASE_SYSTEM_PROMPT
 * из `knowledge-core/services/chat-v2.service.ts`, см. jsdoc промта).
 * Snapshot ловит регрессии: случайные правки правил маркировки уверенности.
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  CHAT_V2_SYNTHESIZE_MODE_PROMPTS,
  CHAT_V2_SYNTHESIZE_SYSTEM_PROMPT_ADDON,
} from './chat-v2-synthesize.prompt';

describe('chat-v2-synthesize — snapshot констант промта', () => {
  it('factual mode-addon стабилен', () => {
    expect(CHAT_V2_SYNTHESIZE_MODE_PROMPTS.factual).toMatchInlineSnapshot(`
      "Режим: «факты».
      Отвечай ТОЛЬКО тем, что прямо сказано в найденных блоках.
      Если в источниках нет ответа — честно скажи «не нашёл в памяти компании».
      Каждое утверждение должно быть подкреплено маркером [BLOCK:id]."
    `);
  });

  it('synthetic mode-addon стабилен', () => {
    expect(CHAT_V2_SYNTHESIZE_MODE_PROMPTS.synthetic).toMatchInlineSnapshot(`
      "Режим: «синтез».
      Можешь обобщать данные из нескольких блоков, но строго маркируй уверенность:
      - «по нескольким источникам» — если факт подтверждён 2+ блоками;
      - «однажды было сказано» — если источник единичный;
      - «возможно устарело» — если блок старше 6 месяцев или есть конфликт.
      Все ключевые утверждения помечай [BLOCK:id]."
    `);
  });

  it('addon про uncertainty/conflicts стабилен', () => {
    expect(CHAT_V2_SYNTHESIZE_SYSTEM_PROMPT_ADDON).toMatchInlineSnapshot(`
      "Если среди источников
      есть противоречия — обязательно укажи это с маркерами обоих блоков
      ([BLOCK:id1] vs [BLOCK:id2]). Не сглаживай конфликты — это важная сигнатура
      для curator'а."
    `);
  });
});
