import { describe, expect, it } from 'vitest';

import {
  CHAT_SUMMARY_SYSTEM_PROMPT,
  buildChatSummaryUserPrompt,
} from './chat-summary.prompt';

describe('chat-summary prompt — cache-friendly (стабильный SYSTEM)', () => {
  it('SYSTEM не содержит переменных-плейсхолдеров (${...} / {{...}})', () => {
    expect(CHAT_SUMMARY_SYSTEM_PROMPT).not.toMatch(/\$\{/u);
    expect(CHAT_SUMMARY_SYSTEM_PROMPT).not.toMatch(/\{\{/u);
  });

  it('SYSTEM стабилен между вызовами (snapshot)', () => {
    expect(CHAT_SUMMARY_SYSTEM_PROMPT).toMatchInlineSnapshot(`
      "Ты сводишь непрочитанную переписку рабочего чата для участника, который давно её не открывал.
      Дай короткую сводку «что я пропустил». Формат — компактный markdown:
      - кто участвовал и о чём говорили (по темам, без пересказа каждого сообщения);
      - какие приняты решения и какие договорённости/действия (кто что должен сделать), если есть.
      Каждый тезис подкрепляй ссылкой на исходное сообщение в виде [MSG:<id>], где <id> — идентификатор сообщения из входных данных. Не выдумывай id.
      Пиши по-русски, по делу, без воды и без вступлений. Не повторяй инструкции и не цитируй сообщения целиком."
    `);
  });

  it('SYSTEM содержит инструкцию цитат [MSG:<id>]', () => {
    expect(CHAT_SUMMARY_SYSTEM_PROMPT).toContain('[MSG:<id>]');
  });

  it('переменное (заголовок + сообщения) — в user-промпте, с [MSG:id]', () => {
    const user = buildChatSummaryUserPrompt({
      conversationTitle: 'Маркетинг',
      messages: [
        { id: 'm1', author: 'Аня', text: 'привет' },
        { id: 'm2', author: 'Боб', text: 'обновим лендинг' },
      ],
    });
    expect(user).toContain('Маркетинг');
    expect(user).toContain('Непрочитанных сообщений: 2');
    expect(user).toContain('[MSG:m1] Аня: привет');
    expect(user).toContain('[MSG:m2] Боб: обновим лендинг');
  });
});
