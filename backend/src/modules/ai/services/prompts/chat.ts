/**
 * Промпт для AI-чата по встрече (single-meeting контекст).
 *
 * Контекст (relevant chunks из RAG) передаётся внутри `userMessage`,
 * а не системы — система лишь задаёт роль и формат ответа.
 *
 * Timestamps в формате [mm:ss] — фронт парсит и превращает в кликабельные
 * jump-to-time ссылки (см. UX в ТЗ M3c).
 */
export const CHAT_TASK_TYPE = 'chat';
export const CHAT_PROMPT_NAME = 'chat_v1';

const CHAT_SYSTEM = `Ты — ассистент по конкретной видеовстрече. Отвечай на вопросы пользователя о содержании встречи.

Правила:
- Отвечай на русском.
- Опирайся ТОЛЬКО на предоставленный контекст встречи. Если в контексте ответа нет — честно скажи "Я не нашёл этого в записи встречи".
- При цитировании используй timestamps в формате [mm:ss] — фронт превратит их в кликабельные ссылки на момент записи.
- Если приводишь точную цитату — обрамляй её в кавычки.
- Краткость: 1-3 предложения для простого вопроса, до 6 предложений для сложного.
- Не выдумывай. Не пересказывай то, чего нет в контексте.`;

export interface ChatPromptInput {
  meeting: {
    type: string;
    title: string;
    startedAt?: Date | null;
  };
  /** Релевантные фрагменты из RAG-поиска. Уже отсортированы по релевантности. */
  contextChunks: Array<{ startMs: number; endMs: number; text: string }>;
  /** Вопрос пользователя. */
  question: string;
  /** История диалога (опц., для multi-turn чата). */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export function buildChatPrompt(input: ChatPromptInput): {
  system: string;
  user: string;
} {
  const startedLabel = input.meeting.startedAt
    ? ` от ${input.meeting.startedAt.toISOString().slice(0, 10)}`
    : '';
  const meta = `Встреча: «${input.meeting.title}» (тип: ${input.meeting.type}${startedLabel}).`;

  const contextBlock = input.contextChunks
    .map((c) => `[${formatMmSs(c.startMs)}-${formatMmSs(c.endMs)}] ${c.text}`)
    .join('\n\n');

  const historyBlock = (input.history ?? [])
    .map((h) => (h.role === 'user' ? `Пользователь: ${h.content}` : `Ассистент: ${h.content}`))
    .join('\n');

  const userParts = [
    meta,
    '',
    'Релевантный контекст из записи:',
    contextBlock || '(контекст пуст)',
  ];
  if (historyBlock) {
    userParts.push('', 'История диалога:', historyBlock);
  }
  userParts.push('', 'Вопрос:', input.question);

  return {
    system: CHAT_SYSTEM,
    user: userParts.join('\n'),
  };
}

function formatMmSs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
