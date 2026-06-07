import { describe, expect, it } from 'vitest';

import {
  ASR_NOTE,
  EDGE_CASE_POLICY,
  Z_GLOBAL_PREAMBLE,
  formatOrgContextForPrompt,
  withAsrNote,
  withEdgeCasePolicy,
  withOrgContextNote,
  withZPreamble,
} from './common';

describe('withZPreamble', () => {
  const SYSTEM = 'Ты — knowledge-инженер. Извлеки сущности.';

  it('добавляет preamble в начало system-промпта', () => {
    const out = withZPreamble(SYSTEM);
    expect(out.startsWith(Z_GLOBAL_PREAMBLE)).toBe(true);
    expect(out).toContain(SYSTEM);
    expect(out.indexOf(Z_GLOBAL_PREAMBLE)).toBeLessThan(out.indexOf(SYSTEM));
  });

  it('preamble упоминает Кора / русский / injection-guard', () => {
    // 2026-05-29 ребренд Z → Кора: имя продукта в preamble — «Кора»
    // (имя бренда Z сохранилось только в имени константы `Z_GLOBAL_PREAMBLE`
    // и функции `withZPreamble`, что отражает внутренний код-неминг).
    expect(Z_GLOBAL_PREAMBLE).toContain('Кора');
    expect(Z_GLOBAL_PREAMBLE).toContain('русском');
    // Ссылка на маркеры USER_DATA_BEGIN — защита от prompt-injection.
    expect(Z_GLOBAL_PREAMBLE).toContain('USER_DATA_BEGIN');
    expect(Z_GLOBAL_PREAMBLE.toLowerCase()).toContain('игнорируй');
  });

  it('preamble и system разделены пустой строкой', () => {
    const out = withZPreamble('BODY');
    expect(out).toBe(`${Z_GLOBAL_PREAMBLE}\n\nBODY`);
  });
});

describe('withEdgeCasePolicy', () => {
  const SYSTEM = 'Ты — knowledge-инженер. Извлеки решение из блока.';

  it('добавляет политику в конец system-промпта', () => {
    const out = withEdgeCasePolicy(SYSTEM);
    expect(out.startsWith(SYSTEM)).toBe(true);
    expect(out).toContain(EDGE_CASE_POLICY);
    expect(out.indexOf(EDGE_CASE_POLICY)).toBeGreaterThan(0);
  });

  it('политика покрывает три ключевых кейса (пустой/противоречие/относительные сроки)', () => {
    expect(EDGE_CASE_POLICY).toContain('Пустой');
    expect(EDGE_CASE_POLICY).toContain('недостаточно сигнала');
    expect(EDGE_CASE_POLICY).toContain('Противоречие');
    expect(EDGE_CASE_POLICY).toContain('confidence');
    expect(EDGE_CASE_POLICY).toContain('Относительные сроки');
    expect(EDGE_CASE_POLICY).toContain('ISO-8601');
    expect(EDGE_CASE_POLICY).toContain('meetingDateIso');
  });

  it('двойной вызов не теряет тело system (хоть и не идемпотентен по содержанию)', () => {
    const once = withEdgeCasePolicy(SYSTEM);
    const twice = withEdgeCasePolicy(once);
    expect(twice).toContain(SYSTEM);
    // Политика повторилась — это ожидаемо (helper не самоидемпотентен), но
    // система не сломалась. Зафиксируем поведение тестом, чтобы случайная
    // оптимизация в виде «уберём дубль» не прошла без явного решения.
    const count = twice.split(EDGE_CASE_POLICY).length - 1;
    expect(count).toBe(2);
  });
});

describe('withAsrNote', () => {
  const SYSTEM = 'Ты — деловой ассистент. Составь summary встречи.';

  it('дописывает ASR_NOTE в КОНЕЦ system-промпта', () => {
    const out = withAsrNote(SYSTEM);
    // Нота — самый последний блок (cache-friendly суффикс).
    expect(out.endsWith(ASR_NOTE)).toBe(true);
    expect(out).toContain(ASR_NOTE);
    expect(out.indexOf(ASR_NOTE)).toBeGreaterThan(0);
  });

  it('исходный system-префикс не изменён (cache-friendly)', () => {
    const out = withAsrNote(SYSTEM);
    // Стабильный SYSTEM в начале — кэш промпта не ломается.
    expect(out.startsWith(SYSTEM)).toBe(true);
    expect(out).toBe(`${SYSTEM}\n\n${ASR_NOTE}`);
  });

  it('нота покрывает ключевые правила (ASR / числа-имена / контекст / не выдумывать)', () => {
    expect(ASR_NOTE).toContain('ASR');
    expect(ASR_NOTE).toContain('распознавания речи');
    expect(ASR_NOTE.toLowerCase()).toContain('числ');
    expect(ASR_NOTE).toContain('контекст');
    expect(ASR_NOTE).toContain('Не выдумывай');
  });
});

describe('formatOrgContextForPrompt', () => {
  it('пустой ctx → пустая строка', () => {
    expect(formatOrgContextForPrompt({})).toBe('');
    expect(
      formatOrgContextForPrompt({ projects: [], goals: [], people: [] }),
    ).toBe('');
  });

  it('проект с identifier → "name (identifier)", без identifier → name', () => {
    const out = formatOrgContextForPrompt({
      projects: [
        { identifier: 'DEV', name: 'Команда разработки' },
        { identifier: null, name: 'Маркетинг' },
      ],
    });
    expect(out).toBe('Проекты компании: Команда разработки (DEV), Маркетинг.');
  });

  it('цели и сотрудники — отдельными строками', () => {
    const out = formatOrgContextForPrompt({
      goals: [{ name: 'Запуск v2' }, { name: 'Рост MRR' }],
      people: [{ name: 'Иванов Сергей' }, { name: 'Петров Олег' }],
    });
    expect(out).toContain('Активные цели: Запуск v2, Рост MRR.');
    expect(out).toContain('Сотрудники: Иванов Сергей, Петров Олег.');
  });
});

describe('withOrgContextNote', () => {
  const SYSTEM = 'Ты — деловой ассистент. Составь summary встречи.';

  it('пустой ctx → возвращает system без изменений (no-op)', () => {
    expect(withOrgContextNote(SYSTEM, {})).toBe(SYSTEM);
    expect(
      withOrgContextNote(SYSTEM, { projects: [], goals: [], people: [] }),
    ).toBe(SYSTEM);
  });

  it('непустой ctx → дописывает блок в КОНЕЦ, system-префикс не изменён', () => {
    const out = withOrgContextNote(SYSTEM, {
      projects: [{ identifier: 'DEV', name: 'Команда разработки' }],
      people: [{ name: 'Иванов Сергей' }],
    });
    // Стабильный SYSTEM-префикс остаётся в начале (cache-friendly).
    expect(out.startsWith(SYSTEM)).toBe(true);
    expect(out).toContain('Контекст компании');
    expect(out).toContain('Проекты компании: Команда разработки (DEV).');
    expect(out).toContain('Сотрудники: Иванов Сергей.');
    expect(out.length).toBeGreaterThan(SYSTEM.length);
  });
});
