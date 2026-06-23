import { describe, expect, it } from 'vitest';

import { CLONE_RESPOND_USER_TEMPLATE } from './clone-respond.prompt';

const baseArgs = {
  question: 'Как поступить?',
  roleName: 'Маркетолог',
  bearerName: 'Иван',
  personaPrompt: 'persona',
  subgraph: {
    reasoningBlocks: [],
    knowledgeProfileSummary: null,
    decisions: [],
  },
};

describe('CLONE_RESPOND_USER_TEMPLATE — applicable_regulations', () => {
  it('без applicableRegulations → нет блока', () => {
    const out = CLONE_RESPOND_USER_TEMPLATE({ ...baseArgs });
    expect(out).not.toContain('<applicable_regulations>');
  });

  it('пустой массив → нет блока', () => {
    const out = CLONE_RESPOND_USER_TEMPLATE({ ...baseArgs, applicableRegulations: [] });
    expect(out).not.toContain('<applicable_regulations>');
  });

  it('Policy(blocking) → блок присутствует с меткой, severity, name, text', () => {
    const out = CLONE_RESPOND_USER_TEMPLATE({
      ...baseArgs,
      applicableRegulations: [{ kind: 'policy', severity: 'blocking', name: 'X', text: 'Y' }],
    });
    expect(out).toContain('<applicable_regulations>');
    expect(out).toContain('Политика');
    expect(out).toContain('[blocking]');
    expect(out).toContain('X');
    expect(out).toContain('Y');
  });

  it('блок регламентов идёт ПОСЛЕ known_procedures, когда заданы practiceSkills', () => {
    const out = CLONE_RESPOND_USER_TEMPLATE({
      ...baseArgs,
      practiceSkills: [
        {
          trigger: 'когда-то',
          steps: [{ order: 1, action: 'сделать шаг' }],
          redFlags: ['не делать так'],
        },
      ],
      applicableRegulations: [{ kind: 'policy', severity: 'blocking', name: 'X', text: 'Y' }],
    });
    const proceduresIdx = out.indexOf('<known_procedures>');
    const regulationsIdx = out.indexOf('<applicable_regulations>');
    expect(proceduresIdx).toBeGreaterThanOrEqual(0);
    expect(regulationsIdx).toBeGreaterThan(proceduresIdx);
  });
});

describe('CLONE_RESPOND_USER_TEMPLATE — regulations_index', () => {
  it('без regulationsIndex → нет блока', () => {
    const out = CLONE_RESPOND_USER_TEMPLATE({ ...baseArgs });
    expect(out).not.toContain('<regulations_index>');
  });

  it('пустой массив → нет блока', () => {
    const out = CLONE_RESPOND_USER_TEMPLATE({ ...baseArgs, regulationsIndex: [] });
    expect(out).not.toContain('<regulations_index>');
  });

  it('с элементами → блок присутствует с метками и severity', () => {
    const out = CLONE_RESPOND_USER_TEMPLATE({
      ...baseArgs,
      regulationsIndex: [
        { kind: 'policy', name: 'Политика А', severity: 'blocking' },
        { kind: 'regulation', name: 'Регламент Б', severity: null },
        { kind: 'process', name: 'Процесс В' },
        { kind: 'instruction', name: 'Инструкция Г' },
      ],
    });
    expect(out).toContain('<regulations_index>');
    expect(out).toContain('Политика');
    expect(out).toContain('Регламент');
    expect(out).toContain('Процесс');
    expect(out).toContain('Инструкция');
    expect(out).toContain('[blocking]');
    expect(out).toContain('Политика А');
  });

  it('regulations_index идёт ПОСЛЕ applicable_regulations, когда оба заданы', () => {
    const out = CLONE_RESPOND_USER_TEMPLATE({
      ...baseArgs,
      applicableRegulations: [{ kind: 'policy', severity: 'blocking', name: 'X', text: 'Y' }],
      regulationsIndex: [{ kind: 'policy', name: 'X', severity: 'blocking' }],
    });
    const applicableIdx = out.indexOf('<applicable_regulations>');
    const indexIdx = out.indexOf('<regulations_index>');
    expect(applicableIdx).toBeGreaterThanOrEqual(0);
    expect(indexIdx).toBeGreaterThan(applicableIdx);
  });
});
