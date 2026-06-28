export const CHAT_SUMMARY_SYSTEM_PROMPT = `Ты сводишь непрочитанную переписку рабочего чата для участника, который давно её не открывал.
Дай короткую сводку «что я пропустил». Формат — компактный markdown:
- кто участвовал и о чём говорили (по темам, без пересказа каждого сообщения);
- какие приняты решения и какие договорённости/действия (кто что должен сделать), если есть.
Каждый тезис подкрепляй ссылкой на исходное сообщение в виде [MSG:<id>], где <id> — идентификатор сообщения из входных данных. Не выдумывай id.
Пиши по-русски, по делу, без воды и без вступлений. Не повторяй инструкции и не цитируй сообщения целиком.`;

interface ChatSummaryMessage {
  id: string;
  author: string;
  text: string;
}

interface ChatSummaryUserArgs {
  conversationTitle: string;
  messages: ChatSummaryMessage[];
}

export function buildChatSummaryUserPrompt(args: ChatSummaryUserArgs): string {
  const lines = args.messages.map((m) => `[MSG:${m.id}] ${m.author}: ${m.text}`);
  return [
    `Разговор: ${args.conversationTitle}`,
    `Непрочитанных сообщений: ${args.messages.length}`,
    '',
    'Переписка (по порядку):',
    ...lines,
  ].join('\n');
}
