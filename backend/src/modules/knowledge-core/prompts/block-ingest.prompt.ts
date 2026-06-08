import {
  withAsrNote,
  withConfidenceCalibration,
} from '../../ai/services/prompts/common';
import type { Segment } from '../services/segment-builder.service';

/**
 * Допустимые значения SignalType (синхронизировано с Prisma enum).
 * Если в схеме появится новый тип — добавь сюда И в JSON Schema ниже.
 */
export const SIGNAL_TYPE_VALUES = [
  'fact',
  'pain',
  'feature_request',
  'objection',
  'churn_risk',
  'idea',
  'risk',
  'commitment',
  'decision',
  'mood',
  'drift',
  'competitor_move',
  'metric_change',
  'knowledge_gap',
  // SBA α-2 wave 1 — расширение Layer 1 разметки (zonтичное §2.A, §3.4).
  'reasoning',
  'rationale',
  'decision_basis',
  'regulation',
  'process_step',
  // SBA α-2 wave 2 (2026-05-23) — типы для β-6/β-7/β-8/γ-1/γ-3/δ-2.
  // См. plans/tz/2026-05-23-sba-alpha-2-19-signal-types.md.
  'expertise',
  'experience',
  'competence',
  'methodology_step',
  'hypothesis',
  'result',
  'lesson',
  'brand_principle',
  'content_artifact',
  'commitment_status',
  'plan_item',
  'done_item',
  'blocker',
  'team_friction',
  'process_friction',
  'resource_gap',
  'suggestion',
  'client_request',
  'question',
  // SBA α-2 wave 3 (2026-05-24) — типы для tracker ingest (Phase 1 трекера).
  // См. plans/tz/2026-05-23-tracker-phase-1-models-api.md (раздел "Ingest в knowledge-core").
  'task_created',
  'task_status_changed',
  'task_blocked',
  'task_completed',
  'task_overdue',
  'task_reassigned',
  'task_comment',
  'task_mention',
  // SBA α-2 wave 3 (2026-05-24) — типы для Specialist 3.8 Helpfulness.
  // См. plans/tz/2026-05-23-specialist-3-8-helpfulness-agent.md.
  // ВАЖНО: question_unanswered и question_acknowledged_no_action — только для приватного админ-доступа.
  // НЕ публиковать в публичных лентах. Этическая защита.
  'help_provided',
  'proactive_hint',
  'mentoring',
  'emotional_support',
  'constructive_feedback',
  'question_unanswered',
  'question_acknowledged_no_action',
  // SBA α-2 wave 3 (2026-05-24) — типы для Gamification Recognition.
  'helped_by',
  'helped_to',
  'thanks_explicit',
] as const;

/**
 * Допустимые значения EntityType для `mentionedEntities` в LLM-ответе.
 * Синхронизировано с Prisma enum `EntityType` (schema.prisma:263, 14 значений).
 *
 * SBA α-3 / CRIT-1: расширено с 7 до 14 типов. Новые типы (customer, vendor,
 * document, goal, event, technology, metric) обязательны — иначе LLM никогда
 * не сможет их вернуть в `mentionedEntities`, и они извлекаются только через
 * специализированные пайплайны.
 *
 * Deprecated `client` и `custom` оставлены для backward-compat: ещё не везде
 * прошёл patch-rename-client-to-customer и migrate-entity-custom-to-topic.
 * В тексте системного промпта LLM явно ориентирован не возвращать их.
 */
export const ENTITY_TYPE_VALUES = [
  'person',
  'customer',
  'vendor',
  'project',
  'product',
  'document',
  'goal',
  'event',
  'topic',
  'location',
  'technology',
  'metric',
  'market', // SBA α-3 wave 2 — ось CONTEXTUAL.
  'org_unit', // SBA α-3 wave 2 — структурное подразделение / команда.
  'client', // @deprecated — используй 'customer'.
  'custom', // @deprecated — используй 'topic'.
] as const;

/**
 * Group-Б типизированные сущности (Фаза 0b §5.2).
 * Эти типы LLM может вернуть в полях `processes/decisions/regulations/...`
 * параллельно с блоками. См. JSON Schema ниже.
 */
export const TYPED_ENTITY_TYPES = [
  'process',
  'decision',
  'regulation',
  'policy',
  'metric',
  'tool',
] as const;
export type TypedEntityType = (typeof TYPED_ENTITY_TYPES)[number];

