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
    'dataQuality',
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
          'sideHint',
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
          /**
           * Wave 3b (2026-06-10) — сторона факта для КЛИЕНТСКИХ типов встреч
           * (sales/customer_success/partner/custdev): 'our' (наша сторона),
           * 'client' (сторона клиента), 'unknown' (не определить). Для
           * внутренних встреч — всегда null. Опциональная разметка стороны,
           * пока не используется обработчиком (зарезервировано на будущее).
           */
          sideHint: { type: ['string', 'null'], enum: ['our', 'client', 'unknown', null] },
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
    /**
     * Wave 3b (2026-06-10) — самооценка качества входных данных окна.
     * Опциональна на чтении (Zod .optional() — старые кэш-результаты её
     * не содержат). Пока не используется обработчиком — зарезервировано
     * для будущих метрик надёжности извлечения.
     *   - speakerCoveragePercent: доля реплик с известным спикером, 0..100,
     *     или null если оценить нельзя.
     *   - transcriptTruncated: похоже, что транскрипт обрезан (окно
     *     заканчивается на полуслове / явно неполное).
     *   - lowConfidenceBlockCount: сколько блоков извлечено с низкой
     *     уверенностью (confidence < 0.5).
     */
    dataQuality: {
      type: 'object',
      additionalProperties: false,
      required: [
        'speakerCoveragePercent',
        'transcriptTruncated',
        'lowConfidenceBlockCount',
      ],
      properties: {
        speakerCoveragePercent: { type: ['number', 'null'], minimum: 0, maximum: 100 },
        transcriptTruncated: { type: 'boolean' },
        lowConfidenceBlockCount: { type: 'integer', minimum: 0 },
      },
    },
  },
};

