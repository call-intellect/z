import { describe, expect, it } from 'vitest';

import { isPlaceholderMeetingTitle } from './meeting-title.util';

/**
 * Редизайн кабинета Ф5а (2026-06-13) — таблица гейта перезаписи title.
 * true → можно перезаписать авто-названием; false → осмысленный пользовательский
 * title, не трогаем.
 */
describe('isPlaceholderMeetingTitle', () => {
  const placeholders: Array<[string | null | undefined, string]> = [
    [null, 'null'],
    [undefined, 'undefined'],
    ['', 'пустая строка'],
    ['   ', 'только пробелы'],
    ['ab', 'длина < 3'],
    [' a ', 'длина < 3 после trim'],
    ['.', 'точка'],
    ['текст', 'служебный «текст»'],
    ['Встреча', 'служебная «Встреча» (регистр)'],
    ['  КОМАНДА ', 'служебная «КОМАНДА» (регистр+пробелы)'],
    ['новая встреча', 'служебная «новая встреча»'],
    ['Без названия', 'служебная «Без названия»'],
  ];

  for (const [input, label] of placeholders) {
    it(`плейсхолдер → true: ${label}`, () => {
      expect(isPlaceholderMeetingTitle(input)).toBe(true);
    });
  }

  const meaningful: Array<[string, string]> = [
    ['Синк по релизу', 'обычное название'],
    ['Итоги спринта команды', 'осмысленное многословное'],
    ['Q3W', 'ровно 3 символа'],
    ['Договор с клиентом X', 'с именем'],
    ['встреча по бюджету', 'содержит «встреча», но не равно ему'],
  ];

  for (const [input, label] of meaningful) {
    it(`осмысленный → false: ${label}`, () => {
      expect(isPlaceholderMeetingTitle(input)).toBe(false);
    });
  }
});
