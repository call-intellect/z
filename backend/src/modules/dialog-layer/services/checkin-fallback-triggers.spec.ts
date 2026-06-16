import { describe, expect, it } from 'vitest';

import { checkinFallbackHeuristic } from './checkin-fallback-triggers';

describe('checkinFallbackHeuristic — позитивные кейсы morning', () => {
  it.each([
    ['План на день: КП, созвон, отчёт', 'morning'],
    ['План на сегодня — добить три задачи', 'morning'],
    ['Утренний план: А, Б, В', 'morning'],
    ['Сегодня хочу закрыть КП и созвониться с Петровым', 'morning'],
    ['На сегодня: А, Б, В. Блокер: ТЗ не пришло', 'morning'],
  ])('«%s» → kind=%s', (input, expected) => {
    const result = checkinFallbackHeuristic(input);
    expect(result?.kind).toBe(expected);
  });
});

describe('checkinFallbackHeuristic — позитивные кейсы evening', () => {
  it.each([
    ['Итоги дня: КП отправил, отчёт не успел', 'evening'],
    ['Отчёт за день — две задачи закрыл', 'evening'],
    ['Отчет за день готов, всё ок', 'evening'],
    ['Вечерний отчёт: норм, закрыл КП', 'evening'],
    ['По итогам дня — две задачи закрыл, одна в работе', 'evening'],
  ])('«%s» → kind=%s', (input, expected) => {
    const result = checkinFallbackHeuristic(input);
    expect(result?.kind).toBe(expected);
  });
});

describe('checkinFallbackHeuristic — ловушки (триггер не в начале / не план/отчёт)', () => {
  it.each([
    'Не забудь напомнить про план на день к 9 утра',
    'Договоримся обсудить план на отпуск в пятницу с командой',
    'Итоги встречи с клиентом — всё ок, договорились',
    'Отчёт квартальный собран, отправлю руководству',
    '',
  ])('«%s» → null', (input) => {
    const result = checkinFallbackHeuristic(input);
    expect(result).toBeNull();
  });

  it('null для невалидного ввода (undefined)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(checkinFallbackHeuristic(undefined as any)).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(checkinFallbackHeuristic(null as any)).toBeNull();
  });

  it('case-insensitive: «ПЛАН НА ДЕНЬ ...» → morning', () => {
    expect(checkinFallbackHeuristic('ПЛАН НА ДЕНЬ: А, Б')?.kind).toBe('morning');
  });
});
