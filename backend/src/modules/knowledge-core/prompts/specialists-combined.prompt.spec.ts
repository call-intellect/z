import { describe, expect, it } from 'vitest';

import {
  buildSpecialistsCombinedSystemPrompt,
  buildSpecialistsCombinedUserMessage,
  formatBlockForCombined,
  SpecialistsCombinedOutputSchema,
  SPECIALISTS_COMBINED_MAX_TOKENS,
  SPECIALISTS_COMBINED_TASK_TYPE,
  SPECIALISTS_COMBINED_TOOL_NAME,
  SUBMIT_ALL_8_ENTITIES_TOOL,
} from './specialists-combined.prompt';

describe('specialists-combined — константы и tool schema', () => {
  it('константы стабильны (контракт LlmRouter + worker)', () => {
    expect(SPECIALISTS_COMBINED_TASK_TYPE).toBe('knowledge-specialists-combined');
    expect(SPECIALISTS_COMBINED_TOOL_NAME).toBe('submit_all_8_entities');
    expect(SPECIALISTS_COMBINED_MAX_TOKENS).toBe(32_000);
  });

  it('tool schema содержит 8 обязательных массивов и совпадает с эталоном эксперимента', () => {
    expect(SUBMIT_ALL_8_ENTITIES_TOOL.name).toBe(SPECIALISTS_COMBINED_TOOL_NAME);
    expect(SUBMIT_ALL_8_ENTITIES_TOOL.input_schema.type).toBe('object');
    expect(SUBMIT_ALL_8_ENTITIES_TOOL.input_schema.required).toEqual([
      'decisions',
      'ideas',
      'insights',
      'experiments',
      'regulations',
      'knowledge_categories',
      'skill_traits',
      'helpfulness_traits',
    ]);
    expect(SUBMIT_ALL_8_ENTITIES_TOOL.input_schema.additionalProperties).toBe(false);
  });
});

describe('specialists-combined — system prompt snapshot', () => {
  it('system prompt стабилен (8 типов + маршрутизация + жёсткие требования)', () => {
    const prompt = buildSpecialistsCombinedSystemPrompt();
    expect(prompt).toMatchSnapshot('system');
    expect(prompt).toContain('submit_all_8_entities');
    expect(prompt).toContain('decisions[]');
    expect(prompt).toContain('helpfulness_traits[]');
    expect(prompt).toContain('Все строки на русском');
  });
});

describe('specialists-combined — formatBlockForCombined', () => {
  it('сериализует блок в формат из §3.5 ТЗ', () => {
    const result = formatBlockForCombined({
      id: 'blk_006',
      name: 'Поставщик SMS',
      criticalQuestion: 'Какой провайдер SMS выбираем для рассылок?',
      trustedAnswer: 'Выбран SMS Aero вместо Twilio.',
      signalType: 'decision',
      personNames: ['Иван Соколов', 'Анна Мехова'],
      evidence: {
        quote: 'Иван: окей, идём с SMS Aero',
        speaker: 'Иван Соколов',
      },
    });
    expect(result).toMatchSnapshot('block');
    expect(result).toContain('[BLOCK:blk_006]');
    expect(result).toContain('signalType=decision');
    expect(result).toContain('persons=Иван Соколов,Анна Мехова');
    expect(result).toContain('В: Какой провайдер SMS');
    expect(result).toContain('О: Выбран SMS Aero');
  });

  it('подставляет "-" если нет упомянутых персон', () => {
    const result = formatBlockForCombined({
      id: 'blk_007',
      name: 'Факт',
      criticalQuestion: 'Что?',
      trustedAnswer: 'Так.',
      signalType: 'fact',
      personNames: [],
      evidence: { quote: '...', speaker: '—' },
    });
    expect(result).toContain('persons=-');
  });
});

describe('specialists-combined — user message', () => {
  it('содержит заголовок + сериализованные блоки + футер с tool name', () => {
    const user = buildSpecialistsCombinedUserMessage({
      meetingTitle: 'Demo / Sales',
      blocks: [
        {
          id: 'blk_001',
          name: 'Решение',
          criticalQuestion: 'Что выбрали?',
          trustedAnswer: 'Опцию A.',
          signalType: 'decision',
          personNames: ['Анна'],
          evidence: { quote: 'выбираем A', speaker: 'Анна' },
        },
      ],
    });
    expect(user).toMatchSnapshot('user');
    expect(user).toContain('«Demo / Sales»');
    expect(user).toContain('(1 шт)');
    expect(user).toContain('[BLOCK:blk_001]');
    expect(user).toContain('submit_all_8_entities');
  });
});

describe('specialists-combined — zod schema валидирует минимальный valid output', () => {
  it('пустой output (8 пустых массивов) проходит схему', () => {
    const parsed = SpecialistsCombinedOutputSchema.safeParse({
      decisions: [],
      ideas: [],
      insights: [],
      experiments: [],
      regulations: [],
      knowledge_categories: [],
      skill_traits: [],
      helpfulness_traits: [],
    });
    expect(parsed.success).toBe(true);
  });

  it('output с по одному элементу каждого типа проходит схему', () => {
    const parsed = SpecialistsCombinedOutputSchema.safeParse({
      decisions: [
        {
          sourceBlockId: 'blk_1',
          statement: 'Решили X',
          confidence: 0.9,
        },
      ],
      ideas: [
        {
          sourceBlockId: 'blk_2',
          kind: 'internal',
          statement: 'Идея Y',
          confidence: 0.8,
        },
      ],
      insights: [
        {
          sourceBlockId: 'blk_3',
          kind: 'risk',
          statement: 'Риск Z',
          severity: 'high',
          causeCategory: 'process_gap',
          confidence: 0.7,
        },
      ],
      experiments: [
        {
          sourceBlockId: 'blk_4',
          name: 'Эксп A',
          hypothesisText: 'Если X, то Y',
          status: 'running',
          confidence: 0.6,
        },
      ],
      regulations: [
        {
          sourceBlockId: 'blk_5',
          kind: 'regulation',
          name: 'Reg',
          statement: 'Дож-но быть...',
          confidence: 0.85,
        },
      ],
      knowledge_categories: [
        {
          personName: 'Иван',
          category: 'Аналитика BI',
          confidence: 'medium',
        },
      ],
      skill_traits: [
        {
          personName: 'Иван',
          category: 'оценка сроков',
          statement: 'Похоже, склонен переоценивать',
          confidence: 'low',
        },
      ],
      helpfulness_traits: [
        {
          sourceBlockId: 'blk_6',
          traitType: 'mentoring',
          helperUserHint: 'Маша',
          topicHint: 'BullMQ',
          intensity: 0.7,
          evidenceQuote: 'Маша объяснила как…',
          confidence: 0.8,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('output с extra-полем (additionalProperties)', () => {
    const parsed = SpecialistsCombinedOutputSchema.safeParse({
      decisions: [],
      ideas: [],
      insights: [],
      experiments: [],
      regulations: [],
      knowledge_categories: [],
      skill_traits: [],
      helpfulness_traits: [],
      __unexpected: true,
    });
    expect(parsed.success).toBe(false);
  });
});
