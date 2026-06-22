import { describe, expect, it } from 'vitest';

import {
  PROBE_REASON_FALLBACK,
  PROBE_REASON_FALLBACK_DEFAULT,
  PROBE_REASON_LABEL,
  PROBE_REASON_LABEL_DEFAULT,
} from './probe-reason-labels';

describe('probe-reason-labels', () => {
  it('ярлык для известного reason — человеческий рус. текст', () => {
    expect(PROBE_REASON_LABEL['decision.overdue']).toBe('решение просрочено');
    expect(PROBE_REASON_LABEL['regulation.missing_owner']).toBe('у регламента нет ответственного');
  });

  it('ярлык по умолчанию — для незнакомого reason', () => {
    expect(PROBE_REASON_LABEL['unknown.x']).toBeUndefined();
    expect(PROBE_REASON_LABEL_DEFAULT).toBe('требуется уточнение');
  });

  it('fallback-вопрос — готовый человеческий вопрос без кодов', () => {
    const q = PROBE_REASON_FALLBACK['decision.overdue'];
    expect(q).toBeDefined();
    expect(q).not.toContain('decision');
    expect(q!.length).toBeGreaterThan(0);
  });

  it('дефолтный fallback — вежливый запрос уточнения', () => {
    expect(PROBE_REASON_FALLBACK_DEFAULT).toBe('Можете уточнить, пожалуйста?');
  });

  it('Ф6 — attribution.unresolved_at_ingest зарегистрирован (label + fallback)', () => {
    expect(PROBE_REASON_LABEL['attribution.unresolved_at_ingest']).toBe(
      'новая сущность не привязана к отделу/клиенту',
    );
    const q = PROBE_REASON_FALLBACK['attribution.unresolved_at_ingest'];
    expect(q).toBeDefined();
    expect(q!.length).toBeGreaterThan(0);
  });

  it('Блок A Ф1 — task.assignee_unresolved / task.due_date_missing зарегистрированы (label + fallback)', () => {
    expect(PROBE_REASON_LABEL['task.assignee_unresolved']).toBe(
      'у задачи не определён исполнитель',
    );
    expect(PROBE_REASON_LABEL['task.due_date_missing']).toBe(
      'у задачи не указан срок',
    );
    const qAssignee = PROBE_REASON_FALLBACK['task.assignee_unresolved'];
    const qDue = PROBE_REASON_FALLBACK['task.due_date_missing'];
    expect(qAssignee).toBeDefined();
    expect(qAssignee!.length).toBeGreaterThan(0);
    expect(qDue).toBeDefined();
    expect(qDue!.length).toBeGreaterThan(0);
  });

  it('ни один ярлык/вопрос не содержит латиницы (англоязычных слов/кодов)', () => {
    const latin = /[A-Za-z]/;
    for (const v of Object.values(PROBE_REASON_LABEL)) {
      expect(latin.test(v)).toBe(false);
    }
    for (const v of Object.values(PROBE_REASON_FALLBACK)) {
      expect(latin.test(v)).toBe(false);
    }
  });
});
