/**
 * Smart-tables auto-creation (2026-06-02, Фаза 1) — Text-to-Schema, pass 2 ARCHITECT.
 *
 * LLM-промпт `table-architect-pass`. Получает ЧЕРНОВИК схемы (выход pass 1) и
 * проводит рефлексию архитектора данных: убирает дубли колонок, выбирает
 * оптимальные типы из каталога, добавляет очевидно недостающие колонки,
 * гарантирует ровно одну `isPrimary`.
 *
 * Cache-friendly: SYSTEM стабилен, переменные данные в USER (Б10 ТЗ).
 *   - SYSTEM: правила рефлексии (стабильны).
 *   - USER: JSON черновика схемы (переменная часть, в конце).
 *
 * Выход — оптимизированная схема в том же JSON-формате, что и pass 1.
 */

import { withInjectionGuard } from './common';

const ARCHITECT_SYSTEM = withInjectionGuard(
  [
    'Ты — архитектор данных в системе памяти компании «Кора». На входе — черновик схемы Smart-таблицы (JSON). Твоя задача — улучшить его как опытный проектировщик БД. Отвечай только на русском.',
    '',
    '## Что сделать',
    '- Убери дублирующиеся по смыслу колонки (например, две колонки про телефон).',
    '- Выбери оптимальный тип для каждой колонки из допустимого каталога (телефон → `phone`, почта → `email`, сумма → `currency`, дата → `date`, статус → `status`, человек → `person`).',
    '- Добавь 1-3 очевидно недостающие колонки, если они явно нужны таблице такого смысла (но не раздувай: всего 3-12 колонок).',
    '- Гарантируй ровно ОДНУ колонку с `isPrimary: true` — именующую. Если в черновике их 0 или больше одной — исправь.',
    '- Сохраняй человеческие русские названия колонок.',
    '',
    '## Правила вывода',
    '- Верни СТРОГО валидный JSON-объект той же формы, что и вход: `{ "name", "description", "icon", "entitySync", "properties": [ { "name", "type", "isPrimary", "config"? } ] }`.',
    '- Не меняй `entitySync` — его проверит отдельный шаг.',
    '- Не добавляй markdown-обёрток и комментариев.',
    '- Для `status` / `selectSingle` / `selectMulti` сохраняй/нормализуй `config.options` (id, name, color из success|warning|danger|info|neutral).',
  ].join('\n'),
);

export interface BuildTableArchitectPassPromptArgs {
  /** JSON-черновик схемы (выход pass 1), сериализуемый объект. */
  draftSchema: unknown;
}

/**
 * Возвращает `{ system, user }` для pass 2 (ARCHITECT). SYSTEM стабилен,
 * переменный черновик схемы — в конце USER.
 */
export function buildTableArchitectPassPrompt(
  args: BuildTableArchitectPassPromptArgs,
): { system: string; user: string } {
  const user = [
    'Черновик схемы для улучшения:',
    '```json',
    JSON.stringify(args.draftSchema, null, 2),
    '```',
    '',
    'Верни улучшенную схему JSON-объектом по правилам из системного сообщения.',
  ].join('\n');
  return { system: ARCHITECT_SYSTEM, user };
}
