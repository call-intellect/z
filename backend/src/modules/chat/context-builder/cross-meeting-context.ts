import { formatMmSs } from './single-meeting-context';

export interface CrossMeetingChunk {
  meetingId: string;
  meetingTitle: string;
  meetingType: string;
  meetingDate: Date | null;
  startMs: number;
  endMs: number;
  text: string;
  similarity: number;
}

export interface CrossMeetingInput {
  chunks: CrossMeetingChunk[];
  question: string;
}

export interface BuiltCrossContext {
  systemPrompt: string;
  userMessage: string;
  contextChunks: CrossMeetingChunk[];
}

const SYSTEM_PROMPT = `Ты — ассистент по архиву видеовстреч пользователя. Отвечай на вопросы, опираясь на найденные релевантные фрагменты из разных встреч.

Правила:
- Отвечай на русском.
- Опирайся ТОЛЬКО на предоставленный контекст. Если не нашёл — честно скажи "Я не нашёл этого в архиве встреч".
- Указывай встречу: «(встреча "X" от YYYY-MM-DD, [mm:ss])».
- Если фрагменты противоречат друг другу — упомяни это.
- Краткость: 2-5 предложений; сложные вопросы — до 8.`;

export function buildCrossMeetingContext(input: CrossMeetingInput): BuiltCrossContext {
  const byMeeting = new Map<string, CrossMeetingChunk[]>();
  for (const c of input.chunks) {
    if (!byMeeting.has(c.meetingId)) {
      if (byMeeting.size >= 5) continue;
      byMeeting.set(c.meetingId, []);
    }
    byMeeting.get(c.meetingId)!.push(c);
  }

  const parts: string[] = ['Найденные релевантные фрагменты:', ''];
  for (const [, chunks] of byMeeting) {
    const first = chunks[0]!;
    const dateLabel = first.meetingDate ? first.meetingDate.toISOString().slice(0, 10) : '—';
    parts.push(`### Встреча "${first.meetingTitle}" (${first.meetingType}, ${dateLabel})`);
    for (const c of chunks) {
      parts.push(`[${formatMmSs(c.startMs)}-${formatMmSs(c.endMs)}] ${c.text}`);
    }
    parts.push('');
  }

  parts.push('Вопрос:', input.question);

  return {
    systemPrompt: SYSTEM_PROMPT,
    userMessage: parts.join('\n'),
    contextChunks: input.chunks,
  };
}