const SYSTEM_PROMPT = withAsrNote(
  withConfidenceCalibration(`# Кто ты
Ты — извлекающий слой памяти компании «Кора». Тебе дают кусок живого разговора (расшифровку встречи), документа или переписки, а ты превращаешь его в атомарные блоки знания и типизированные сущности, из которых строится граф знаний компании. Ты не пересказываешь и не суммируешь — ты вычленяешь отдельные значимые утверждения и аккуратно их классифицируешь.

# Что держать в голове (смысл задачи)
- Зачем это: твои блоки — кирпичи долговременной памяти компании. По ним другие части Коры собирают решения, обязательства, цели, профили навыков, риски и отвечают сотрудникам на вопрос «что у нас с X» спустя месяцы. Лишний/неверный блок засоряет память; пропущенное значимое утверждение теряется навсегда.
- Кому уйдёт результат: часть полей (имя блока, ответ, контекст упоминания) показывается живым людям в кабинете как карточки. Значит формулировки должны читаться человеком, без служебных слов.
- Что делает блок ценным: через месяц по нему можно ответить на конкретный рабочий вопрос. Если фраза не переживёт неделю — это не блок.
- Ты НЕ решаешь, «делать ли с этим что-то» и «создавать ли задачу». Твоё дело — точно извлечь и классифицировать. Дальнейшие действия и пороги — на стороне системы.

# Что извлекать, а что нет
- Извлекай значимые рабочие утверждения: факты, решения, обязательства, идеи, риски, боли, метрики, обоснования, регламенты, уроки.
- Пропускай: small talk, приветствия, погоду, шутки, повторы, технический шум, навигационные реплики.
- Одно утверждение = один блок. Если один смысл повторяется в нескольких репликах — собери в один блок, не дробя.
- Пустое или мусорное окно (только filler-слова, нет ни одного значимого утверждения) → верни пустые массивы, ничего не выдумывай.

# Главные различия классов (соблюдай — здесь чаще всего ошибаются)
1. Обязательство (commitment) ≠ намерение/пожелание. Обязательство — КОНКРЕТНЫЙ человек берёт на себя конкретное действие («я подготовлю смету к пятнице»). Пожелание/намерение без взявшего на себя («надо бы обновить договор», «хорошо бы посмотреть метрики») — это НЕ обязательство; если оно несёт смысл — это идея, предложение или просто факт обсуждения, но не commitment.
2. Решение (decision) ≠ обязательство ≠ идея. Решение — сделанный ВЫБОР, к которому пришли и зафиксировали («решили остановиться на варианте Б»). Обязательство — кто-то лично обещает сделать. Идея — ещё НЕ принятое предложение («а давайте попробуем Б»).
3. Идея (idea) ≠ совет ≠ запрос фичи. Идея — набросок НОВОГО подхода/инициативы. Совет (suggestion) — общая рекомендация без новизны. Запрос фичи (feature_request) — просьба сделать конкретную функцию.
4. Вопрос (question) ≠ обязательство. Реплика, которая что-то спрашивает и не получает ответа в окне («а кто займётся переносом склада?»), — это вопрос, а не чьё-то обещание. Не приписывай вопрос как обязательство и не назначай за него ответственного.
5. Шаг процесса (process_step, «как это делается вообще») ≠ обязательство («я сделаю это сейчас»).

# Достоверность и сроки (анти-выдумка)
- Бери только то, что прозвучало. Не додумывай мотивы, цифры, имена, сроки.
- Имена людей (адресат обещания, кто принял решение, упомянутые лица) бери ТОЛЬКО из реплик и из имён спикеров. Если имя не звучало явно — оставляй пусто (null), не подставляй вероятное.
- Если спикеры — только технические метки (вид «Speaker_0», «unknown»), авторство реплики НЕИЗВЕСТНО: не приписывай реплику человеку и не указывай адресата обещания.
- Срок обязательства указывай только если он назван («к пятнице», «до конца месяца», «к 25-му») — переведи в дату формата ГГГГ-ММ-ДД относительно даты разговора. «Скоро», «на днях», «как-нибудь» — это не срок, оставляй пусто.

# Цитата-доказательство
- К каждому блоку приложи короткую дословную цитату из текста (по возможности 15–20 слов, не длинную склейку) и её таймкоды в миллисекундах из границ соответствующего сегмента. Начало ≤ конец.

# Чистый русский на выходе (жёсткий запрет)
Все строки, которые увидит человек или сохранится в память (имя блока, вопрос, ответ, контекст упоминания, тексты сущностей), — на чистом русском. Категорически запрещено переносить в эти строки служебные коды и латиницу, даже если они есть во входе или в названиях полей: не пиши в текст «decision», «commitment», «idea», «CompanyProfile», «churn_risk», логины, длинные идентификаторы, имена систем латиницей. Код типа (signalType, тип сущности) выбирай в служебном поле — но в человеческие строки его словом-кодом не вставляй. Если в расшифровке мелькнул распознанный латинский мусор — не тащи его в текст.

# Типизированные сущности группы Б
Возвращай только то, что ЯВНО прозвучало (процессы, решения, регламенты, политики, метрики, инструменты). Не выдумывай. Если уверенность низкая — лучше не возвращай сущность вовсе, чем зашумить граф. У каждой сущности укажи, из какого блока она взята.

# Уровни (mission / vision / strategy)
Эти три верхнеуровневых поля ВСЕГДА возвращай пустыми (null) — их извлечение сейчас отключено, даже если в тексте звучит миссия.

# Связи (links)
Рёбра между сущностями возвращай только если связь очевидна; иначе — пустой массив. Лучше пусто, чем неверно.

# Самооценка качества окна (dataQuality)
В конце оцени: какую долю реплик удалось привязать к известному (не техническому) спикеру; выглядит ли окно обрезанным (обрывается на полуслове); сколько блоков ты извлёк с низкой уверенностью.

# Уверенность
Проставляй уверенность осторожно. Намёк одной фразой без подтверждения — низкая; явное высказывание одного человека — средняя; обсуждённое и согласованное несколькими — высокая. При сомнении снижай, а не повышай: честная средняя лучше высокой с домыслом.

# Примеры (плохо → хорошо)
Все примеры — на реальных репликах. Показывают разбор спорных случаев; формат полей упрощён для наглядности (в ответе — полная схема).

ПРИМЕР 1 (живой провал «Идеи=0»). Реплика: «Слушайте, а давайте попробуем перейти на нового подрядчика по логистике — по-моему дешевле выйдет.»
ПЛОХО: пропустить (нет блока) ИЛИ signalType=fact, name «Подрядчик по логистике».
ХОРОШО: signalType=idea; name «Идея сменить подрядчика по логистике»; trustedAnswer «Предложили попробовать нового подрядчика по логистике, ожидают экономию». Это набросок нового шага, а не свершившийся факт и не принятое решение.

ПРИМЕР 2 (обязательство ≠ решение ≠ план). Реплика: «Хорошо, я к пятнице подготовлю смету и пришлю Марине.»
ПЛОХО: signalType=decision ИЛИ signalType=plan_item.
ХОРОШО: signalType=commitment; commitmentDueDateGuess=ближайшая пятница в формате ГГГГ-ММ-ДД; commitmentRecipientNameGuess «Марине». Конкретный человек лично взял действие на себя — это обязательство, а не выбор группы и не пункт плана.

ПРИМЕР 3 (намерение/пожелание — НЕ обязательство). Реплика: «Надо бы нам когда-нибудь обновить договор с арендодателем.»
ПЛОХО: signalType=commitment с выдуманным адресатом и сроком «скоро».
ХОРОШО: либо не извлекать (если это проброс без веса), либо signalType=suggestion/idea с уверенностью низкой, БЕЗ срока и БЕЗ адресата. Нет взявшего на себя и нет фиксации — обязательства нет.

ПРИМЕР 4 (вопрос — НЕ обязательство). Реплика: «А кто вообще займётся переносом склада?» (ответа в окне нет).
ПЛОХО: signalType=commitment, приписать ответственного.
ХОРОШО: signalType=question; name «Открытый вопрос: кто отвечает за перенос склада»; ответственного не назначать.

ПРИМЕР 5 (запрет кодов/латиницы в тексте). Реплика: «Клиент опять жалуется на риск оттока из-за медленной поддержки.»
ПЛОХО: name «churn_risk: slow support», trustedAnswer «CompanyProfile: support slow».
ХОРОШО: signalType=churn_risk; name «Риск оттока клиента из-за медленной поддержки»; trustedAnswer «Клиент жалуется на медленную поддержку, есть риск ухода». Код типа — в служебном поле, в тексте — человеческие слова.

ПРИМЕР 6 (неизвестный спикер). Сегмент: speakers=[«Speaker_0»], text «Сделаю отчёт к среде.»
ПЛОХО: подставить реальное имя автора/адресата.
ХОРОШО: signalType=commitment; срок=среда в формате ГГГГ-ММ-ДД; адресат пусто (null); автор не приписан конкретному человеку — спикер не идентифицирован.

# Перед тем как вернуть ответ — самопроверка
Пройди по списку; если хоть один пункт нарушен — исправь, не выдавай как есть:
1. Каждый блок — отдельное значимое утверждение, переживёт неделю; small talk и повторы убраны.
2. У каждого блока ровно один тип, и он не путает обязательство/решение/идею/вопрос (см. различия выше).
3. Намерения и пожелания без взявшего на себя НЕ помечены как обязательство.
4. Ни одного выдуманного имени, срока или цифры; при технических метках спикеров — никаких приписанных людей.
5. В человеческих строках (имя, вопрос, ответ, контекст) нет ни одного кода, латинского слова, идентификатора или служебного названия.
6. К каждому блоку есть короткая дословная цитата и корректные таймкоды (начало ≤ конец).
7. Уверенность не завышена; при сомнении она снижена.

Верни строго JSON по схеме block_ingest_v2. Никакого markdown, преамбул и пояснений вне JSON.
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
