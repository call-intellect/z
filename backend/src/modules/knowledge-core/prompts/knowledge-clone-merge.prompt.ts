/**
 * SBA β-2 — Specialist 3.2 (Knowledge Clone).
 *
 * LLM-промпт `knowledge-clone-merge` — старый профиль + новый черновик →
 * объединённый профиль с decay для категорий, которые давно не подтверждались.
 *
 * TODO(owner-product): согласовать финальный текст. Текущая версия —
 * placeholder под структуру из sub-TZ §4 / §10.
 */

import {
  KNOWLEDGE_CLONE_EXTRACT_JSON_SCHEMA,
  KNOWLEDGE_CLONE_EXTRACT_SCHEMA_NAME,
} from './knowledge-clone-extract.prompt';

export const KNOWLEDGE_CLONE_MERGE_SYSTEM_PROMPT = [
  'Ты — knowledge-инженер. Тебе дают два «профиля знаний» одного сотрудника:',
  '1) старый профиль (canonical) — то, что было известно ранее;',
  '2) новый черновик — извлечён из свежих блоков за последний период.',
  '',
  'Твоя задача — объединить их в один итоговый профиль на русском языке, по той же JSON-схеме.',
  '',
  'Правила слияния:',
  '- Если категория есть в обоих профилях — суммируй observationCount, объедини sampleStatements (оставь не более 3 самых сильных и свежих), обнови lastObservedAt = свежее.',
  '- Если категория есть только в новом — добавь её как есть.',
  '- Если категория есть только в старом — оставь, но понизь уровень confidence по правилу decay:',
  '   * прошло >12 месяцев с lastObservedAt → удалить категорию (не возвращай в JSON);',
  '   * прошло 6–12 месяцев → понизить confidence на один шаг (high→medium, medium→low);',
  '   * прошло <6 месяцев — оставить как есть.',
  '- Experience highlights — объедини и удали дубликаты по smysl.',
  '',
  'Контракт: верни итоговый профиль JSON-объектом по той же схеме `knowledge_clone_extract_v1`.',
].join('\n');

export const KNOWLEDGE_CLONE_MERGE_USER_TEMPLATE = (args: {
  personName: string;
  nowIso: string;
  oldProfileJson: string;
  newDraftJson: string;
}): string => {
  return [
    `Сотрудник: ${args.personName}`,
    `Текущее время (ISO): ${args.nowIso}`,
    '',
    'СТАРЫЙ профиль (canonical):',
    args.oldProfileJson,
    '',
    'НОВЫЙ черновик (из свежих блоков):',
    args.newDraftJson,
    '',
    'Верни итоговый JSON-объект по схеме `knowledge_clone_extract_v1` (та же схема, что и extract).',
  ].join('\n');
};

// Схема результата merge'а — точно такая же, как у extract.
export const KNOWLEDGE_CLONE_MERGE_JSON_SCHEMA =
  KNOWLEDGE_CLONE_EXTRACT_JSON_SCHEMA;

export const KNOWLEDGE_CLONE_MERGE_SCHEMA_NAME =
  KNOWLEDGE_CLONE_EXTRACT_SCHEMA_NAME;
