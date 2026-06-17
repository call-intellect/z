/**
 * Snapshot-тест промта `block-ingest.prompt.ts`.
 *
 * Фиксирует:
 *   - текст SYSTEM (через `buildBlockIngestPrompt({ segments: [] }).system` —
 *     SYSTEM не экспортируется отдельной константой, поэтому собираем его
 *     билдером с пустым окном);
 *   - JSON-схему `BLOCK_INGEST_JSON_SCHEMA` (структура ответа LLM).
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 * ТЗ 2026-06-16 (Прил. A1) — переписан по методологии (7 блоков).
 */
import { describe, expect, it } from 'vitest';

import {
  BLOCK_INGEST_JSON_SCHEMA,
  buildBlockIngestPrompt,
} from './block-ingest.prompt';

describe('block-ingest — snapshot сборки промта', () => {
  it('system prompt стабилен', () => {
    const { system } = buildBlockIngestPrompt({ segments: [] });
    expect(system).toMatchSnapshot('system');
  });

  it('JSON Schema стабилен', () => {
    expect(BLOCK_INGEST_JSON_SCHEMA).toMatchSnapshot('schema');
  });
});
