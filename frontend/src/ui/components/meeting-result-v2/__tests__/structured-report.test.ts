import { describe, expect, it } from 'vitest';

import {
  isEmptyStructuredValue,
  structuredFieldLabel,
  structuredReportToMarkdown,
  structuredReportToPlainText,
  structuredValueToMarkdown,
} from '../structured-report';

describe('structuredFieldLabel', () => {
  it('маппит известные ключи на русские заголовки', () => {
    expect(structuredFieldLabel('tasks')).toBe('Задачи');
    expect(structuredFieldLabel('next_step')).toBe('Следующий шаг');
    expect(structuredFieldLabel('blockers')).toBe('Блокеры');
  });

  it('маппит новые ключи отчёта (B1.1)', () => {
    expect(structuredFieldLabel('ideas')).toBe('Идеи');
    expect(structuredFieldLabel('proposals')).toBe('Предложения');
    expect(structuredFieldLabel('data_quality')).toBe('Качество данных');
    expect(structuredFieldLabel('competitors')).toBe('Конкуренты');
    expect(structuredFieldLabel('competitors_mentioned')).toBe('Упомянутые конкуренты');
    expect(structuredFieldLabel('decision_criteria')).toBe('Критерии выбора');
    expect(structuredFieldLabel('what_hooked')).toBe('Что зацепило');
    expect(structuredFieldLabel('main_blocker')).toBe('Главный блокер');
    expect(structuredFieldLabel('churn_risk_quote')).toBe('Цитата риска оттока');
    expect(structuredFieldLabel('recurring_problems')).toBe('Повторяющиеся проблемы');
    expect(structuredFieldLabel('unexplained_gaps')).toBe('Без объяснённой причины');
    expect(structuredFieldLabel('competing_offers')).toBe('Другие офферы');
    expect(structuredFieldLabel('responsibilities')).toBe('Ответственности');
    expect(structuredFieldLabel('not_done')).toBe('Не сделано');
  });

  it('неизвестный snake_case → «Snake case»', () => {
    expect(structuredFieldLabel('foo_bar')).toBe('Foo bar');
  });

  it('пустую строку возвращает как есть (сам key)', () => {
    expect(structuredFieldLabel('')).toBe('');
  });
});

describe('isEmptyStructuredValue', () => {
  it('null/undefined/пустая строка/пробелы/[]/{} → true', () => {
    expect(isEmptyStructuredValue(null)).toBe(true);
    expect(isEmptyStructuredValue(undefined)).toBe(true);
    expect(isEmptyStructuredValue('')).toBe(true);
    expect(isEmptyStructuredValue('   ')).toBe(true);
    expect(isEmptyStructuredValue([])).toBe(true);
    expect(isEmptyStructuredValue({})).toBe(true);
  });

  it('непустые значения → false (включая 0 и false)', () => {
    expect(isEmptyStructuredValue('x')).toBe(false);
    expect(isEmptyStructuredValue(0)).toBe(false);
    expect(isEmptyStructuredValue(false)).toBe(false);
    expect(isEmptyStructuredValue([1])).toBe(false);
    expect(isEmptyStructuredValue({ a: 1 })).toBe(false);
  });
});

