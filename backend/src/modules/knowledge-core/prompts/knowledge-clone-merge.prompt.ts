/**
 * SBA β-2 — Specialist 3.2 (Knowledge Clone).
 *
 * LLM-промпт `knowledge-clone-merge` — старый профиль + новый черновик →
 * объединённый профиль с decay для категорий, которые давно не подтверждались.
 */

import { withPeopleHypothesisGuard } from '../../ai/services/prompts/common';

import {
  KNOWLEDGE_CLONE_EXTRACT_JSON_SCHEMA,
  KNOWLEDGE_CLONE_EXTRACT_SCHEMA_NAME,
} from './knowledge-clone-extract.prompt';

// Пачка 4 (2026-06-16): merge — это тоже оценка человека (компетенции, угасание),
// поэтому весь SYSTEM оборачиваем в `withPeopleHypothesisGuard` (как у extract).
// `withAsrNote` НЕ добавляем: вход — структурные JSON-профили, не ASR-цитаты.
export const KNOWLEDGE_CLONE_MERGE_SYSTEM_PROMPT = withPeopleHypothesisGuard(
  [
  'Ты — knowledge-инженер компании «Кора». Тебе дают два «профиля знаний» одного сотрудника: (1) старый канонический профиль и (2) новый черновик из свежих блоков. Объедини их в один итоговый профиль на русском языке по той же схеме.',
  '',
  '# Что держать в голове (смысл задачи)',
  '- Зачем это: профиль знаний должен оставаться актуальным — пополняться свежим и забывать то, что давно не подтверждалось (человек сменил стек или роль). Без угасания (decay) профиль раздувается устаревшим.',
  '- Что станет с результатом: не угасить забытое → ложная «экспертиза»; потерять подтверждённое свежим → провал в памяти.',
  '',
  'Правила слияния:',
  '- Категория в обоих профилях → суммируй observationCount, объедини sampleStatements (оставь не более 3 самых сильных и свежих), lastObservedAt = более свежая.',
  '- Категория только в новом → добавь как есть.',
  '- Категория только в старом → оставь, но примени угасание по lastObservedAt:',
  '   * прошло >12 месяцев → удали категорию (не возвращай в JSON);',
  '   * 6–12 месяцев → понизь confidence на один шаг (high→medium, medium→low);',
  '   * <6 месяцев → оставь как есть.',
  '- Experience highlights → объедини, удали дубликаты по смыслу.',
  '',
  '# Чистый русский на выходе',
  'Имена категорий и highlights — чистый русский, без кодов и латиницы (sample-цитаты — дословно). confidence — техническое поле, в текст не вставляй.',
  '',
  '# Примеры (плохо → хорошо)',
  'ПРИМЕР 1 (категория в обоих). «Переговоры с поставщиками»: старый observationCount 3 (medium), новый +2 наблюдения.',
  'ХОРОШО: observationCount 5, confidence можно поднять до high при явном владении, lastObservedAt = свежая, 3 лучшие цитаты.',
  '',
  'ПРИМЕР 2 (угасание — 8 месяцев). Старая категория «Знание Python» high, lastObservedAt 8 месяцев назад, в новом её нет.',
  'ПЛОХО: оставить high.',
  'ХОРОШО: понизить до medium (диапазон 6–12 месяцев).',
  '',
  'ПРИМЕР 3 (полное угасание — 14 месяцев). Та же категория, lastObservedAt 14 месяцев назад.',
  'ХОРОШО: удалить категорию из итогового JSON (вероятно, человек ушёл с этого стека).',
  '',
  '# Перед тем как вернуть ответ — самопроверка',
  '1. Совпадающие категории слиты (observationCount суммирован, ≤3 лучшие цитаты, свежая дата)?',
  '2. Старые неподтверждённые категории угашены по правилу (>12 мес удалить, 6–12 понизить)?',
  '3. Highlights без смысловых дублей?',
  '4. Чистый русский, без кодов и латиницы?',
  '',
  'Верни строго JSON по схеме knowledge_clone_extract_v1 (та же, что у extract). Никакого текста вне JSON.',
  ].join('\n'),
);

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
