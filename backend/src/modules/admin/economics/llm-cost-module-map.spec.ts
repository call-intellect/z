import { describe, expect, it } from 'vitest';

import { ALL_LLM_TASK_TYPES } from '../../ai/services/llm-router.service';

import {
  LLM_COST_MODULE_LABELS,
  resolveLlmCostModule,
  type LlmCostModule,
} from './llm-cost-module-map';

const KNOWN_MODULES: readonly LlmCostModule[] = Object.keys(
  LLM_COST_MODULE_LABELS,
) as LlmCostModule[];

describe('resolveLlmCostModule', () => {
  it.each(ALL_LLM_TASK_TYPES)(
    'возвращает один из 4 модулей для taskType=%s',
    (taskType) => {
      const module = resolveLlmCostModule(taskType);
      expect(module).toBeDefined();
      expect(KNOWN_MODULES).toContain(module);
    },
  );

  it("возвращает 'other' для неизвестного taskType (fallback)", () => {
    expect(resolveLlmCostModule('совершенно-неизвестный-taskType-xyz')).toBe('other');
  });
});
