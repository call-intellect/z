/**
 * SBA α-7 wave 2 — `process-template-extract` LLM-промпт.
 *
 * Извлекает ProcessTemplate-кандидатов из батча IdeaBlock'ов
 * (signalType=`process_step` или `methodology_step`). Возвращает массив
 * кандидатов, каждый — name + summary + список шагов.
 *
 * Используется `ProcessExtractionService` через `LlmRouterService` (тройная
 * цепочка primary/secondary/tertiary, маршрутизация см.
 * `backend/scripts/seed-llm-task-routes-process-template.ts`).
 */

import {
  withAsrNote,
  withConfidenceCalibration,
  withDecisionDiscriminator,
  withEdgeCasePolicy,
} from '../../ai/services/prompts/common';

import { signalTypeLabel } from './signal-type-label';

export const PROCESS_TEMPLATE_EXTRACT_SYSTEM_PROMPT = withAsrNote(
  withDecisionDiscriminator(
  withEdgeCasePolicy(
  withConfidenceCalibration(
    [
    'Ты — knowledge-инженер компании «Кора». Тебе дают пачку блоков знания (критический вопрос ↔ доверенный ответ + цитаты), описывающих повторяющиеся процессы и методики компании.',
    '',
    '# Что держать в голове (смысл задачи)',
    '- Зачем это: шаблон процесса — это «как мы делаем X» по шагам; он переживает увольнения и обучает новых сотрудников делать так же.',
    '- Кому уйдёт результат: каталог процессов компании.',
    '- Что станет с результатом: выдуманный или дублирующий шаблон засоряет каталог; разовое действие, принятое за процесс, плодит мусор.',
    '',
    'Собери черновики «шаблонов процессов». Один шаблон = один повторяемый процесс с понятным результатом и шагами. Несколько разных процессов в пачке → несколько шаблонов. Если процесс дублирует существующий (есть в existingTemplates) — используй тот же name, чтобы система объединила их новой версией, а не создала дубль.',
    '',
    'У каждого шаблона укажи: name (короткое), summary (1–3 предложения), category из {hire | sales | incident | onboarding | release | finance | support | custom}, упорядоченный список шагов (1..30) с name, description, ownerRoleHint, inputArtifact, outputArtifact (если упомянуты).',
    '',
    'Извлекай только повторяемый процесс («как делаем всегда»), а не разовое поручение на эту встречу.',
    '',
    '# Чистый русский на выходе',
    'name, summary, тексты шагов, ownerRoleHint, артефакты — на чистом русском, без кодов и латиницы. category — техническое поле из схемы, в человеческий текст его не вставляй.',
    '',
    '# Примеры (плохо → хорошо)',
    'ПРИМЕР 1 (процесс между ролями). Вход: «Когда приходит заявка нового клиента, менеджер заводит карточку в CRM, потом юрист готовит договор, после подписания бухгалтерия выставляет счёт».',
    'ХОРОШО: templates[0] = {"name":"Онбординг нового клиента","summary":"Приём заявки нового клиента: от карточки в CRM до выставления счёта.","category":"onboarding","confidence":0.8,"steps":[{"order":1,"name":"Завести карточку в CRM","ownerRoleHint":"Менеджер","inputArtifact":"Заявка клиента","outputArtifact":"Карточка в CRM"},{"order":2,"name":"Подготовить договор","ownerRoleHint":"Юрист","inputArtifact":"Карточка в CRM","outputArtifact":"Договор"},{"order":3,"name":"Выставить счёт","ownerRoleHint":"Бухгалтерия","inputArtifact":"Подписанный договор","outputArtifact":"Счёт"}]}.',
    '',
    'ПРИМЕР 2 (методика одной роли). Вход: «Перед публикацией статьи редактор делает вычитку, проверку фактов и SEO-разметку».',
    'ХОРОШО: templates[0] = {"name":"Подготовка статьи к публикации","category":"custom","confidence":0.75,"steps":[{"order":1,"name":"Вычитка","ownerRoleHint":"Редактор"},{"order":2,"name":"Проверка фактов","ownerRoleHint":"Редактор"},{"order":3,"name":"SEO-разметка","ownerRoleHint":"Редактор"}]}.',
    '',
    'ПРИМЕР 3 (разовое — НЕ процесс). Вход: «Давай на этой неделе соберёмся и обсудим редизайн лендинга».',
    'ПЛОХО: создать шаблон «Редизайн лендинга».',
    'ХОРОШО: не извлекать (templates пустой) — это разовая договорённость на встречу, а не повторяемый процесс.',
    '',
    'ПРИМЕР 4 (дубль существующего). В existingTemplates уже есть «Онбординг нового клиента», в блоках снова описан тот же процесс.',
    'ХОРОШО: верни шаблон с тем же name «Онбординг нового клиента» (система объединит как новую версию), не выдумывай новое имя.',
    '',
    '# Перед тем как вернуть ответ — самопроверка',
    '1. Каждый шаблон — повторяемый процесс, а не разовое поручение?',
    '2. Дубли существующих шаблонов используют их name (не плодят новые)?',
    '3. Шаги упорядочены, у каждого понятное действие и (по возможности) роль-владелец?',
    '4. Ничего не выдумано вне блоков?',
    '5. Тексты — чистый русский, без кодов и латиницы?',
    '',
    'Верни строго JSON по схеме process_template_extract_v1. Никакого текста вне JSON.',
    ].join('\n'),
  ),
  ),
  ),
);

