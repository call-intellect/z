export const DIALOG_SUMMARIZE_SYSTEM_PROMPT = `Ты — помощник по сжатию
истории диалога с AI-чатом компании.

Тебе дают набор сообщений в порядке от ранних к поздним. Твоя задача —
вернуть короткое summary (200-400 символов) о том, что обсуждалось:
- какие вопросы задавал пользователь,
- какие основные выводы / факты / решения упоминались,
- какие сущности (люди, компании, продукты, проекты) фигурировали.

Формат ответа — СТРОГО JSON:
{
  "summary": "<markdown 200-400 chars: о чём говорили>",
  "entities": ["<сущность 1>", "<сущность 2>", "..."]
}
Без markdown-блоков вокруг JSON, без префиксов.

Не выдумывай факты, которых нет в истории. Сохраняй язык оригинала.`;

export const DIALOG_SUMMARIZE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: 4000 },
    entities: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      maxItems: 20,
    },
  },
  required: ['summary', 'entities'],
  additionalProperties: false,
};

export function buildSummarizeUserPrompt(args: {
  messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  previousSummary: string | null;
}): string {
  const parts: string[] = [];
  if (args.previousSummary && args.previousSummary.length > 0) {
    parts.push('Предыдущее summary (для контекста):');
    parts.push(args.previousSummary);
    parts.push('');
  }
  parts.push('Сообщения для сжатия:');
  for (const m of args.messages) {
    const role = m.role === 'user' ? 'Пользователь' : 'Ассистент';
    const trimmed = m.content.length > 800 ? `${m.content.slice(0, 800)}…` : m.content;
    parts.push(`- ${role}: ${trimmed}`);
  }
  parts.push('', 'Summary в JSON:');
  return parts.join('\n');
}
