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
