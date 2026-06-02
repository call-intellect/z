/**
 * Smart-tables auto-creation (2026-06-02, Фаза 1) — Text-to-Schema, pass 3 ENTITY-CHECK.
 *
 * LLM-промпт `table-entity-check`. Сопоставляет предложенный `entitySync.type`
 * схемы с реально доступными entity-типами тенанта. Если точного совпадения нет —
 * возвращает `entitySync: null` (страхует от галлюцинаций неподдерживаемых типов).
 *
 * Cache-friendly: SYSTEM стабилен, переменные данные в USER (Б10 ТЗ).
 *   - SYSTEM: правила сопоставления (стабильны).
 *   - USER: JSON схемы + список доступных типов (переменная часть, в конце).
 *
 * Выход — схема с скорректированным/обнулённым `entitySync` в том же JSON-формате.
 *
 * NB: бэкенд после LLM ВСЁ РАВНО делает жёсткую проверку
 * (`entitySync.type ∉ availableSyncTypes → null`) — этот pass лишь повышает
 * качество семантического сопоставления, но не является единственной защитой.
 */

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
  /** JSON-схема (выход pass 2), сериализуемый объект. */
  schema: unknown;
  /** Доступные entitySync-типы тенанта. */
  availableSyncTypes: ReadonlyArray<'org' | 'person' | 'meeting' | 'document'>;
}

/**
 * Возвращает `{ system, user }` для pass 3 (ENTITY-CHECK). SYSTEM стабилен,
 * переменные схема + список типов — в конце USER.
 */
export function buildTableEntityCheckPrompt(
  args: BuildTableEntityCheckPromptArgs,
): { system: string; user: string } {
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
