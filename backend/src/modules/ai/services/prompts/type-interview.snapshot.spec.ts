/**
 * Snapshot-тест сборки промта `type-interview.ts`.
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot ловит регрессии в
 * `buildPrompt(...)` / `withRoomChatNote` / `withToolInstructions`
 * (порядок применения, дублирование, потерянные кусочки).
 *
 * Обновлять только при осознанном изменении промта: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import { buildPrompt } from './type-interview';

const FIXTURE_INTERVIEW = {
  meeting: {
    id: 'm-interview-1',
    title: 'Собеседование Сергея на позицию backend-разработчика',
    type: 'interview',
    customPrompt: null,
  },
  dialog: [
    {
      speaker: 'Анна',
      text: 'Расскажите про опыт с NestJS.',
      startSec: 0,
      endSec: 3,
    },
    {
      speaker: 'Сергей',
      text: 'Два года в проде, микросервисы через RabbitMQ, кастомные guards и interceptors.',
      startSec: 3.5,
      endSec: 11,
    },
    {
      speaker: 'Анна',
      text: 'А с Prisma как?',
      startSec: 11.5,
      endSec: 13,
    },
    {
      speaker: 'Сергей',
      text: 'Полгода поверхностно, основной ORM — TypeORM.',
      startSec: 13.5,
      endSec: 18,
    },
  ],
};

describe('type-interview — snapshot сборки промта', () => {
  it('system+user стабильны для короткой interview-фикстуры', () => {
    const out = buildPrompt(FIXTURE_INTERVIEW);
    expect(out.system).toMatchSnapshot('system');
    expect(out.user).toMatchSnapshot('user');
  });
});
