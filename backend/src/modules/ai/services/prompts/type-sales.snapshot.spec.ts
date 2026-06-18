import { describe, expect, it } from 'vitest';

import { buildPrompt } from './type-sales';

const FIXTURE_SALES = {
  meeting: {
    id: 'm-sales-1',
    title: 'Звонок с Иваном (потенциальный клиент)',
    type: 'sales',
    customPrompt: null,
  },
  dialog: [
    {
      speaker: 'Маша',
      text: 'Здравствуйте, Иван. Спасибо что нашли время.',
      startSec: 0,
      endSec: 4,
    },
    {
      speaker: 'Иван',
      text: 'Расскажите про CRM, у нас бюджет до 400 тысяч в квартал.',
      startSec: 4.5,
      endSec: 11,
    },
    {
      speaker: 'Маша',
      text: 'У нас есть интеграция с 1С в стандартной поставке. Кто принимает решение?',
      startSec: 11.5,
      endSec: 18,
    },
    {
      speaker: 'Иван',
      text: 'Финансовый директор. Принесу ответ к четвергу.',
      startSec: 18.5,
      endSec: 23,
    },
  ],
};

describe('type-sales — snapshot сборки промта', () => {
  it('system+user стабильны для короткой sales-фикстуры (без roomChat)', () => {
    const out = buildPrompt(FIXTURE_SALES);
    expect(out.system).toMatchSnapshot('system');
    expect(out.user).toMatchSnapshot('user');
  });

  it('roomChat → подмешана ROOM_CHAT_SYSTEM_NOTE + блок «Чат встречи» в user', () => {
    const out = buildPrompt({
      ...FIXTURE_SALES,
      roomChat: [
        {
          sentAt: '2026-05-24T10:05:00Z',
          authorName: 'Маша',
          content: 'https://example.com/proposal.pdf',
        },
      ],
    });
    expect(out.system).toMatchSnapshot('system-with-roomchat');
    expect(out.user).toMatchSnapshot('user-with-roomchat');
  });
});