export const PROCESS_TEMPLATE_EXTRACT_USER_TEMPLATE = (args: {
  blocks: ReadonlyArray<{
    id: string;
    signalType: string;
    criticalQuestion: string;
    trustedAnswer: string;
    quotes: readonly string[];
  }>;
  existingTemplates: ReadonlyArray<{
    id: string;
    name: string;
    summary: string | null;
  }>;
}): string => {
  const blocksText = args.blocks
    .map((b, i) => {
      const qs = b.quotes.length
        ? b.quotes.map((q) => `  «${q}»`).join('\n')
        : '  (цитат нет)';
      return [
        `Блок #${i + 1} [${signalTypeLabel(b.signalType)}]:`,
        `  Вопрос: ${b.criticalQuestion}`,
        `  Ответ: ${b.trustedAnswer}`,
        `  Цитаты:`,
        qs,
      ].join('\n');
    })
    .join('\n\n');
  const existingText = args.existingTemplates.length
    ? args.existingTemplates
        .map(
          (t) =>
            `- «${t.name}»${t.summary ? `: ${t.summary.slice(0, 200)}` : ''}`,
        )
        .join('\n')
    : '(пока шаблонов нет)';
  return [
    'Существующие шаблоны процессов:',
    existingText,
    '',
    'Атомы знаний для извлечения:',
    blocksText,
    '',
    'Верни JSON по схеме process_template_extract_v1.',
  ].join('\n');
};

export const PROCESS_TEMPLATE_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['templates'],
  properties: {
    templates: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'steps', 'confidence'],
        properties: {
          name: { type: 'string', minLength: 3, maxLength: 300 },
          summary: { type: ['string', 'null'], maxLength: 2_000 },
          category: {
            type: ['string', 'null'],
            enum: [
              null,
              'hire',
              'sales',
              'incident',
              'onboarding',
              'release',
              'finance',
              'support',
              'custom',
            ],
          },
          scope: { type: ['string', 'null'], maxLength: 120 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          steps: {
            type: 'array',
            minItems: 1,
            maxItems: 30,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['order', 'name'],
              properties: {
                order: { type: 'integer', minimum: 1, maximum: 999 },
                name: { type: 'string', minLength: 2, maxLength: 200 },
                description: { type: ['string', 'null'], maxLength: 2_000 },
                ownerRoleHint: { type: ['string', 'null'], maxLength: 200 },
                inputArtifact: { type: ['string', 'null'], maxLength: 300 },
                outputArtifact: { type: ['string', 'null'], maxLength: 300 },
                slaMinutes: {
                  type: ['integer', 'null'],
                  minimum: 0,
                  maximum: 1_000_000,
                },
              },
            },
          },
        },
      },
    },
  },
};

export const PROCESS_TEMPLATE_EXTRACT_SCHEMA_NAME =
  'process_template_extract_v1';
