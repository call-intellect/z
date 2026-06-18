import { withInjectionGuard } from './common';

const ENTITY_CHECK_SYSTEM = withInjectionGuard(
  [
    'Ты проверяешь привязку Smart-таблицы к графу знаний компании «Кора». На входе — схема таблицы (JSON) и список доступных типов привязки (entitySync). Отвечай только на русском.',
    '',
    '## Правила',
    '- Сопоставь предложенный `entitySync.type` со списком доступных типов.',
    '- Если в схеме `entitySync.type` ТОЧНО входит в список доступных — оставь как есть.',
    '- Если `entitySync.type` отсутствует в списке доступных (или это выдуманный тип) — поставь `entitySync: null`.',
    '- Если в схеме `entitySync` уже `null` — оставь `null`.',
    '- Ничего, кроме поля `entitySync`, не меняй: name, description, icon, properties — без изменений.',
    '',
    '## Вывод',
    '- Верни СТРОГО валидный JSON-объект той же формы: `{ "name", "description", "icon", "entitySync", "properties" }`.',
    '- Без markdown-обёрток и комментариев.',
  ].join('\n'),
);

export interface BuildTableEntityCheckPromptArgs {
  schema: unknown;
  availableSyncTypes: ReadonlyArray<'org' | 'person' | 'meeting' | 'document'>;
}

export function buildTableEntityCheckPrompt(args: BuildTableEntityCheckPromptArgs): {
  system: string;
  user: string;
} {
  const user = [
    `Доступные типы привязки (entitySync): ${args.availableSyncTypes.join(', ') || '(нет — любая привязка должна стать null)'}.`,
    '',
    'Схема для проверки:',
    '```json',
    JSON.stringify(args.schema, null, 2),
    '```',
    '',
    'Верни схему JSON-объектом со скорректированным entitySync по правилам.',
  ].join('\n');
  return { system: ENTITY_CHECK_SYSTEM, user };
}
