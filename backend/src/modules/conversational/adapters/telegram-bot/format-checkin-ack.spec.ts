import { describe, expect, it } from 'vitest';

import { formatCheckinAck } from './format-checkin-ack';

describe('formatCheckinAck — Phase 5 §Backend.12', () => {
  it('Утро, новая запись, ok confidence — содержит «Принял утренний план» и кол-во', () => {
    const text = formatCheckinAck({
      kind: 'morning',
      wasReplace: false,
      plansCount: 3,
      donesCount: 0,
      blockersCount: 1,
      lowParserConfidence: false,
    });
    expect(text).toMatch(/Принял утренний план/);
    expect(text).toMatch(/3 пункта в плане/);
    expect(text).toMatch(/1 блокер/);
    expect(text).toMatch(/дашборде руководителя/i);
  });

  it('Утро, wasReplace=true — про «Заменил» и подсказку про полный план', () => {
    const text = formatCheckinAck({
      kind: 'morning',
      wasReplace: true,
      plansCount: 3,
      donesCount: 0,
      blockersCount: 0,
      lowParserConfidence: false,
    });
    expect(text).toMatch(/Заменил утренний план/);
    expect(text).toMatch(/полный обновлённый план/);
    expect(text).toMatch(/3 пункта в плане/);
  });

  it('Вечер, новая запись — «Принял вечерний отчёт» + сделано/не закрыто', () => {
    const text = formatCheckinAck({
      kind: 'evening',
      wasReplace: false,
      plansCount: 0,
      donesCount: 2,
      blockersCount: 1,
      lowParserConfidence: false,
    });
    expect(text).toMatch(/Принял вечерний отчёт/);
    expect(text).toMatch(/2 сделанных/);
    expect(text).toMatch(/1 не закрыто/);
  });

  it('Вечер, wasReplace=true — «Заменил вечерний отчёт»', () => {
    const text = formatCheckinAck({
      kind: 'evening',
      wasReplace: true,
      plansCount: 0,
      donesCount: 1,
      blockersCount: 0,
      lowParserConfidence: false,
    });
    expect(text).toMatch(/Заменил вечерний отчёт/);
  });

  it('lowParserConfidence=true (утро) — про оператора и «не считать чек-ином»', () => {
    const text = formatCheckinAck({
      kind: 'morning',
      wasReplace: false,
      plansCount: 0,
      donesCount: 0,
      blockersCount: 0,
      lowParserConfidence: true,
    });
    expect(text).toMatch(/план дня/);
    expect(text).toMatch(/Оператор перепроверит/);
    expect(text).toMatch(/не считать чек-ином/);
  });

  it('lowParserConfidence=true (вечер) — «отчёт за день»', () => {
    const text = formatCheckinAck({
      kind: 'evening',
      wasReplace: false,
      plansCount: 0,
      donesCount: 0,
      blockersCount: 0,
      lowParserConfidence: true,
    });
    expect(text).toMatch(/отчёт за день/);
  });

  it('Правильная русская плюрализация: 1 пункт, 2 пункта, 5 пунктов', () => {
    expect(
      formatCheckinAck({
        kind: 'morning',
        wasReplace: false,
        plansCount: 1,
        donesCount: 0,
        blockersCount: 0,
        lowParserConfidence: false,
      }),
    ).toMatch(/1 пункт в плане/);
    expect(
      formatCheckinAck({
        kind: 'morning',
        wasReplace: false,
        plansCount: 2,
        donesCount: 0,
        blockersCount: 0,
        lowParserConfidence: false,
      }),
    ).toMatch(/2 пункта в плане/);
    expect(
      formatCheckinAck({
        kind: 'morning',
        wasReplace: false,
        plansCount: 5,
        donesCount: 0,
        blockersCount: 0,
        lowParserConfidence: false,
      }),
    ).toMatch(/5 пунктов в плане/);
  });
});
