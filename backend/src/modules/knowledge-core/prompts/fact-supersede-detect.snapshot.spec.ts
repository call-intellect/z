/**
 * Snapshot-тест промта `fact-supersede-detect.prompt.ts`.
 *
 * Фиксирует:
 *   - текст `FACT_SUPERSEDE_DETECT_SYSTEM_PROMPT` (включая обёртку
 *     `withConfidenceCalibration`);
 *   - JSON-схему `FACT_SUPERSEDE_DETECT_JSON_SCHEMA`.
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  FACT_SUPERSEDE_DETECT_JSON_SCHEMA,
  FACT_SUPERSEDE_DETECT_SYSTEM_PROMPT,
} from './fact-supersede-detect.prompt';

describe('fact-supersede-detect — snapshot сборки промта', () => {
  it('system prompt стабилен', () => {
    expect(FACT_SUPERSEDE_DETECT_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('JSON Schema стабилен', () => {
    expect(FACT_SUPERSEDE_DETECT_JSON_SCHEMA).toMatchSnapshot('schema');
  });
});
