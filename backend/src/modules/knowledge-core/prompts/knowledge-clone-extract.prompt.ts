/**
 * SBA β-2 — Specialist 3.2 (Knowledge Clone).
 *
 * LLM-промпт `knowledge-clone-extract` — из набора IdeaBlock'ов одного
 * сотрудника извлекает структурированный черновик «профиля знаний»:
 * категории компетенции (эмерджентные, не enum), наблюдения (observation
 * count + цитаты), связанные сущности и значимый опыт.
 *
 * Цель: сжать накопленные блоки в короткий профиль вида «человек разбирается
 * в X, Y и Z».
 *
 * NB: категории — это `string`-имена (не enum), потому что области
 * экспертизы заранее не известны и зависят от компании / роли. JSON Schema
 * запрещает дополнительные ключи (`additionalProperties=false`), но имена
 * категорий — свободные.
 */

import {
  withAsrNote,
  withPeopleHypothesisGuard,
} from '../../ai/services/prompts/common';

import { signalTypeLabel } from './signal-type-label';

// A5 (2026-06-10): «профиль знаний» — это оценка экспертизы конкретного человека
// (компетенции, уверенность по темам). `withPeopleHypothesisGuard` оборачивает
// весь SYSTEM снаружи (его текст ложится в самый КОНЕЦ — cache-friendly): оценки
// навыков остаются гипотезами по наблюдаемым блокам, а не вердиктом о сотруднике.
export const KNOWLEDGE_CLONE_EXTRACT_SYSTEM_PROMPT = withPeopleHypothesisGuard(
  withAsrNote(
  [
  'Ты — knowledge-инженер компании «Кора», который строит «профиль знаний» сотрудника по тому, что он говорил и делал на встречах и в документах. Тебе дают набор блоков знания (атомарных фактов, решений, рассуждений, комментариев) этого человека.',
  '',
  '# Что держать в голове (смысл задачи)',
  '- Зачем это: профиль знаний отвечает на вопрос «кто в компании разбирается в X» и сохраняет экспертизу человека, даже когда он уходит. Это фундамент цифрового двойника роли.',
  '- Кому уйдёт результат: карточка компетенций в кабинете и поиск экспертов; это оценка человека — приватная гипотеза, не публичный вердикт.',
  '- Что станет с результатом: выдуманная компетенция вводит в заблуждение «кто эксперт»; раздробленные мелкие категории делают профиль нечитаемым.',
  '',
  'Извлеки компактный профиль на русском языке по схеме.',
  '',
  'Что такое категория знания:',
  '- Область, в которой человек проявил экспертизу или опыт («AI-конвейер обработки знаний», «онбординг новых сотрудников», «переговоры с поставщиками»).',
  '- Категории эмерджентные — ты сам формулируешь их по сути блоков, человеческими словами; не используй жёсткие шаблоны и не дроби слишком мелко (объединяй похожее).',
  '',
  'Confidence по категории:',
  '- "high" — экспертиза подтверждена несколькими разными блоками (≥4 наблюдений) или явным владением темой;',
  '- "medium" — 2–3 наблюдения с уверенными высказываниями;',
  '- "low" — 1 наблюдение или тема упомянута вскользь.',
  '',
  'Sample statements (1–3 на категорию) — короткие цитаты из блоков с blockId-источником.',
  'Experience highlights — отдельные значимые опыты, не вписавшиеся в категории («запустил миграцию в первом квартале»). Опционально.',
  '',
  'Не выдумывай знания вне блоков. Мало данных (1–3 блока) → одна категория low/medium, experienceHighlights пустой.',
  '',
  '# Чистый русский на выходе',
  'Имена категорий и тексты highlights — на чистом русском, без кодов, латиницы и идентификаторов (исключение — sample-цитаты приводятся дословно, как сказал человек). Уровень confidence — техническое поле из схемы, в текст его словом не вставляй.',
  '',
  '# Примеры (плохо → хорошо)',
  'ПРИМЕР 1 (сильная категория, несколько блоков). 5 блоков сотрудника про устройство конвейера обработки знаний.',
  'ПЛОХО: 5 мелких категорий по одной на блок; имя «knowledge-core AI pipeline».',
  'ХОРОШО: одна категория name «Проектирование AI-конвейера обработки знаний», confidence "high", observationCount 5, 3 sample-цитаты с blockId.',
  '',
  'ПРИМЕР 2 (мало данных). 1 блок, где человек вскользь упомянул переговоры с поставщиком.',
  'ПЛОХО: confidence "high", выдуманные детали опыта.',
  'ХОРОШО: одна категория «Переговоры с поставщиками», confidence "low", observationCount 1, experienceHighlights пустой.',
  '',
  'ПРИМЕР 3 (чистое имя категории). Блоки про работу с метриками удержания и выручки.',
  'ПЛОХО: name «Growth & retention analytics».',
  'ХОРОШО: name «Анализ удержания и выручки».',
  '',
  '# Перед тем как вернуть ответ — самопроверка',
  '1. Категории эмерджентные и укрупнённые (похожее объединено, не раздроблено по блокам)?',
  '2. confidence соответствует числу наблюдений (high — только при ≥4 или явном владении)?',
  '3. У каждой категории есть sample-цитаты с реальным blockId?',
  '4. Ничего не выдумано вне блоков; при 1–3 блоках профиль скромный?',
  '5. Имена категорий и highlights — чистый русский, без кодов и латиницы?',
  '',
  'Верни строго JSON по схеме knowledge_clone_extract_v1. Никакого текста вне JSON.',
  ].join('\n'),
  ),
);

