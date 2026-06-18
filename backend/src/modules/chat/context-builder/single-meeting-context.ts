import type {
  AiResult,
  Meeting,
  MeetingChapter,
  MeetingChatMessage,
  MeetingTranscriptChunk,
} from '@prisma/client';

import { pickPrimarySummary } from '../../ai/utils/pick-primary-summary';

const MAX_CHARS = 80_000;

export interface SingleMeetingInput {
  meeting: Meeting;
  aiResult: AiResult | null;
  chapters: MeetingChapter[];
  tasks: ReadonlyArray<{ title: string }>;
  chunks: MeetingTranscriptChunk[];
  history: MeetingChatMessage[];
  question: string;
}

export interface BuiltContext {
  systemPrompt: string;
  userMessage: string;
  contextChunks: Array<{
    startMs: number;
    endMs: number;
    text: string;
    meetingId: string;
    meetingTitle: string;
  }>;
}

const SYSTEM_PROMPT = `Ты — ассистент по конкретной видеовстрече. Отвечай на вопросы пользователя о её содержании.

Правила:
- Отвечай на русском.
- Опирайся ТОЛЬКО на предоставленный контекст встречи. Если в контексте ответа нет — честно скажи "Я не нашёл этого в записи".
- При цитировании используй timestamps в формате [mm:ss] — фронт превратит их в кликабельные ссылки.
- Краткость: 1-3 предложения для простого вопроса, до 6 для сложного.
- Не выдумывай.`;

export function buildSingleMeetingContext(input: SingleMeetingInput): BuiltContext {
  const parts: string[] = [];

  const meta = `Встреча: «${input.meeting.title}» (тип: ${input.meeting.type}, дата: ${
    input.meeting.startedAt?.toISOString().slice(0, 10) ?? '—'
  }).`;
  parts.push(meta, '');

  const summary = input.aiResult ? pickPrimarySummary(input.aiResult) : '';
  if (summary) {
    parts.push('Summary:', summary, '');
  }
  if (input.chapters.length > 0) {
    parts.push('Главы:');
    for (const c of input.chapters) {
      parts.push(`- [${formatMmSs(c.startMs)}] ${c.title}`);
    }
    parts.push('');
  }
  if (input.tasks.length > 0) {
    parts.push('Задачи:');
    for (const t of input.tasks) {
      parts.push(`- ${t.title}`);
    }
    parts.push('');
  }

  const hist = input.history.slice(-10);
  if (hist.length > 0) {
    parts.push('История диалога:');
    for (const m of hist) {
      parts.push(`${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.content}`);
    }
    parts.push('');
  }

  const trimmedChunks = trimChunksByCharLimit(input.chunks, MAX_CHARS / 2);
  parts.push('Транскрипт (фрагменты):');
  for (const c of trimmedChunks) {
    parts.push(`[${formatMmSs(c.startMs)}-${formatMmSs(c.endMs)}] ${c.text}`);
  }
  parts.push('');

  parts.push('Вопрос:', input.question);

  return {
    systemPrompt: SYSTEM_PROMPT,
    userMessage: parts.join('\n'),
    contextChunks: trimmedChunks.map((c) => ({
      startMs: c.startMs,
      endMs: c.endMs,
      text: c.text,
      meetingId: input.meeting.id,
      meetingTitle: input.meeting.title,
    })),
  };
}

function trimChunksByCharLimit(
  chunks: MeetingTranscriptChunk[],
  maxChars: number,
): MeetingTranscriptChunk[] {
  let total = 0;
  const taken: MeetingTranscriptChunk[] = [];
  for (const c of chunks) {
    if (total + c.text.length > maxChars) break;
    taken.push(c);
    total += c.text.length;
  }
  return taken;
}

export function formatMmSs(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
