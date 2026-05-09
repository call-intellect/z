import { type PromptInput, type PromptOutput, turnsToText } from './common';

const SUMMARY_SYSTEM = `Ты — ассистент, который резюмирует деловые встречи на русском языке.
Сделай краткое саммари из 2-3 предложений: о чём была встреча, ключевые договорённости.
Без оценочных суждений. Без буллетов. Только связный текст.`;

export const SUMMARY_TOOL_NAME = 'summary_v1';

export function buildSummaryPrompt(input: PromptInput): PromptOutput {
  const meta = [
    `Тип встречи: ${input.meeting.type}`,
    `Заголовок: ${input.meeting.title}`,
  ].join('\n');
  const dialog = turnsToText(input.dialog);
  return {
    system: SUMMARY_SYSTEM,
    user: `${meta}\n\nДиалог:\n${dialog}`,
  };
}
