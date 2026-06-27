import { describe, expect, it } from 'vitest';

import { stripBlockMarkers } from './chat-v2.service';

describe('stripBlockMarkers', () => {
  it('убирает [BLOCK:<id>] и не оставляет двойных пробелов / пробела перед точкой', () => {
    const out = stripBlockMarkers('Факт [BLOCK:abc123] подтверждён');
    expect(out).toBe('Факт подтверждён');
    expect(out).not.toContain('[BLOCK:');
    expect(out).not.toMatch(/ {2,}/);
    expect(out).not.toMatch(/ \./);
  });

  it('убирает маркер прямо перед точкой без пробела перед пунктуацией', () => {
    const out = stripBlockMarkers('Релиз перенесён на июль [BLOCK:zz9].');
    expect(out).toBe('Релиз перенесён на июль.');
  });

  it('убирает тег [CONTRADICTING BLOCK]', () => {
    const out = stripBlockMarkers('Есть конфликт мнений [CONTRADICTING BLOCK] по срокам');
    expect(out).toBe('Есть конфликт мнений по срокам');
    expect(out).not.toContain('CONTRADICTING');
  });

  it('убирает тег [REASONING CHAIN FOR BLOCK <id>]', () => {
    const out = stripBlockMarkers('Почему так [REASONING CHAIN FOR BLOCK abc123] — потому что');
    expect(out).toBe('Почему так — потому что');
    expect(out).not.toContain('REASONING CHAIN');
  });

  it('убирает русский тег [ПРОТИВОРЕЧАЩИЙ ФАКТ]', () => {
    const out = stripBlockMarkers('Есть конфликт мнений [ПРОТИВОРЕЧАЩИЙ ФАКТ] по срокам');
    expect(out).toBe('Есть конфликт мнений по срокам');
    expect(out).not.toContain('ПРОТИВОРЕЧАЩИЙ');
  });

  it('убирает русский тег [ПРОТИВОРЕЧАЩИЙ ФАКТ] вместе с соседним [BLOCK:<id>]', () => {
    const out = stripBlockMarkers(
      'Спорно [ПРОТИВОРЕЧАЩИЙ ФАКТ] (противоречит [BLOCK:abc123]) дальше',
    );
    expect(out).toBe('Спорно (противоречит ) дальше');
    expect(out).not.toContain('ПРОТИВОРЕЧАЩИЙ');
    expect(out).not.toContain('[BLOCK:');
  });

  it('убирает русский тег [ЦЕПОЧКА РАССУЖДЕНИЯ К ФАКТУ <id>]', () => {
    const out = stripBlockMarkers('Почему так [ЦЕПОЧКА РАССУЖДЕНИЯ К ФАКТУ abc123] — потому что');
    expect(out).toBe('Почему так — потому что');
    expect(out).not.toContain('ЦЕПОЧКА РАССУЖДЕНИЯ');
  });

  it('убирает русский тег [ТАБЛИЦА: <название>]', () => {
    const out = stripBlockMarkers('Данные [ТАБЛИЦА: Клиенты] взяты из таблицы');
    expect(out).toBe('Данные взяты из таблицы');
    expect(out).not.toContain('ТАБЛИЦА');
  });

  it('убирает русский тег [ИТОГ ПЕРИОДА: <label>]', () => {
    const out = stripBlockMarkers('Свёртка [ИТОГ ПЕРИОДА: месяц 2026-05] показала рост');
    expect(out).toBe('Свёртка показала рост');
    expect(out).not.toContain('ИТОГ ПЕРИОДА');
  });

  it('убирает русский тег [ТЕМА: <id>] (карта тем, Ф6)', () => {
    const out = stripBlockMarkers('Раздел [ТЕМА: th-sales] о продажах');
    expect(out).toBe('Раздел о продажах');
    expect(out).not.toContain('ТЕМА');
  });

  it('текст без маркеров возвращается как есть', () => {
    const text = 'Обычный ответ без маркеров, с **markdown** и [ссылкой](https://x).';
    expect(stripBlockMarkers(text)).toBe(text);
  });

  it('читаемо обрабатывает несколько маркеров подряд и конструкцию "[BLOCK:x] vs [BLOCK:y]"', () => {
    const out = stripBlockMarkers(
      'Источники расходятся: [BLOCK:aaa111] vs [BLOCK:bbb222] по дате.',
    );
    expect(out).toBe('Источники расходятся: vs по дате.');
    expect(out).not.toContain('[BLOCK:');
    expect(out).not.toMatch(/ {2,}/);
  });

  it('убирает несколько маркеров на одном утверждении', () => {
    const out = stripBlockMarkers('Бюджет утверждён [BLOCK:aaa111] [BLOCK:bbb222] на встрече');
    expect(out).toBe('Бюджет утверждён на встрече');
  });

  it('не плодит более одной пустой строки между абзацами', () => {
    const out = stripBlockMarkers('Абзац один [BLOCK:aaa111]\n\n\n\nАбзац два');
    expect(out).toBe('Абзац один\n\nАбзац два');
  });

  it('не трогает markdown-ссылку, похожую на маркер по форме скобок', () => {
    const text = 'Смотри [документ](https://example.com/doc) подробнее.';
    expect(stripBlockMarkers(text)).toBe(text);
  });

  it('убирает помеченную форму [BLOCK:<id> — подпись] (QA-fix Ф4)', () => {
    const out = stripBlockMarkers(
      'Связи выстроены по привязки [BLOCK:cmq2b95ue00dc01qjquhaws49 — цепочка рассуждения].',
    );
    expect(out).toBe('Связи выстроены по привязки.');
    expect(out).not.toContain('[BLOCK:');
  });

  it('убирает id с дефисом/подчёркиванием [BLOCK:blk-1] и [BLOCK:blk_2]', () => {
    expect(stripBlockMarkers('Факт [BLOCK:blk-1] и [BLOCK:blk_2] здесь')).toBe(
      'Факт и здесь',
    );
  });

  it('убирает форму с обычным дефисом [BLOCK:id - текст], не только тире', () => {
    const out = stripBlockMarkers('Итог [BLOCK:abc123 - встреча по продажам] готов.');
    expect(out).toBe('Итог готов.');
    expect(out).not.toContain('[BLOCK:');
  });
});
