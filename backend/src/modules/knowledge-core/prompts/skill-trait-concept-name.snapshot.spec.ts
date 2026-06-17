import { describe, expect, it } from 'vitest';

import {
  SKILL_TRAIT_CONCEPT_NAME_SYSTEM_PROMPT,
  SKILL_TRAIT_CONCEPT_NAME_USER_TEMPLATE,
} from './skill-trait-concept-name.prompt';

describe('skill-trait-concept-name — snapshot сборки промпта', () => {
  it('system prompt стабилен (жёсткие правила формулировок)', () => {
    expect(SKILL_TRAIT_CONCEPT_NAME_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('user prompt стабилен для 3 вариантов одной черты', () => {
    const user = SKILL_TRAIT_CONCEPT_NAME_USER_TEMPLATE({
      variants: [
        'осторожен с оценками сроков',
        'не любит давать сроки без данных',
        'откладывает оценку до сбора фактов',
      ],
    });
    expect(user).toMatchSnapshot('user');
  });
});