describe('structuredValueToMarkdown', () => {
  it('массив строк → список «- item»', () => {
    expect(structuredValueToMarkdown(['Б', 'В'])).toBe('- Б\n- В');
  });

  it('массив объектов → «- main — meta»', () => {
    expect(
      structuredValueToMarkdown([{ title: 'A', assignee: 'Иван' }]),
    ).toBe('- A — Иван');
  });

  it('вложенный объект → «**Подпись**: значение» по непустым полям', () => {
    const md = structuredValueToMarkdown({ budget: '100', objections: '' });
    expect(md).toContain('**Бюджет**: 100');
    expect(md).not.toContain('Возражения');
  });

  it('примитив → как есть', () => {
    expect(structuredValueToMarkdown('текст')).toBe('текст');
    expect(structuredValueToMarkdown(0)).toBe('0');
  });

  it('objectMainText берёт item (not_done) и what (responsibilities) — B1.3', () => {
    expect(structuredValueToMarkdown([{ item: 'Не настроили CRM' }])).toBe(
      '- Не настроили CRM',
    );
    expect(structuredValueToMarkdown([{ what: 'Ведёт отчётность' }])).toBe(
      '- Ведёт отчётность',
    );
  });

  it('objectMeta: decisions{speaker, changes_what} — B1.3', () => {
    const md = structuredValueToMarkdown([
      { text: 'Запускаем пилот', speaker: 'Иван', changes_what: 'сроки' },
    ]);
    expect(md).toContain('- Запускаем пилот');
    expect(md).toContain('спикер: Иван');
    expect(md).toContain('меняет: сроки');
  });

  it('objectMeta: not_done{responsible, reason} — B1.3', () => {
    const md = structuredValueToMarkdown([
      { item: 'Не отправили КП', responsible: 'Пётр', reason: 'ждали данные' },
    ]);
    expect(md).toContain('- Не отправили КП');
    expect(md).toContain('ответственный: Пётр');
    expect(md).toContain('причина: ждали данные');
  });

  it('objectMeta: agreements{speaker, supersedes} — B1.3', () => {
    const md = structuredValueToMarkdown([
      { text: 'Скидка 10%', speaker: 'Анна', supersedes: 'прошлый оффер' },
    ]);
    expect(md).toContain('- Скидка 10%');
    expect(md).toContain('спикер: Анна');
    expect(md).toContain('заменяет: прошлый оффер');
  });

  it('objectMeta: responsibilities{who, what, deadline} — B1.3', () => {
    const md = structuredValueToMarkdown([
      { who: 'Маркетолог', what: 'лендинг', deadline: 'пятница' },
    ]);
    // what используется как главный текст
    expect(md).toContain('- лендинг');
    expect(md).toContain('кто: Маркетолог');
    expect(md).toContain('срок: пятница');
  });

  it('objectMeta скрывает пустые поля', () => {
    expect(structuredValueToMarkdown([{ text: 'A', speaker: '' }])).toBe('- A');
  });
});

describe('новые объекты отчёта не падают при сериализации (B1.2/B1.3)', () => {
  it('data_quality/churn_risk_quote/ideas как top-level ключи попадают в markdown', () => {
    const md = structuredReportToMarkdown(
      {
        data_quality: 'Транскрипт полный, спикеры размечены',
        churn_risk_quote: 'Мы почти ушли к конкуренту',
        ideas: ['Добавить онбординг', 'Сделать дайджест'],
      },
      'Отчёт',
    );
    expect(md).toContain('## Качество данных');
    expect(md).toContain('Транскрипт полный');
    expect(md).toContain('## Цитата риска оттока');
    expect(md).toContain('Мы почти ушли к конкуренту');
    expect(md).toContain('## Идеи');
    expect(md).toContain('- Добавить онбординг');
    expect(md).toContain('- Сделать дайджест');
  });
});

describe('structuredReportToMarkdown', () => {
  const output = {
    tasks: [{ title: 'A', assignee: 'Иван' }],
    decisions: ['Б'],
    blockers: [],
  };

  it('сериализует непустые секции с русскими заголовками и пропускает пустые', () => {
    const md = structuredReportToMarkdown(output, 'Отчёт встречи');
    expect(md).toContain('# Отчёт встречи');
    expect(md).toContain('## Задачи');
    expect(md).toContain('- A');
    expect(md).toContain('Иван');
    expect(md).toContain('## Решения');
    expect(md).toContain('- Б');
    // пустая секция blockers пропущена
    expect(md).not.toContain('Блокеры');
    // никаких сырых англо-ключей
    expect(md).not.toContain('tasks');
    expect(md).not.toContain('decisions');
    expect(md).not.toContain('blockers');
  });

  it('примитивный output без title → строка как есть', () => {
    expect(structuredReportToMarkdown('просто текст')).toBe('просто текст');
    expect(structuredReportToMarkdown(null)).toBe('');
  });
});

describe('structuredReportToPlainText', () => {
  it('убирает markdown-разметку (# и -)', () => {
    const txt = structuredReportToPlainText(
      { decisions: ['Б'] },
      'Отчёт',
    );
    expect(txt).not.toContain('#');
    expect(txt).toContain('Отчёт');
    expect(txt).toContain('Решения');
    expect(txt).toContain('• Б');
  });
});
