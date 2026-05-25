/**
 * Snapshot-тест на seed-route критичных агентов клона.
 *
 * ТЗ 2026-05-25 clone-reliability-hardening, Фаза 6.5, решение ОВ5:
 * прокси DeepSeek версионные slug-и НЕ поддерживает, поэтому заморозка
 * версии критичного агента `skill-trait-detect` (и сопутствующих) — через:
 *   1) текстовое поле `LlmTaskRoute.pinnedVersionNote`;
 *   2) ЭТОТ snapshot-тест — ломается при любом изменении model/provider
 *      в цепочках критичных агентов;
 *   3) предупреждение в UI `/admin/llm-routes` о незакреплённой версии.
 *
 * Тест по образцу `backend/src/modules/knowledge-core/prompts/skill-trait-detect.snapshot.spec.ts`.
 *
 * Если изменилась модель в seed-скрипте `seed-llm-task-routes-skill-and-clone.ts` —
 * тест упадёт. Разработчик должен ОСОЗНАННО прогнать `bunx vitest --update`
 * (и обновить golden-набор перед сменой модели).
 */
import { describe, expect, it } from 'vitest';

import { SEEDS } from './seed-llm-task-routes-skill-and-clone';

describe('seed-llm-task-routes-skill-and-clone — snapshot защиты от случайных правок модели', () => {
  it('skill-trait-detect — primary/secondary/tertiary заморожены', () => {
    const skillTraitDetect = SEEDS.find((s) => s.taskType === 'skill-trait-detect');
    expect(skillTraitDetect).toBeDefined();
    expect(skillTraitDetect!.chain).toMatchSnapshot('skill-trait-detect-chain');
  });

  it('skill-trait-merge — цепочка стабильна', () => {
    const skillTraitMerge = SEEDS.find((s) => s.taskType === 'skill-trait-merge');
    expect(skillTraitMerge).toBeDefined();
    expect(skillTraitMerge!.chain).toMatchSnapshot('skill-trait-merge-chain');
  });

  it('executable-persona-compile — цепочка стабильна', () => {
    const compile = SEEDS.find((s) => s.taskType === 'executable-persona-compile');
    expect(compile).toBeDefined();
    expect(compile!.chain).toMatchSnapshot('executable-persona-compile-chain');
  });

  it('clone-respond — цепочка стабильна', () => {
    const respond = SEEDS.find((s) => s.taskType === 'clone-respond');
    expect(respond).toBeDefined();
    expect(respond!.chain).toMatchSnapshot('clone-respond-chain');
  });
});
