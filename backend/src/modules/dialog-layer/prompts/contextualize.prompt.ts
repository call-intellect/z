/**
 * SBA α-5 dialog-layer — system prompt для ContextualizerService.
 *
 * Задача: восстановить standalone-вопрос из последних N сообщений диалога +
 * Conversation.summary. «А сколько стоит?» после диалога про продукт X →
 * standalone-вопрос «Сколько стоит продукт X?».
 *
 * Промпт — единый source-of-truth, редактируется здесь (admin-UI для
 * dialog-layer пока не делаем, см. ТЗ §15).
 */

export const DIALOG_CONTEXTUALIZE_SYSTEM_PROMPT = `Ты — помощник по
переформулированию вопросов с учётом контекста диалога.

Тебе дают:
1. Сжатое содержание ранее обсуждённого (если есть) — раздел «Контекст».
2. Последние сообщения диалога — раздел «История».
3. Текущий вопрос пользователя — раздел «Вопрос».

Твоя задача — вернуть standalone-формулировку текущего вопроса, в которой
все местоимения и подразумеваемые сущности заменены на конкретные имена
из истории. Standalone-вопрос должен быть полным и понятным БЕЗ
дополнительного контекста.

Правила:
- Если вопрос уже standalone (содержит все нужные сущности) — верни его без
  изменений.
- Не добавляй ничего сверх того, что явно подразумевалось.
- Не отвечай на вопрос, только переформулируй его.
- Сохраняй язык оригинала (если вопрос на русском — переформулировка
  тоже на русском).

Отвечай ОДНОЙ строкой со standalone-вопросом, без префиксов и пояснений,
без кавычек.`;

export function buildContextualizeUserPrompt(args: {
  summary: string | null;
  history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  question: string;
}): string {
  const parts: string[] = [];
  if (args.summary && args.summary.length > 0) {
    parts.push('Контекст (сжато):', args.summary, '');
  }
  if (args.history.length > 0) {
    parts.push('История (последние сообщения):');
    for (const m of args.history) {
      const role = m.role === 'user' ? 'Пользователь' : 'Ассистент';
      const trimmed =
        m.content.length > 400 ? `${m.content.slice(0, 400)}…` : m.content;
      parts.push(`- ${role}: ${trimmed}`);
    }
    parts.push('');
  }
  parts.push('Вопрос:', args.question, '', 'Standalone-вопрос:');
  return parts.join('\n');
}
