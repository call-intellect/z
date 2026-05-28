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

// CRIT-2 guard: при добавлении нового значения в MeetingType TypeScript
// потребует ключ в этой карте — тест ниже автоматически проверит регистр.
// Без `satisfies Record<MeetingType, true>` забытый enum-value тихо ломал
// бы AI-pipeline (см. plans/analysis/2026-05-22-code-reality-deltas.md §CRIT-2).
const ALL_MEETING_TYPES = {
  team: true,
  standup: true,
  plan_fact: true,
  project: true,
  sales: true,
  custdev: true,
  partner: true,
  interview: true,
  customer_success: true,
  review: true,
  retrospective: true,
  task_discussion: true,
  sprint_review: true,
} satisfies Record<MeetingType, true>;

describe('Prompts registry — все типы MeetingType покрыты', () => {
  const TYPES = Object.keys(ALL_MEETING_TYPES) as MeetingType[];

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

  // CRIT-2 fix (2026-05-24): review/retrospective получили собственные
  // промпты. Тесты ниже фиксируют контракт нового JSON.
  it('review — schema валидирует ожидаемый JSON', () => {
    const d = getPromptForType('review');
    const sample = {
      subject: 'Фича X — обзор перед релизом',
      went_well: ['покрытие тестами 90%'],
      to_improve: ['UI на мобильных требует доработки'],
      risks: ['нагрузочное тестирование не проводилось'],
      next_steps: ['прогнать load test до пятницы'],
      verdict: 'принято с замечаниями',
    };
    const result = d.schema.safeParse(sample);
    expect(result.success).toBe(true);
  });

  it('retrospective — schema валидирует ожидаемый JSON', () => {
    const d = getPromptForType('retrospective');
    const sample = {
      what_worked: ['ежедневные standup'],
      what_did_not_work: ['эстимация затянутая'],
      action_items: [
        { title: 'попробовать planning poker', assignee: 'Алиса', dueDate: null },
      ],
      experiments: ['разбить таск-доску по эпикам'],
      kudos: ['Боб героически выкатил релиз'],
      team_mood: 'mixed',
      mood_notes: 'усталость после релиза, но настроение рабочее',
    };
    const result = d.schema.safeParse(sample);
    expect(result.success).toBe(true);
  });

  it('retrospective — team_mood enum проверяется', () => {
    const d = getPromptForType('retrospective');
    const bad = {
      what_worked: [],
      what_did_not_work: [],
      action_items: [],
      experiments: [],
      kudos: [],
      team_mood: 'awesome', // не в enum
      mood_notes: null,
    };
    const result = d.schema.safeParse(bad);
    expect(result.success).toBe(false);
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
