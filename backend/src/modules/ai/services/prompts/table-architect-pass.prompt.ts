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
  draftSchema: unknown;
}

export function buildTableArchitectPassPrompt(args: BuildTableArchitectPassPromptArgs): {
  system: string;
  user: string;
} {
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
