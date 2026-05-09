import {
  buildExtractTool,
  fieldString,
  FollowUpSchema,
  type PromptInput,
  type PromptOutput,
  turnsToText,
  withRoomChatNote,
  withToolInstructions,
} from './common';

export const FOLLOW_UP_TOOL_NAME = 'extract_follow_up';
export const FOLLOW_UP_SCHEMA = FollowUpSchema;

const FOLLOW_UP_SYSTEM = `Ты — деловой ассистент. По итогам встречи нужно сгенерировать follow-up email клиенту/коллеге на русском языке.
Письмо должно: подтвердить договорённости, чётко указать следующие шаги и сроки, быть вежливым и кратким.
Поле "subject" — тема письма. Поле "body" — само письмо в формате plain-text (без HTML).`;

export function buildFollowUpPrompt(input: PromptInput): PromptOutput {
  const dialog = turnsToText(input.dialog, input.roomChat);
  return {
    system: withRoomChatNote(
      withToolInstructions(FOLLOW_UP_SYSTEM, FOLLOW_UP_TOOL_NAME),
      input.roomChat,
    ),
    user: `Тип встречи: ${input.meeting.type}\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${dialog}`,
  };
}

export const FOLLOW_UP_TOOL = buildExtractTool(
  FOLLOW_UP_TOOL_NAME,
  'Сгенерировать follow-up email по итогам встречи',
  {
    subject: fieldString,
    body: fieldString,
  },
  ['subject', 'body'],
);
