import { describe, expect, it } from 'vitest';

import {
  parseDayRollup,
  renderBitrixTranscript,
} from './bitrix-ingest.service';

/**
 * Unit-тесты чистых хелперов BitrixIngestService (без DI/БД/LLM):
 * рендер транскрипта сессии + парс JSON-ответа посуточного rollup'а.
 */
describe('renderBitrixTranscript', () => {
  it('рендерит «имя: текст» построчно', () => {
    expect(
      renderBitrixTranscript([
        { authorName: 'Иван', text: 'Привет' },
        { authorName: 'Пётр', text: 'Здорово' },
      ]),
    ).toBe('Иван: Привет\nПётр: Здорово');
  });

  it('пустой/отсутствующий текст → [вложение/системное]', () => {
    expect(
      renderBitrixTranscript([
        { authorName: 'Иван', text: '' },
        { authorName: 'Иван', text: null },
        { authorName: 'Иван' },
      ]),
    ).toBe(
      'Иван: [вложение/системное]\nИван: [вложение/системное]\nИван: [вложение/системное]',
    );
  });

  it('нет имени автора → «Сотрудник»', () => {
    expect(renderBitrixTranscript([{ text: 'Тест' }])).toBe('Сотрудник: Тест');
  });
});

describe('parseDayRollup', () => {
  it('валидный JSON с двумя строковыми полями → объект (trim)', () => {
    expect(
      parseDayRollup('{"daySummary": " день ", "rollingSummary": " итог "}'),
    ).toEqual({ daySummary: 'день', rollingSummary: 'итог' });
  });

  it('снимает markdown-ограждение ```json … ```', () => {
    const raw = '```json\n{"daySummary":"д","rollingSummary":"р"}\n```';
    expect(parseDayRollup(raw)).toEqual({ daySummary: 'д', rollingSummary: 'р' });
  });

  it('битый JSON → null', () => {
    expect(parseDayRollup('не json')).toBeNull();
    expect(parseDayRollup('{"daySummary":')).toBeNull();
  });

  it('отсутствует одно из полей или не строка → null', () => {
    expect(parseDayRollup('{"daySummary":"д"}')).toBeNull();
    expect(
      parseDayRollup('{"daySummary":"д","rollingSummary":123}'),
    ).toBeNull();
  });
});
