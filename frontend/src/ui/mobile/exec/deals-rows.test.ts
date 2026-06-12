/**
 * Юнит-тесты чистой логики экрана «Дела» (мобайл, ТЗ B2/Ф3).
 *
 * Особое внимание — `weekStartMonday`: границы недели, воскресенье (которое
 * должно относиться к ТЕКУЩЕЙ неделе, т.е. предыдущему понедельнику), переход
 * через месяц/год. Плюс агрегат надёжности и ряды «кому помочь»/«молодцы» с
 * проверкой Р4: никаких «провалил/просрочил/не сдал».
 */

import { describe, expect, it } from 'vitest';

import type {
  WeeklyPerPersonUi,
  WeeklyPersonRowUi,
} from '@/domain/weekly-per-person';
import {
  dealsHelpRows,
  dealsReliableRows,
  isDealsEmpty,
  reliabilityTone,
  teamAverageReliabilityPercent,
  weekStartMonday,
} from './deals-rows';

function row(over: Partial<WeeklyPersonRowUi> = {}): WeeklyPersonRowUi {
  return {
    personId: 'p1',
    personName: 'Иван',
    departmentName: null,
    promisesGiven: 0,
    promisesKept: 0,
    promisesBroken: 0,
    promisesOverdue: 0,
    promisesNoAnswer: 0,
    reliabilityPercent: null,
    tasksDone: 0,
    checkInsCompleted: 0,
    reliabilityLabel: '—',
    ...over,
  };
}

function ui(over: Partial<WeeklyPerPersonUi> = {}): WeeklyPerPersonUi {
  return {
    weekStart: '2026-06-08',
    weekEnd: '2026-06-14',
    generatedAt: '2026-06-11T00:00:00.000Z',
    total: 0,
    topReliable: [],
    topRisk: [],
    rows: [],
    ...over,
  };
}

describe('weekStartMonday', () => {
  it('понедельник → сам себя', () => {
    // 2026-06-08 — понедельник.
    expect(weekStartMonday(new Date(2026, 5, 8))).toBe('2026-06-08');
  });

  it('среда → понедельник той же недели', () => {
    // 2026-06-10 — среда.
    expect(weekStartMonday(new Date(2026, 5, 10))).toBe('2026-06-08');
  });

  it('суббота → понедельник той же недели', () => {
    // 2026-06-13 — суббота.
    expect(weekStartMonday(new Date(2026, 5, 13))).toBe('2026-06-08');
  });

  it('ВОСКРЕСЕНЬЕ → понедельник ТЕКУЩЕЙ недели (предыдущий пн), не следующий', () => {
    // 2026-06-14 — воскресенье; ожидаем пн 2026-06-08.
    expect(weekStartMonday(new Date(2026, 5, 14))).toBe('2026-06-08');
  });

  it('переход через границу месяца (вс 1 марта 2026 → пн 23 февраля)', () => {
    // 2026-03-01 — воскресенье; неделя началась 2026-02-23 (пн).
    expect(weekStartMonday(new Date(2026, 2, 1))).toBe('2026-02-23');
  });

  it('переход через границу года (чт 1 января 2026 → пн 29 декабря 2025)', () => {
    // 2026-01-01 — четверг; понедельник недели = 2025-12-29.
    expect(weekStartMonday(new Date(2026, 0, 1))).toBe('2025-12-29');
  });

  it('всегда формат YYYY-MM-DD с ведущими нулями', () => {
    expect(weekStartMonday(new Date(2026, 0, 5))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('teamAverageReliabilityPercent', () => {
  it('среднее по строкам с посчитанной надёжностью', () => {
    const u = ui({
      rows: [
        row({ reliabilityPercent: 80 }),
        row({ reliabilityPercent: 60 }),
        row({ reliabilityPercent: null }), // не учитывается
      ],
    });
    expect(teamAverageReliabilityPercent(u)).toBe(70);
  });

  it('никто не посчитан → null', () => {
    expect(teamAverageReliabilityPercent(ui({ rows: [row()] }))).toBeNull();
  });

  it('null-вход → null', () => {
    expect(teamAverageReliabilityPercent(null)).toBeNull();
  });
});

describe('reliabilityTone', () => {
  it('80 → ok, 65 → warn, 40 → danger, null → neutral', () => {
    expect(reliabilityTone(80)).toBe('ok');
    expect(reliabilityTone(65)).toBe('warn');
    expect(reliabilityTone(40)).toBe('danger');
    expect(reliabilityTone(null)).toBe('neutral');
  });
});

describe('dealsHelpRows (Р4: «кому помочь», без обвинений)', () => {
  it('человек с низкой надёжностью → «нужна помощь · NN%», тон warn, ссылка на персону', () => {
    const u = ui({
      topRisk: [row({ personId: 'p2', personName: 'Пётр', reliabilityPercent: 30 })],
    });
    const rows = dealsHelpRows(u);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Пётр');
    expect(rows[0].meta).toBe('нужна помощь · 30%');
    expect(rows[0].tone).toBe('warn');
    expect(rows[0].href).toBe('/structure/persons/p2');
  });

  it('мало данных → «мало данных, поддержать»', () => {
    const u = ui({
      topRisk: [
        row({ reliabilityPercent: null, promisesKept: 1, promisesBroken: 1 }),
      ],
    });
    expect(dealsHelpRows(u)[0].meta).toBe('мало данных, поддержать');
  });

  it('нет обещаний → строки нет (нечем помогать по надёжности)', () => {
    const u = ui({ topRisk: [row({ reliabilityPercent: null })] });
    expect(dealsHelpRows(u)).toHaveLength(0);
  });

  it('ни одна мета не содержит обвинительных слов', () => {
    const u = ui({
      topRisk: [
        row({ personId: 'a', reliabilityPercent: 10 }),
        row({ personId: 'b', reliabilityPercent: null, promisesBroken: 2 }),
      ],
    });
    const joined = dealsHelpRows(u)
      .map((r) => `${r.title} ${r.meta ?? ''}`)
      .join(' ');
    expect(joined).not.toMatch(/провалил|просрочил|не сдал/i);
  });
});

describe('dealsReliableRows (позитив)', () => {
  it('только люди с реальным процентом, тон ok', () => {
    const u = ui({
      topReliable: [
        row({ personId: 'x', personName: 'Анна', reliabilityPercent: 95 }),
        row({ personId: 'y', reliabilityPercent: null }), // отсеивается
      ],
    });
    const rows = dealsReliableRows(u);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Анна');
    expect(rows[0].meta).toBe('95%');
    expect(rows[0].tone).toBe('ok');
  });
});

describe('isDealsEmpty', () => {
  it('null → true; total=0 и нет строк → true; есть строки → false', () => {
    expect(isDealsEmpty(null)).toBe(true);
    expect(isDealsEmpty(ui())).toBe(true);
    expect(isDealsEmpty(ui({ total: 1, rows: [row()] }))).toBe(false);
  });
});
