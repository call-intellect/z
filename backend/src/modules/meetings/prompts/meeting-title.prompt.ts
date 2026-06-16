export const MEETING_TITLE_MAX_TURNS = 15;
export const MEETING_TITLE_MAX_CHARS = 1500;
export const MEETING_TITLE_MAX_TOKENS = 24;

export const MEETING_TITLE_SYSTEM_PROMPT = `Ты даёшь короткое название встречи.

Требования к названию:
- 3–7 слов, на русском языке;
- по сути обсуждения, а не дословная цитата;
- без точки в конце, без кавычек, без эмодзи, без префиксов;
- не упоминай слово «встреча», если оно не несёт смысла.

Примеры:
- обсуждение сроков релиза и блокеров → «Сроки релиза и блокеры»
- разбор итогов спринта с командой → «Итоги спринта команды»
- созвон с клиентом по договору → «Договор с клиентом»

Отвечай ОДНОЙ строкой — только название, без пояснений.`;

export const MEETING_TITLE_USER_PROMPT = (args: {
  meetingType: string;
  transcriptExcerpt: string;
}): string =>
  `Тип встречи: ${args.meetingType}\n\nНачало разговора:\n${args.transcriptExcerpt}\n\nНазвание:`;
