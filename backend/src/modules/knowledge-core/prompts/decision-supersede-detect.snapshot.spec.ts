/**
 * Snapshot-тест промта `decision-supersede-detect.prompt.ts`.
 *
 * Фиксирует:
 *   - текст `DECISION_SUPERSEDE_DETECT_SYSTEM_PROMPT`;
 *   - JSON-схему `DECISION_SUPERSEDE_DETECT_JSON_SCHEMA`.
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  DECISION_SUPERSEDE_DETECT_JSON_SCHEMA,
  DECISION_SUPERSEDE_DETECT_SYSTEM_PROMPT,
} from './decision-supersede-detect.prompt';

describe('decision-supersede-detect — snapshot сборки промта', () => {
  it('system prompt стабилен', () => {
    expect(DECISION_SUPERSEDE_DETECT_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('JSON Schema стабилен', () => {
    expect(DECISION_SUPERSEDE_DETECT_JSON_SCHEMA).toMatchSnapshot('schema');
  });
});
