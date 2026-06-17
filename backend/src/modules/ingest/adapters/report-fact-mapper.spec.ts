import { describe, expect, it } from 'vitest';

import { mapStructuredToReportFacts } from './report-fact-mapper';

describe('mapStructuredToReportFacts (Фаза 2)', () => {
  it('sales: pain→pain, objections[]→risk, competitors[]→summary_point, next_step→next_step, main_blocker→blocker', () => {
    const facts = mapStructuredToReportFacts('sales', {
      pain: 'Теряют заявки',
      interest_level: 'high',
      objections: ['Дорого', 'Уже есть похожее'],
      budget: '400к',
      decision_maker: 'Финдир',
      urgency: 'к четвергу',
      next_step: 'дождаться ответа',
      competitors: ['КонкурентА'],
      main_blocker: 'Бюджет не утверждён',
      data_quality: null,
    });

    expect(facts).toContainEqual({ reportKind: 'pain', text: 'Теряют заявки' });
    expect(facts).toContainEqual({ reportKind: 'risk', text: 'Дорого' });
    expect(facts).toContainEqual({ reportKind: 'risk', text: 'Уже есть похожее' });
    expect(facts).toContainEqual({
      reportKind: 'summary_point',
      text: 'КонкурентА',
    });
    expect(facts).toContainEqual({
      reportKind: 'next_step',
      text: 'дождаться ответа',
    });
    expect(facts).toContainEqual({
      reportKind: 'blocker',
      text: 'Бюджет не утверждён',
    });
    expect(facts.some((f) => f.text === '400к')).toBe(false);
    expect(facts.some((f) => f.text === 'Финдир')).toBe(false);
  });

  it('sales: pain=null и main_blocker=null → эти факты не создаются', () => {
    const facts = mapStructuredToReportFacts('sales', {
      pain: null,
      objections: [],
      next_step: 'уточнить шаг',
      main_blocker: null,
    });
    expect(facts.some((f) => f.reportKind === 'pain')).toBe(false);
    expect(facts.some((f) => f.reportKind === 'blocker')).toBe(false);
    expect(facts).toContainEqual({ reportKind: 'next_step', text: 'уточнить шаг' });
  });

  it('team: decisions[]{text,speaker}→decision со speaker, blockers[]→blocker, tasks[]{title}→task, next_step→next_step', () => {
    const facts = mapStructuredToReportFacts('team', {
      discussed: ['тема1'],
      decisions: [
        { text: 'Переходим на новый стек', speaker: 'Алиса', changes_what: 'архитектура' },
        { text: 'Откладываем фичу', speaker: null, changes_what: null },
      ],
      tasks: [{ title: 'Написать ТЗ', assignee: 'Боб', dueDate: null }],
      blockers: ['Нет доступа к проду'],
      next_step: 'собраться в пятницу',
    });

    expect(facts).toContainEqual({
      reportKind: 'decision',
      text: 'Переходим на новый стек',
      speaker: 'Алиса',
    });
    expect(facts).toContainEqual({
      reportKind: 'decision',
      text: 'Откладываем фичу',
    });
    expect(facts).toContainEqual({
      reportKind: 'blocker',
      text: 'Нет доступа к проду',
    });
    expect(facts).toContainEqual({ reportKind: 'task', text: 'Написать ТЗ' });
    expect(facts).toContainEqual({
      reportKind: 'next_step',
      text: 'собраться в пятницу',
    });
    expect(facts.some((f) => f.text === 'тема1')).toBe(false);
  });

  it('standup: decisions_needed[]→decision, blockers[]→blocker, new_tasks[]→task, priorities[]→summary_point', () => {
    const facts = mapStructuredToReportFacts('standup', {
      priorities: ['Релиз'],
      who_does_what: [{ person: 'Алиса', doing: 'кодит' }],
      new_tasks: ['Поправить баг'],
      blockers: ['CI красный'],
      decisions_needed: ['Кто пушит в прод'],
      next_checkpoint: null,
    });

    expect(facts).toContainEqual({ reportKind: 'decision', text: 'Кто пушит в прод' });
    expect(facts).toContainEqual({ reportKind: 'blocker', text: 'CI красный' });
    expect(facts).toContainEqual({ reportKind: 'task', text: 'Поправить баг' });
    expect(facts).toContainEqual({ reportKind: 'summary_point', text: 'Релиз' });
    expect(facts.some((f) => f.text === 'кодит')).toBe(false);
  });

  it('review: risks[]→risk, decisions[]→decision, to_improve[]→summary_point, next_steps[]→next_step', () => {
    const facts = mapStructuredToReportFacts('review', {
      subject: 'Спринт 12',
      went_well: ['успели'],
      to_improve: ['Меньше отвлекаться'],
      risks: ['Сроки следующего цикла'],
      next_steps: ['Запланировать ретро'],
      verdict: 'ок',
      decisions: ['Принять фичу X'],
    });

    expect(facts).toContainEqual({
      reportKind: 'risk',
      text: 'Сроки следующего цикла',
    });
    expect(facts).toContainEqual({
      reportKind: 'decision',
      text: 'Принять фичу X',
    });
    expect(facts).toContainEqual({
      reportKind: 'summary_point',
      text: 'Меньше отвлекаться',
    });
    expect(facts).toContainEqual({
      reportKind: 'next_step',
      text: 'Запланировать ретро',
    });
    expect(facts.some((f) => f.text === 'успели')).toBe(false);
  });

  it('graceful: неизвестный тип встречи → пустой массив (не бросает)', () => {
    expect(mapStructuredToReportFacts('customer_success', { pain: 'x' })).toEqual([]);
    expect(mapStructuredToReportFacts('task_discussion', { decisions: [] })).toEqual([]);
  });

  it('graceful: null/невалидный structuredData → пустой массив', () => {
    expect(mapStructuredToReportFacts('sales', null)).toEqual([]);
    expect(mapStructuredToReportFacts('sales', undefined)).toEqual([]);
    expect(mapStructuredToReportFacts('sales', 'строка')).toEqual([]);
    expect(mapStructuredToReportFacts('sales', [])).toEqual([]);
    expect(mapStructuredToReportFacts(null, { pain: 'x' })).toEqual([]);
  });

  it('D6: client_protocol_md (и его подстрока) НЕ попадает в факты при type=sales', () => {
    const protocolText =
      'Нейтральный протокол для клиента: обсудили продукт, договорились созвониться.';
    const facts = mapStructuredToReportFacts('sales', {
      pain: 'Теряют заявки',
      objections: ['Дорого'],
      next_step: 'дождаться ответа',
      client_protocol_md: protocolText,
    });

    for (const f of facts) {
      expect(f.text).not.toContain('Нейтральный протокол');
      expect(f.text).not.toContain('client_protocol');
      expect(f.text).not.toContain(protocolText);
    }
    expect(facts).toContainEqual({ reportKind: 'pain', text: 'Теряют заявки' });
    expect(facts).toContainEqual({ reportKind: 'risk', text: 'Дорого' });
  });
});
