/**
 * Snapshot-тест промптов `card-rollup-v2.prompts.ts`.
 *
 * Фиксирует ВСЕ 6 kind-констант SYSTEM-промпта (client / deal / project /
 * topic / vendor / custom), а также собранный `getCardRollupV2SystemPrompt`
 * для каждого kind (тело + стабильный суффикс supersession).
 *
 * Обновлять только при осознанном изменении: `bunx vitest run -u`.
 */
import { describe, expect, it } from 'vitest';

import {
  CARD_ROLLUP_V2_CLIENT_PROMPT,
  CARD_ROLLUP_V2_CUSTOM_PROMPT,
  CARD_ROLLUP_V2_DEAL_PROMPT,
  CARD_ROLLUP_V2_KINDS,
  CARD_ROLLUP_V2_PROJECT_PROMPT,
  CARD_ROLLUP_V2_SUPERSESSION_RULE,
  CARD_ROLLUP_V2_TOPIC_PROMPT,
  CARD_ROLLUP_V2_VENDOR_PROMPT,
  getCardRollupV2SystemPrompt,
} from './card-rollup-v2.prompts';

describe('card-rollup-v2 — snapshot 6 kind-констант', () => {
  it('client prompt стабилен', () => {
    expect(CARD_ROLLUP_V2_CLIENT_PROMPT).toMatchSnapshot('client');
  });

  it('deal prompt стабилен', () => {
    expect(CARD_ROLLUP_V2_DEAL_PROMPT).toMatchSnapshot('deal');
  });

  it('project prompt стабилен', () => {
    expect(CARD_ROLLUP_V2_PROJECT_PROMPT).toMatchSnapshot('project');
  });

  it('topic prompt стабилен', () => {
    expect(CARD_ROLLUP_V2_TOPIC_PROMPT).toMatchSnapshot('topic');
  });

  it('vendor prompt стабилен', () => {
    expect(CARD_ROLLUP_V2_VENDOR_PROMPT).toMatchSnapshot('vendor');
  });

  it('custom prompt стабилен', () => {
    expect(CARD_ROLLUP_V2_CUSTOM_PROMPT).toMatchSnapshot('custom');
  });

  it('стабильный суффикс supersession не меняется', () => {
    expect(CARD_ROLLUP_V2_SUPERSESSION_RULE).toMatchSnapshot('supersession');
  });

  it('getCardRollupV2SystemPrompt(kind) — тело + суффикс для всех kind', () => {
    const assembled = Object.fromEntries(
      CARD_ROLLUP_V2_KINDS.map((kind) => [
        kind,
        getCardRollupV2SystemPrompt(kind),
      ]),
    );
    expect(assembled).toMatchSnapshot('assembled');
  });
});