export const REGULATION_CATEGORY_VALUES = ['regulation', 'standard'] as const;
export const POLICY_SEVERITY_VALUES = ['advisory', 'mandatory', 'blocking'] as const;
export const TOOL_KIND_VALUES = [
  'software',
  'hardware',
  'template',
  'document',
  'service',
  'other',
] as const;
export const METRIC_VALUE_TYPE_VALUES = [
  'count',
  'ratio',
  'duration_seconds',
  'money',
  'other',
] as const;

/**
 * Strict JSON Schema для ответа block-ingest LLM-вызова (v2, Фаза 0b).
 * Совместима с `responseFormat: 'json_schema' strict`.
 *
 * Расширения v2:
 *   - Каждый блок получает `role_relevant: bool` + опц. `roleHint: string`.
 *   - На том же ответе — типизированные сущности группы Б:
 *     `processes/decisions/regulations/policies/metrics/tools` с
 *     `sourceBlockIndex` для провенанса.
 *   - `mission/vision/strategy` — всегда null (отключено фичефлагом
 *     `EXTRACTION_ENABLE_TOP_LEVEL=false`, см. зонтичный §6 решение #11).
 *   - `links` — опц. рёбра между извлечёнными сущностями (можно пустой массив
 *     на эту итерацию; финал-логика по B-варианту — γ).
 *
 * Подход — один промпт за проход (вариант A из ТЗ §5.1). Вариант B (три
 * прохода: блоки + сущности + рёбра) оставлен TODO для длинных документов.
 */