export interface KnowledgeCloneExtractBlockInput {
  blockId: string;
  name: string;
  signalType: string;
  criticalQuestion: string;
  trustedAnswer: string;
  tags: readonly string[];
  relatedEntityIds: readonly string[];
  createdAt: string;
  /** Короткие цитаты из IdeaBlockEvidence (до 3 на блок). */
  quotes: readonly string[];
}

export const KNOWLEDGE_CLONE_EXTRACT_USER_TEMPLATE = (args: {
  personName: string;
  blocks: readonly KnowledgeCloneExtractBlockInput[];
}): string => {
  const blockLines = args.blocks.slice(0, 60).map((b, i) => {
    const quotes = b.quotes.length
      ? b.quotes
          .slice(0, 3)
          .map((q) => `    цитата: «${q.slice(0, 300)}»`)
          .join('\n')
      : '    (цитат нет)';
    const tags = b.tags.length ? b.tags.join(', ') : '(нет)';
    return [
      `${i + 1}. blockId=${b.blockId} (${signalTypeLabel(b.signalType)}, ${b.createdAt})`,
      `   тема: ${b.name}`,
      `   вопрос: ${b.criticalQuestion}`,
      `   ответ: ${b.trustedAnswer}`,
      `   теги: ${tags}`,
      quotes,
    ].join('\n');
  });
  return [
    `Сотрудник: ${args.personName}`,
    `Блоков-источников: ${args.blocks.length}`,
    '',
    'Блоки (от свежих к более старым):',
    blockLines.join('\n\n'),
    '',
    'Верни JSON-объект по схеме `knowledge_clone_extract_v1`.',
  ].join('\n');
};

/**
 * JSON Schema strict для `knowledge-clone-extract`. Поддерживается DeepSeek V4
 * и OpenAI Responses API; Ollama (qwen3) фоллбэк может падать с
 * `LlmFormatNotSupportedError` — роутер перейдёт к secondary/primary.
 */
export const KNOWLEDGE_CLONE_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['categories', 'experienceHighlights'],
  properties: {
    categories: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'name',
          'confidence',
          'observationCount',
          'sampleStatements',
          'relatedEntityIds',
          'lastObservedAt',
        ],
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 200 },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          observationCount: { type: 'integer', minimum: 1, maximum: 1_000 },
          sampleStatements: {
            type: 'array',
            maxItems: 3,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['quote', 'blockId'],
              properties: {
                quote: { type: 'string', minLength: 2, maxLength: 600 },
                blockId: { type: 'string', minLength: 1, maxLength: 64 },
              },
            },
          },
          relatedEntityIds: {
            type: 'array',
            maxItems: 20,
            items: { type: 'string', minLength: 1, maxLength: 64 },
          },
          lastObservedAt: { type: 'string', minLength: 10, maxLength: 40 },
        },
      },
    },
    experienceHighlights: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'blockIds'],
        properties: {
          summary: { type: 'string', minLength: 5, maxLength: 400 },
          blockIds: {
            type: 'array',
            maxItems: 10,
            items: { type: 'string', minLength: 1, maxLength: 64 },
          },
        },
      },
    },
  },
};

export const KNOWLEDGE_CLONE_EXTRACT_SCHEMA_NAME = 'knowledge_clone_extract_v1';
