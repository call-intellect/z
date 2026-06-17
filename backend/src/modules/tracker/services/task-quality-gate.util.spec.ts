import { describe, expect, it } from 'vitest';

import { shouldMaterializeTask } from './task-quality-gate.util';

/**
 * Ф0 (ТЗ 2026-06-16) — объективный детерминированный гейт качества перед
 * созданием задачи из AI-источника. Чистая функция-правила (без LLM, без сети).
 *
 * Acceptance §10 Ф0:
 *   - блок-вопрос без owner → НЕ пропускает (задача не создаётся);
 *   - блок-поручение с owner → пропускает;
 *   - поручение без owner, но со сроком → пропускает;
 *   - решение-источник → пропускает.
 */
describe('shouldMaterializeTask (Ф0 quality gate)', () => {
  it('вопрос без owner и срока (source=meeting) → НЕ пропускает', () => {
    const r = shouldMaterializeTask({
      title: 'Как нам ускорить релиз?',
      ownerUserId: null,
      ownerHint: null,
      dueDate: null,
      source: 'meeting',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('looks_like_question');
  });

  it('вопрос со знаком ? в конце (source=meeting) → НЕ пропускает', () => {
    const r = shouldMaterializeTask({
      title: 'Стоит ли менять подрядчика',
      source: 'meeting',
      ownerHint: 'Иванов',
    });
    // Вопросительный префикс перекрывает наличие owner — это всё ещё вопрос.
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('looks_like_question');
  });

  it('намерение/обсуждение без обязательства (source=meeting) → НЕ пропускает', () => {
    const r = shouldMaterializeTask({
      title: 'Надо бы обсудить новую систему мотивации',
      source: 'meeting',
      dueDate: null,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('looks_like_intent');
  });

  it('поручение с owner (resolved userId, source=meeting) → пропускает', () => {
    const r = shouldMaterializeTask({
      title: 'Подготовить отчёт по продажам',
      ownerUserId: 'u-ivanov',
      dueDate: null,
      source: 'meeting',
    });
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('поручение с owner-hint (ФИО, без userId, source=meeting) → пропускает', () => {
    const r = shouldMaterializeTask({
      title: 'Согласовать макет лендинга',
      ownerUserId: null,
      ownerHint: 'Настя',
      source: 'meeting',
    });
    expect(r.ok).toBe(true);
  });

  it('поручение без owner, но со сроком (Date, source=meeting) → пропускает', () => {
    const r = shouldMaterializeTask({
      title: 'Закрыть квартальные KPI',
      ownerUserId: null,
      ownerHint: null,
      dueDate: new Date('2026-06-30T00:00:00.000Z'),
      source: 'meeting',
    });
    expect(r.ok).toBe(true);
  });

  it('поручение без owner и срока (source=meeting) → НЕ пропускает (no_owner_no_due)', () => {
    const r = shouldMaterializeTask({
      title: 'Доделать интеграцию с платёжкой',
      ownerUserId: null,
      ownerHint: null,
      dueDate: null,
      source: 'meeting',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_owner_no_due');
  });

  it('источник-решение (decision) → пропускает даже без owner/срока и формы', () => {
    const r = shouldMaterializeTask({
      title: 'Перейти на новый CRM',
      ownerUserId: null,
      ownerHint: null,
      dueDate: null,
      source: 'decision',
    });
    expect(r.ok).toBe(true);
  });

  it('telegram self-task без owner/срока → пропускает (отправитель = неявный владелец)', () => {
    const r = shouldMaterializeTask({
      title: 'Замерить и привезти расчёт по Тверской',
      ownerUserId: null,
      ownerHint: null,
      dueDate: null,
      source: 'telegram',
    });
    expect(r.ok).toBe(true);
  });

  it('telegram-вопрос без owner → НЕ пропускает (форм-гейт работает и в осознанных каналах)', () => {
    const r = shouldMaterializeTask({
      title: 'Какие у меня задачи на сегодня?',
      source: 'telegram',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('looks_like_question');
  });

  it('next-step отчёта (meeting_next_step) без owner/срока → пропускает', () => {
    const r = shouldMaterializeTask({
      title: 'Согласовать бюджет с финансами',
      source: 'meeting_next_step',
    });
    expect(r.ok).toBe(true);
  });

  it('пустой title → НЕ пропускает (empty_title), не бросает', () => {
    expect(shouldMaterializeTask({ title: '   ', source: 'meeting' })).toEqual({
      ok: false,
      reason: 'empty_title',
    });
    expect(shouldMaterializeTask({ title: null, source: 'decision' })).toEqual({
      ok: false,
      reason: 'empty_title',
    });
  });
});