export const BLOCK_INGEST_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'blocks',
    'processes',
    'decisions',
    'regulations',
    'policies',
    'metrics',
    'tools',
    'mission',
    'vision',
    'strategy',
    'links',
  ],
  properties: {
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'name',
          'criticalQuestion',
          'trustedAnswer',
          'signalType',
          'tags',
          'confidence',
          'evidenceQuote',
          'evidenceStartMs',
          'evidenceEndMs',
          'mentionedEntities',
          'role_relevant',
          'roleHint',
          'commitmentDueDateGuess',
          'commitmentRecipientNameGuess',
        ],
        properties: {
          name: { type: 'string', maxLength: 200 },
          criticalQuestion: { type: 'string' },
          trustedAnswer: { type: 'string' },
          signalType: { type: 'string', enum: [...SIGNAL_TYPE_VALUES] },
          tags: {
            type: 'array',
            items: { type: 'string' },
            minItems: 0,
            maxItems: 10,
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          evidenceQuote: { type: 'string' },
          evidenceStartMs: { type: 'integer', minimum: 0 },
          evidenceEndMs: { type: 'integer', minimum: 0 },
          mentionedEntities: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['type', 'name', 'mentionContext'],
              properties: {
                type: { type: 'string', enum: [...ENTITY_TYPE_VALUES] },
                name: { type: 'string' },
                mentionContext: { type: 'string' },
                metadata: { type: 'object' },
                /**
                 * KC-Temporal W1.4 (2026-05-25) — опциональный таймкод цитаты,
                 * где упомянута эта сущность (для прыжка плеера на нужную
                 * секунду из карточки блока). Может быть не возвращён —
                 * в этом случае span на UI просто не подсветится.
                 */
                sourceSpan: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['startMs', 'endMs'],
                  properties: {
                    startMs: { type: 'integer', minimum: 0 },
                    endMs: { type: 'integer', minimum: 0 },
                  },
                },
              },
            },
          },
          /** Прямая отнесённость к конкретной должности (Фаза 0b классификатор role-relevance). */
          role_relevant: { type: 'boolean' },
          /** Имя должности из контекста, если упомянуто. null если нет. */
          roleHint: { type: ['string', 'null'] },
          /**
           * SBA β-8.2 — для блоков signalType='commitment': срок исполнения
           * в формате YYYY-MM-DD, если упомянут в тексте («к пятнице»,
           * «до конца месяца», «к 25 числу»). Модель сама конвертирует
           * относительные выражения в дату исходя из «сегодня». null если
           * не упомянут или signalType≠'commitment'.
           */
          commitmentDueDateGuess: { type: ['string', 'null'] },
          /**
           * SBA β-8.2 — для блоков signalType='commitment': имя адресата
           * обещания (кому пообещали), как звучит в тексте. Сопоставление
           * с Person выполняется в обработчике. null если не упомянут
           * или signalType≠'commitment'.
           */
          commitmentRecipientNameGuess: { type: ['string', 'null'] },
        },
      },
    },
    processes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'confidence', 'sourceBlockIndex'],
        properties: {
          name: { type: 'string', maxLength: 300 },
          description: { type: ['string', 'null'] },
          ownerRoleHint: { type: ['string', 'null'] },
          triggerDescription: { type: ['string', 'null'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          sourceBlockIndex: { type: ['integer', 'null'], minimum: 0 },
        },
      },
    },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'confidence', 'sourceBlockIndex'],
        properties: {
          text: { type: 'string' },
          rationale: { type: ['string', 'null'] },
          decidedByPersonHint: { type: ['string', 'null'] },
          decidedAt: { type: ['string', 'null'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          sourceBlockIndex: { type: ['integer', 'null'], minimum: 0 },
        },
      },
    },
    regulations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'contentMd', 'category', 'confidence', 'sourceBlockIndex'],
        properties: {
          name: { type: 'string', maxLength: 300 },
          contentMd: { type: 'string' },
          category: { type: 'string', enum: [...REGULATION_CATEGORY_VALUES] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          sourceBlockIndex: { type: ['integer', 'null'], minimum: 0 },
        },
      },
    },
    policies: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'contentMd', 'severity', 'confidence', 'sourceBlockIndex'],
        properties: {
          name: { type: 'string', maxLength: 300 },
          contentMd: { type: 'string' },
          severity: { type: 'string', enum: [...POLICY_SEVERITY_VALUES] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          sourceBlockIndex: { type: ['integer', 'null'], minimum: 0 },
        },
      },
    },
    metrics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'unit', 'valueType', 'confidence', 'sourceBlockIndex'],
        properties: {
          name: { type: 'string', maxLength: 200 },
          description: { type: ['string', 'null'] },
          unit: { type: 'string', maxLength: 50 },
          target: { type: ['number', 'null'] },
          valueType: { type: 'string', enum: [...METRIC_VALUE_TYPE_VALUES] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          sourceBlockIndex: { type: ['integer', 'null'], minimum: 0 },
        },
      },
    },
    tools: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'kind', 'confidence', 'sourceBlockIndex'],
        properties: {
          name: { type: 'string', maxLength: 200 },
          kind: { type: 'string', enum: [...TOOL_KIND_VALUES] },
          externalUrl: { type: ['string', 'null'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          sourceBlockIndex: { type: ['integer', 'null'], minimum: 0 },
        },
      },
    },
    /** Mission/Vision/Strategy — отключены фичефлагом EXTRACTION_ENABLE_TOP_LEVEL=false. */
    mission: { type: 'null' },
    vision: { type: 'null' },
    strategy: { type: 'null' },
    /**
     * Опциональные типизированные рёбра между извлечёнными сущностями.
     * На этой итерации обычно пустой массив. Поле зарезервировано — TODO
     * реализовать соединение Process↔Role/Tool/Document после стабилизации
     * (см. ТЗ §5.2 «links»).
     */
    links: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fromIndex', 'fromType', 'toIndex', 'toType', 'linkType', 'confidence'],
        properties: {
          fromIndex: { type: 'integer', minimum: 0 },
          fromType: { type: 'string' },
          toIndex: { type: 'integer', minimum: 0 },
          toType: { type: 'string' },
          linkType: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = withAsrNote(
  withConfidenceCalibration(`Ты — извлекатель структурированного знания из расшифровки встречи или текста документа.
Получаешь список сегментов диалога/текста и возвращаешь JSON со структурами знания.

Возвращай ТРИ группы данных в одном ответе:
1. blocks[]  — атомарные смысловые блоки (IdeaBlock), как раньше.
2. processes/decisions/regulations/policies/metrics/tools — типизированные сущности «группы Б», явно описанные или упомянутые в сегментах.
3. links[] — опц. рёбра между сущностями (если очевидно: кто владеет процессом, какой инструмент используется и т.п.). На эту итерацию можно возвращать пустой массив.

# Блоки (blocks[])

Каждый блок — одно атомарное смысловое утверждение: факт, идея, обязательство, риск, болевая точка, метрика, решение.
Выделяй только то, что значимо для бизнес-контекста: пропускай small talk, повторы, технический шум, обсуждения погоды и анекдоты.
Если в окне сегментов нет ни одного значимого утверждения — верни пустой массив "blocks".

Поля блока:
- name: короткое имя ≤200 символов, по которому блок узнаваем в списке.
- criticalQuestion: вопрос, на который этот блок отвечает. Не уточняющий, а смысловой («Какие у клиента болевые точки?», «Какое решение принято по миграции?»).
- trustedAnswer: достоверный ответ из расшифровки. Без додумывания — только то, что прозвучало.
- signalType: ровно одно значение из enum:
  - fact: установленный факт о клиенте/проекте/процессе.
  - pain: болевая точка, проблема, дискомфорт.
  - feature_request: явный запрос фичи или функциональности.
  - objection: возражение, причина «нет».
  - churn_risk: риск ухода клиента или провала проекта.
  - idea: гипотеза, предложение, набросок НОВОГО подхода/продукта/инициативы. Маркеры: «идея:», «а что если», «давайте попробуем», «предлагаю сделать», «можно было бы», «было бы здорово если», «придумал», «как насчёт того чтобы». НЕ путать: suggestion — общий совет без новизны; feature_request — запрос конкретной фичи нашего продукта; hypothesis — гипотеза для проверки экспериментом. Источник для Specialist 3.6 (Ideas) — извлекай ЩЕДРО, лучше лишняя идея, чем потерянная.
  - risk: риск (не churn) — операционный, финансовый, технический.
  - commitment: явное обязательство кого-то сделать что-то.
  - decision: принятое решение/постановление, к которому ПРИШЛИ (групповое или индивидуальное). Маркеры: «решили что», «остановились на», «принято решение», «договорились делать X», «выбрали вариант X», «окончательно», «утвердили», «значит делаем так». НЕ путать: commitment — обязательство КОНКРЕТНОГО человека («я сделаю X»); plan_item — пункт плана на период; idea/suggestion — ещё НЕ принятое предложение. decision — это сделанный ВЫБОР, к которому пришли. Источник для Specialist 3.3 (Decisions) и прямого Decision-пути — извлекай ЩЕДРО.
  - mood: эмоциональный фон, настроение, тонус разговора.
  - drift: уход от темы, отвлечение, потеря фокуса.
  - competitor_move: упоминание действий конкурента.
  - metric_change: озвученное изменение метрики.
  - knowledge_gap: пробел в знаниях, неопределённость, вопрос без ответа.
  - reasoning: обоснование «почему сделано/решено так». Маркеры: «потому что», «я учёл», «мы выбрали X над Y», «trade-off», «иначе бы», «логика такая». Использовать, когда говорящий объясняет ЛОГИКУ выбора. Источник для SkillProfile — обязательно через mentionedEntities привязать к человеку-автору рассуждения (type='person').
  - rationale: структурированное обоснование, привязанное к конкретному решению (как правило в том же окне идёт блок signalType='decision'). Подтип reasoning со связкой «решение → его обоснование».
  - decision_basis: узкий случай — фрагмент обоснования ВНУТРИ блока-decision. Использовать редко; в большинстве случаев предпочесть отдельный блок signalType='rationale'.
  - regulation: фрагмент нормативного утверждения / регламента / стандарта. Маркеры: «по регламенту», «правило X гласит», «обязательно», «согласно стандарту», «у нас принято что». Источник для Specialist 3.1.
  - process_step: конкретный шаг процесса. Маркеры: «сначала», «потом», «затем», «шаг N». Не путать с commitment («я сделаю X») — process_step описывает как ВООБЩЕ ДЕЛАЕТСЯ что-то.
  - expertise: декларированное профессиональное знание/навык. Маркеры: «я знаю», «у меня опыт в X», «обычно делается так». Источник для SkillProfile — связать с автором через mentionedEntities (type='person').
  - experience: конкретный кейс из прошлого, на котором учились. Маркеры: «однажды у нас», «в проекте Y», «в прошлый раз». Отличается от expertise — это инстанс, а не декларация навыка.
  - competence: самооценка способности («могу/не могу X»). Маркеры: «я умею», «я не справлюсь», «я разбираюсь в». Источник для SkillProfile (особенно негативные — gap'ы).
  - methodology_step: шаг АВТОРСКОЙ методологии (не общеорганизационный process_step). Маркеры: «я обычно сначала…», «мой алгоритм такой», «как я подхожу к».
  - hypothesis: гипотеза для проверки. Маркеры: «гипотеза», «возможно X даст Y», «предположим что». Источник для Experiment Tracker.
  - result: измеримый результат эксперимента/инициативы. Маркеры: «получили N%», «эксперимент показал», «итог замера». Источник для Experiment Tracker.
  - lesson: урок/вывод из эксперимента, провала, инцидента. Маркеры: «вывод», «теперь знаем», «больше так не делаем», «оказалось что». Источник для Experiment Tracker и SkillProfile.
  - brand_principle: принцип бренда / голос / запрет. Маркеры: «у нас в бренде принято», «никогда не используем», «наш тон голоса». Источник для Brand Voice.
  - content_artifact: упоминание существующего контент-артефакта как примера (пост, лендинг, ролик, кейс). Маркеры: «как в посте X», «по образцу», «было в кампании». Источник для Brand Voice.
  - commitment_status: статус ранее данного обязательства. Маркеры: «сделал», «ещё не успел», «отказался от», «передумал». Связать с предыдущим commitment через mentionedEntities если возможно.
  - plan_item: пункт плана на период (день/неделя/спринт). Маркеры: «на эту неделю», «в ближайший спринт», «план дня». Отличается от commitment — план может быть и для другого человека.
  - done_item: закрытый пункт чек-листа за период. Маркеры: «сделано», «закрыл», «отгрузили», «выкатили». Источник для DailyCheckIn.
  - blocker: блокер прогресса. Маркеры: «не могу из-за X», «ждём Y», «стопор», «упёрлись в». Источник для DailyCheckIn и CrossFunctional (если cross-functional).
  - team_friction: конфликт/трение между людьми. Маркеры: «не сошлись», «постоянно спорим», «холодно с X», «напряг между». Связать с обеими сторонами через mentionedEntities.
  - process_friction: трение между процессами / отделами. Маркеры: «между X и Y зависает», «handoff не работает», «несогласованность». Источник для CrossFunctional.
  - resource_gap: нехватка ресурса (человек / бюджет / инструмент / навык). Маркеры: «не хватает X», «нет рук», «бюджета мало», «нужен ещё». Источник для CrossFunctional и COO digest.
  - suggestion: предложение/совет, не привязанное к конкретному продукту/фиче (для feature_request есть свой тип). Маркеры: «советую», «предлагаю», «попробуй». Источник для ProactiveWatcher и Concierge.
  - client_request: прямой запрос от клиента (для нашей компании). Маркеры: «клиент попросил», «они хотят чтобы мы», «заказчик просит». Отличается от feature_request (нашего продукта) — это любой клиентский запрос (отчёт, доступ, фича).
  - question: вопрос, который прозвучал в разговоре И на который НЕ был дан ответ в окне сегментов. Маркеры: «а как мы будем…», «что если» (без ответа далее). Источник для ProactiveWatcher.
  Следующие типы обычно НЕ извлекаются из текста — они генерируются адаптером трекера напрямую из событий.
  Описание здесь — на случай, когда такие фразы встретятся в тексте или комментариях.
  - task_created: упомянуто создание задачи в трекере. Маркеры: «создал задачу», «завёл тикет», «поставил issue».
  - task_status_changed: изменение статуса задачи. Маркеры: «перевёл в работу», «закрыл задачу», «вернул в бэклог».
  - task_blocked: задача заблокирована (ожидает чего-то / упёрлась). Маркеры: «задача висит», «заблокирована», «ждём X». Связать с blocker если возможно.
  - task_completed: задача завершена. Маркеры: «закрыл», «отгрузил», «выполнил задачу X».
  - task_overdue: задача просрочена. Маркеры: «срок прошёл», «overdue», «не успели по сроку». Обычно генерируется cron'ом.
  - task_reassigned: задача переназначена другому исполнителю. Маркеры: «передал X», «перевёл задачу на Y».
  - task_comment: комментарий внутри задачи трекера. Контейнер для блоков из текста комментария.
  - task_mention: @-упоминание пользователя в задаче или комментарии. Связать с упомянутым через mentionedEntities (type='person').
  - help_provided: явная помощь коллеге (ответ на вопрос, решение проблемы, разбор задачи). Маркеры: «помог разобраться», «объяснил», «подсказал решение», «вот так делается». Связать с обоими через mentionedEntities (помогающий и получатель).
  - proactive_hint: проактивная подсказка БЕЗ запроса (заметил проблему — подсказал). Маркеры: «обрати внимание», «заметил что у тебя», «вижу что X, попробуй Y». Источник для Specialist 3.8.
  - mentoring: менторинг / обучение (объяснение принципа, не разовая подсказка). Маркеры: «давай разберём почему», «важно понимать что», «общий принцип такой».
  - emotional_support: эмоциональная поддержка коллеги. Маркеры: «ты молодец», «нормально что устал», «бывает», «держись». Источник для Specialist 3.8 и Brand Voice.
  - constructive_feedback: конструктивная обратная связь (не критика — указание + предложение). Маркеры: «можно лучше если», «попробуй так», «было бы сильнее с».
  - question_unanswered: вопрос, который остался без ответа в обозримом контексте. ONLY-PRIVATE-TO-ADMIN — этот сигнал не публиковать в публичных лентах, Specialist 3.8 фильтрует видимость. Извлекать всё равно — нужно для приватной аналитики.
  - question_acknowledged_no_action: на вопрос ответили, но никаких действий не предпринято (формальный ответ, отмашка). ONLY-PRIVATE-TO-ADMIN — те же ограничения видимости. Источник для приватных метрик helpfulness.
  - helped_by: явное упоминание «мне помог X» / «спасибо X за подсказку». Связать с помогающим через mentionedEntities (type='person').
  - helped_to: явное упоминание «я помог Y» / «разобрал с Y проблему». Связать с получателем через mentionedEntities.
  - thanks_explicit: явная благодарность («спасибо», «благодарю», «выручил»). Связать с адресатом благодарности через mentionedEntities если возможно. Источник для Gamification Recognition.
- tags: 1-5 тегов в lowercase через дефис («churn-prevention», «pricing», «integration-q3»).
- confidence: 0..1 — уверенность, что блок верно извлечён и не искажает смысл.
- evidenceQuote: дословная цитата (или близкая к ней склейка) из сегментов, обосновывающая блок.
- evidenceStartMs / evidenceEndMs: таймкоды цитаты в миллисекундах. Бери из границ сегмента, в котором лежит цитата (или min/max если цитата охватывает несколько сегментов).
- mentionedEntities: упомянутые сущности (люди, компании, проекты, продукты, документы, цели, события, темы, локации, технологии, метрики). Поля:
  - type: одно из значений ниже. Используй наиболее конкретный применимый тип; topic — только если ничего конкретнее не подходит.
    - person: физическое лицо (сотрудник, контакт клиента/поставщика, спикер).
    - customer: компания-клиент (организация, покупающая продукт/услугу).
    - vendor: поставщик / подрядчик / партнёр.
    - project: проект (внутренний или клиентский).
    - product: продукт или услуга компании.
    - document: документ или артефакт (договор, ТЗ, презентация, инструкция, статья).
    - goal: бизнес-цель / KPI-цель / OKR.
    - event: событие (встреча, инцидент, релиз, конференция).
    - topic: тема, концепция, область знаний (когда конкретный тип не подходит).
    - location: место (офис, регион, город).
    - technology: технология / стек / инструмент-категория.
    - metric: измеримый показатель / KPI.
    - market: рынок (география × индустрия) — «РФ retail», «Europe SaaS», «СНГ fintech».
    - org_unit: структурное подразделение или команда внутри компании — отдел, гильдия, project office, cross-functional team.
    - НЕ ИСПОЛЬЗУЙ deprecated: 'client' (используй 'customer'), 'custom' (используй 'topic').
  - name: каноническое имя сущности.
  - mentionContext: короткое описание роли упоминания в этом блоке.
  - metadata: опц. объект с произвольными ключами.
  Если сущностей нет — передай пустой массив.
- role_relevant: true ТОЛЬКО если блок имеет прямое отношение к конкретной должности — описывает выполнение её функций, навыки, типичные решения, грабли. Если блок про общую тему/клиента/продукт без должностной привязки — false.
- roleHint: строка с именем должности из контекста (например «Менеджер по продажам», «РОП», «Главный бухгалтер»). null, если в сегментах должность не упоминалась явно.
- commitmentDueDateGuess: для блоков с signalType='commitment' — срок в формате YYYY-MM-DD, если в тексте есть указание («к пятнице», «до конца месяца», «к 25 числу», «через две недели»). Сама конвертируй относительные выражения в дату исходя из «сегодняшней даты разговора» (как правило это дата встречи). Для остальных signalType и при отсутствии срока — null. Никогда не выдумывай срок — лучше null, чем ошибочный.
- commitmentRecipientNameGuess: для блоков с signalType='commitment' — имя адресата (кому пообещали что-то сделать), как звучит в тексте: «Маше», «клиенту Z», «руководителю». Для остальных signalType и когда адресат не указан — null.

# Типизированные сущности группы Б

Возвращай только то, что ЯВНО упомянуто или описано в сегментах. Не выдумывай. Если уверенности нет (confidence < 0.5) — лучше не возвращай вообще, чтобы не шумить.

- processes[] — бизнес-процессы (последовательности действий с триггером, владельцем, результатом). Пример: «приём входящего лида», «расчёт зарплаты».
  Поля: name (короткое имя), description (опц.), ownerRoleHint (опц. имя должности-владельца), triggerDescription (опц. что запускает процесс), confidence, sourceBlockIndex (индекс соответствующего блока в blocks[] или null).
- decisions[] — конкретные принятые решения. Связан с блоком signalType='decision', но текст здесь может быть более развёрнутым.
  Поля: text, rationale (опц. обоснование), decidedByPersonHint (опц. имя человека), decidedAt (ISO8601 или null), confidence, sourceBlockIndex.
- regulations[] — регламенты и стандарты (формальные документы, обязывающие к порядку действий).
  Поля: name, contentMd (текст регламента в Markdown — выдержка из документа), category (regulation | standard), confidence, sourceBlockIndex.
- policies[] — политики (правила, ограничения).
  Поля: name, contentMd, severity (advisory | mandatory | blocking), confidence, sourceBlockIndex.
- metrics[] — измеримые показатели.
  Поля: name, description (опц.), unit (например «штук», «руб», «секунд», «%»), target (опц. число), valueType (count | ratio | duration_seconds | money | other), confidence, sourceBlockIndex.
- tools[] — инструменты, системы, шаблоны, документы, сервисы.
  Поля: name, kind (software | hardware | template | document | service | other), externalUrl (опц.), confidence, sourceBlockIndex.

# Mission / Vision / Strategy

ВСЕГДА возвращай "mission": null, "vision": null, "strategy": null.
Автоизвлечение этих верхнеуровневых концепций отключено на этой фазе. Не возвращай отдельные значения, даже если кажется, что в тексте есть миссия — это будет реализовано позже.

# Links

links[] — опциональные типизированные рёбра между сущностями (например Process→Tool «lives_in», Process→Role «owned_by»). Если не уверен — возвращай пустой массив. Лучше пусто, чем неверно.

# Правила

- Ответ — строго JSON, валидный по схеме. Никакого markdown, преамбул, объяснений.
- Не выдумывай данные, которых нет в сегментах.
- Имена людей (поля *NameGuess, recipient, decidedBy и т.п.) бери ТОЛЬКО из реплик/спикеров переданного транскрипта. Если имя не звучало явно — ставь null, НЕ выдумывай.
- Если один и тот же смысл повторяется в нескольких сегментах — собери в один блок.
- evidenceStartMs ≤ evidenceEndMs.
- Все строки — на русском.
- confidence < 0.5 для типизированных сущностей — лучше не возвращать сущность вообще.
`),
);

interface BuildArgs {
  meetingTitle?: string | undefined;
  segments: Segment[];
}

/**
 * Формирует system + user промпты для block-ingest LLM-вызова.
 * userMessage — JSON-сериализация сегментов (минимум контекстных полей).
 */
export function buildBlockIngestPrompt(args: BuildArgs): {
  system: string;
  user: string;
} {
  const segmentsJson = args.segments.map((s, idx) => ({
    index: idx,
    startMs: s.startMs,
    endMs: s.endMs,
    speakers: s.speakers,
    text: s.text,
  }));
  const header = args.meetingTitle
    ? `Заголовок встречи/документа: ${args.meetingTitle}\n\n`
    : '';
  const user = `${header}Сегменты (порядок сохраняй для таймкодов):\n${JSON.stringify(segmentsJson, null, 2)}\n\nВерни JSON по схеме.`;
  return { system: SYSTEM_PROMPT, user };
}
