import { describe, expect, it } from 'vitest';

import {
  DAY_COMPANY_PROMPT_VERSION,
  DayCompanyResponseSchema,
} from './daily-digest.prompt';

function validV2Response() {
  return {
    verdict: {
      overall: { state: 'warn', emoji: '⚠️', title: 'День с трением', oneLiner: 'Клиент на грани.' },
      axes: [
        { key: 'team', state: 'warn', label: 'Дисциплина просела', why: 'Спор поддержки и продаж за клиента' },
        { key: 'clients', state: 'risk', label: 'Риск ухода', why: 'Молочные реки молчат >суток' },
        { key: 'execution', state: 'warn', label: 'Буксует', why: 'Блокер оплаты 6 дней' },
        { key: 'overall', state: 'warn', label: 'Держится на одном', why: 'Всё замкнуто на владельце' },
      ],
    },
    letter: [
      { key: 'intro', title: 'Интро', prose: 'Сергей, коротко — день с трением.' },
      { key: 'main', title: 'Главное за день', prose: 'Клиент на грани, блокер оплаты не снят.' },
      { key: 'attention', title: 'На что обратить внимание', prose: 'Петля со вчера: сигнал не закрыт.' },
      { key: 'reflection', title: 'Взгляд COO', prose: 'День держится на одном человеке.' },
    ],
    goalAlignmentDay: {
      direction: 'drift',
      score: 46,
      todayDelta: '+1 тест из 10',
      why: 'Первый тест запущен, но темп съедает блокер.',
      pro: ['запущен 1-й тест'],
      contra: ['блокер оплаты не снят'],
    },
    risksSummary: 'Риск ухода клиента и незаменимость владельца.',
    ideasSummary: 'Две новые идеи от команды.',
  };
}

describe('DayCompanyResponseSchema (v2)', () => {
  it('версия промпта — day-company-v2', () => {
    expect(DAY_COMPANY_PROMPT_VERSION).toBe('day-company-v2');
  });

  it('валидный v2-ответ с ключами intro/attention/reflection ⇒ success', () => {
    const parsed = DayCompanyResponseSchema.safeParse(validV2Response());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const keys = parsed.data.letter.map((s) => s.key);
      expect(keys).toContain('intro');
      expect(keys).toContain('attention');
      expect(keys).toContain('reflection');
    }
  });

  it('секция с неизвестным key=decisions ⇒ строгий enum отклоняет (success=false)', () => {
    const broken = validV2Response();
    broken.letter.push({ key: 'decisions', title: 'Решения', prose: 'Что-то.' });
    const parsed = DayCompanyResponseSchema.safeParse(broken);
    expect(parsed.success).toBe(false);
  });

  it('ось team с why про конфликт ⇒ парсится (why — свободная строка)', () => {
    const withConflict = validV2Response();
    withConflict.verdict.axes[0] = {
      key: 'team',
      state: 'risk',
      label: 'Конфликт',
      why: 'Открытый конфликт между поддержкой и продажами за ведение клиента после сделки',
    };
    const parsed = DayCompanyResponseSchema.safeParse(withConflict);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const team = parsed.data.verdict.axes.find((a) => a.key === 'team')!;
      expect(team.why).toContain('конфликт');
    }
  });
});
