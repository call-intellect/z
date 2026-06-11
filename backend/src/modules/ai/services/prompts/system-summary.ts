import {
  type PromptInput,
  type PromptOutput,
  turnsToText,
  withRoomChatNote,
} from './common';

const SUMMARY_SYSTEM = `Ты — ассистент, который резюмирует деловые встречи на русском языке.
Сделай краткое саммари из 2-3 предложений: о чём была встреча, ключевые договорённости.
Без оценочных суждений. Без буллетов. Только связный текст.

Если транскрипт явно неполный или спикеры не определены — добавь это короткой фразой в конце резюме. Если договорённостей/решений не было — так и напиши, не выдумывай.`;

export const SUMMARY_TOOL_NAME = 'summary_v1';

export function buildSummaryPrompt(input: PromptInput): PromptOutput {
  const meta = [
    `Тип встречи: ${input.meeting.type}`,
    `Заголовок: ${input.meeting.title}`,
  ].join('\n');
  const dialog = turnsToText(input.dialog, input.roomChat);
  return {
    system: withRoomChatNote(SUMMARY_SYSTEM, input.roomChat),
    user: `${meta}\n\nДиалог:\n${dialog}`,
  };
}
