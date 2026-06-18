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
