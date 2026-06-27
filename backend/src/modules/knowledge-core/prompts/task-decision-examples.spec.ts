import { describe, expect, it } from 'vitest';

import {
  TASK_VS_DECISION_PAIRS,
  renderExamplesForDecisionExtractor,
  renderExamplesForIdeaExtractor,
  renderExamplesForTaskExtractor,
  renderRuleForBlockIngest,
} from './task-decision-examples';

describe('task-decision-examples — три полюса (идея / задача / решение)', () => {
  it('каждая запись имеет непустые idea, task, decision', () => {
    for (const p of TASK_VS_DECISION_PAIRS) {
      expect(p.idea.trim().length).toBeGreaterThan(0);
      expect(p.task.trim().length).toBeGreaterThan(0);
      expect(p.decision.trim().length).toBeGreaterThan(0);
    }
  });

  it('idea-экстрактор показывает полюс идеи и полюс решения', () => {
    const first = TASK_VS_DECISION_PAIRS[0];
    expect(first).toBeDefined();
    const rendered = renderExamplesForIdeaExtractor();
    expect(rendered).toContain('ИДЕЯ (isIdea=true)');
    expect(rendered).toContain(first!.idea);
    expect(rendered).toContain('РЕШЕНИЕ (isIdea=false)');
  });

  it('decision-экстрактор показывает полюс идеи и полюс решения', () => {
    const rendered = renderExamplesForDecisionExtractor();
    expect(rendered).toContain('ИДЕЯ/ПРЕДЛОЖЕНИЕ (isDecision=false)');
    expect(rendered).toContain('РЕШЕНИЕ (isDecision=true)');
  });

  it('task-экстрактор показывает полюс идеи', () => {
    expect(renderExamplesForTaskExtractor()).toContain('ИДЕЯ (isTask=false)');
  });

  it('block-ingest правило содержит классификацию signalType=idea', () => {
    expect(renderRuleForBlockIngest()).toContain('signalType=idea');
  });

  it('регресс: decision-экстрактор сохраняет полюс задачи', () => {
    expect(renderExamplesForDecisionExtractor()).toContain(
      'ЗАДАЧА/ПОРУЧЕНИЕ (isDecision=false)',
    );
  });

  it('регресс: block-ingest правило сохраняет signalType=action_item', () => {
    expect(renderRuleForBlockIngest()).toContain('signalType=action_item');
  });
});
