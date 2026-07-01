import { describe, expect, it } from 'vitest';

import {
  WEEK_COMPANY_PROMPT_VERSION,
  WEEK_LETTER_KEYS,
  WeekCompanyResponseSchema,
  buildWeekCompanyUserMessage,
  type WeekCompanyPackage,
  type WeekCompanyPackageDay,
} from './weekly-digest.prompt';

function validWeekResponse() {
  return {
    verdict: {
      overall: {
        state: 'warn',
        emoji: '⚠️',
        title: 'Неделя ушла вправо',
        oneLiner: 'Клиент на грани всю неделю.',
      },
      axes: [
        { key: 'team', state: 'warn', label: 'Дисциплина проседает', why: 'Отчёт 3 из 6' },
        { key: 'clients', state: 'risk', label: 'Риск ухода', why: 'Молочные реки молчат' },
        { key: 'execution', state: 'warn', label: 'Один блокер', why: 'Оплата не снята' },
        { key: 'overall', state: 'warn', label: 'На одном человеке', why: 'Всё на владельце' },
      ],
    },
    letter: [
      { key: 'intro', title: 'Интро', prose: 'Сергей, коротко — неделя ушла вправо.' },
      { key: 'main', title: 'Главное за неделю', prose: 'Клиент на грани, блокер оплаты держался.' },
      { key: 'attention', title: 'На что обратить внимание', prose: 'Петля с прошлой недели.' },
      { key: 'reflection', title: 'Взгляд COO', prose: 'Неделя держится на одном человеке.' },
    ],
    goalAlignmentWeek: {
      direction: 'drift',
      score: 48,
      weekDelta: '+3 теста из 10',
      why: 'Три теста запущены, но темп съедает блокер.',
      pro: ['запущены 3 теста'],
      contra: ['блокер оплаты держался всю неделю'],
    },
    risksSummary: 'Риск ухода клиента и незаменимость владельца.',
    ideasSummary: 'Две новые идеи от команды.',
  };
}

function makeDay(dateLocal: string, prose: string): WeekCompanyPackageDay {
  return {
    dateLocal,
    overallState: 'warn',
    title: 'День с трением',
    shortSummary: 'Резюме дня.',
    axes: [
      { key: 'team', state: 'warn' },
      { key: 'clients', state: 'risk' },
      { key: 'execution', state: 'warn' },
      { key: 'overall', state: 'warn' },
    ],
    letter: [
      { key: 'intro', title: 'Интро', prose },
      { key: 'main', title: 'Главное за день', prose: 'Клиент на грани, блокер оплаты.' },
    ],
  };
}

function makePackage(days: WeekCompanyPackageDay[]): WeekCompanyPackage {
  return {
    weekStart: '2026-06-22',
    weekEnd: '2026-06-26',
    goalId: null,
    goalName: null,
    days,
    team: { tasksDone: 34, tasksPlanned: 51, tasksNotDone: 17 },
    repeatedBlockers: [],
    repeatedRisks: [],
    compass: null,
    prevWeek: null,
    missingDays: [],
  };
}

describe('WeekCompanyResponseSchema (v2)', () => {
  it('версия промпта — week-company-v2', () => {
    expect(WEEK_COMPANY_PROMPT_VERSION).toBe('week-company-v2');
  });

  it('WEEK_LETTER_KEYS — ровно 12 ключей дня (intro..reflection)', () => {
    expect(WEEK_LETTER_KEYS.length).toBe(12);
    for (const k of [
      'intro',
      'main',
      'done',
      'not_done',
      'reporting',
      'blocked',
      'clients',
      'ideas',
      'attention',
      'actions',
      'delta',
      'reflection',
    ]) {
      expect(WEEK_LETTER_KEYS).toContain(k as (typeof WEEK_LETTER_KEYS)[number]);
    }
  });

  it('валидный ответ с letter-секцией key=intro ⇒ success', () => {
    const parsed = WeekCompanyResponseSchema.safeParse(validWeekResponse());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const keys = parsed.data.letter.map((s) => s.key);
      expect(keys).toContain('intro');
    }
  });

  it('секция с неизвестным key=decisions ⇒ строгий enum отклоняет (success=false)', () => {
    const broken = validWeekResponse();
    broken.letter.push({ key: 'decisions', title: 'Решения', prose: 'Что-то.' });
    const parsed = WeekCompanyResponseSchema.safeParse(broken);
    expect(parsed.success).toBe(false);
  });
});

describe('buildWeekCompanyUserMessage — полные дневные письма', () => {
  it('включает тексты дневных писем при непустом letter', () => {
    const pkg = makePackage([
      makeDay('2026-06-22', 'Понедельник: клиент на грани, блокер оплаты.'),
      makeDay('2026-06-23', 'Вторник: интеграция стоит на оплате коннекторов.'),
    ]);
    const msg = buildWeekCompanyUserMessage(pkg);
    expect(msg).toContain('Полные дневные письма недели');
    expect(msg).toContain('Понедельник: клиент на грани, блокер оплаты.');
    expect(msg).toContain('Вторник: интеграция стоит на оплате коннекторов.');
  });

  it('при мизерном бюджете длинные письма опускаются', () => {
    const pkg = makePackage([
      makeDay('2026-06-22', 'Очень длинное письмо понедельника про клиента и блокеры оплаты.'),
      makeDay('2026-06-23', 'Очень длинное письмо вторника про интеграцию и коннекторы.'),
    ]);
    const msg = buildWeekCompanyUserMessage(pkg, 10);
    const omitted = msg.includes('часть дневных писем опущена');
    const noLetters =
      !msg.includes('Очень длинное письмо понедельника') &&
      !msg.includes('Очень длинное письмо вторника');
    expect(omitted || noLetters).toBe(true);
  });
});
