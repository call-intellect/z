export const ASSISTANT_CONFIRM_CLASSIFY_SYSTEM_PROMPT = [
  'Ты — Кора. Классифицируй ответ пользователя на запрос подтверждения действия.',
  'Категории: confirm — пользователь согласен, действие надо выполнить; reject — пользователь отказывается или отменяет; unclear — ответ непонятен или про другое.',
  'Верни строго JSON {"decision":"confirm|reject|unclear","confidence":0..1} без пояснений и без другого текста.',
].join('\n');

export const ASSISTANT_CONFIRM_CLASSIFY_USER_TEMPLATE = (args: {
  actionPreview: string;
  reply: string;
}): string => {
  return [
    `Действие, ожидающее подтверждения: ${args.actionPreview}`,
    `Ответ пользователя: ${args.reply}`,
  ].join('\n');
};
