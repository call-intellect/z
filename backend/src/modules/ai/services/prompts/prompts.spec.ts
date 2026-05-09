import type { MeetingType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { getPromptForType, typeNeedsFollowUp, typeNeedsTasks } from './index';

const SAMPLE_DIALOG = [
  { speaker: 'Алиса', text: 'Привет, как дела с проектом?', startSec: 0, endSec: 3 },
  { speaker: 'Боб', text: 'Идёт по плану, готовим релиз к пятнице.', startSec: 3.5, endSec: 8 },
];

function meeting(type: MeetingType) {
  return {
    id: 'm-1',
    title: 'Sample',
    type,
    startedAt: new Date(),
    endedAt: new Date(),
    customPrompt: null,
  };
}

describe('Prompts registry — все 9 типов', () => {
  const TYPES: MeetingType[] = [
    'team',
    'standup',
    'plan_fact',
    'project',
    'sales',
    'custdev',
    'partner',
    'interview',
    'customer_success',
  ];

  for (const t of TYPES) {
    describe(`type=${t}`, () => {
      const descriptor = getPromptForType(t);

      it('buildPrompt возвращает system+user', () => {
        const out = descriptor.buildPrompt({
          meeting: meeting(t),
          dialog: SAMPLE_DIALOG,
        });
        expect(out.system.length).toBeGreaterThan(20);
        expect(out.user).toContain('Диалог:');
        expect(out.user).toContain('Алиса');
      });

      it('tool имеет правильное имя', () => {
        expect(descriptor.tool.name).toBe(descriptor.toolName);
        expect(descriptor.tool.input_schema.type).toBe('object');
      });

      it('schema валидирует мусор как fail', () => {
        const result = descriptor.schema.safeParse({ totally_wrong: 'data' });
        expect(result.success).toBe(false);
      });
    });
  }

  it('sales — schema валидирует ожидаемый JSON', () => {
    const d = getPromptForType('sales');
    const sample = {
      pain: 'Долго закрываются сделки',
      interest_level: 'high',
      objections: ['дорого', 'есть свой'],
      budget: '500k',
      decision_maker: 'CEO',
      urgency: 'квартал',
      next_step: 'отправить КП',
    };
    const result = d.schema.safeParse(sample);
    expect(result.success).toBe(true);
  });

  it('team — schema валидирует ожидаемый JSON', () => {
    const d = getPromptForType('team');
    const sample = {
      discussed: ['релиз'],
      decisions: ['выпускаем в пятницу'],
      tasks: [{ title: 'починить баг X', assignee: 'Боб', dueDate: null }],
      blockers: [],
      next_step: 'тестируем в четверг',
    };
    const result = d.schema.safeParse(sample);
    expect(result.success).toBe(true);
  });

  it('typeNeedsFollowUp / typeNeedsTasks', () => {
    expect(typeNeedsFollowUp('sales')).toBe(true);
    expect(typeNeedsFollowUp('customer_success')).toBe(true);
    expect(typeNeedsFollowUp('team')).toBe(false);

    expect(typeNeedsTasks('team')).toBe(true);
    expect(typeNeedsTasks('standup')).toBe(true);
    expect(typeNeedsTasks('plan_fact')).toBe(true);
    expect(typeNeedsTasks('project')).toBe(true);
    expect(typeNeedsTasks('sales')).toBe(false);
  });
});
