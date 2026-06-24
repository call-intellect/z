import {
  withAsrNote,
  withConfidenceCalibration,
  withDecisionDiscriminator,
} from '../../ai/services/prompts/common';
import type { Segment } from '../services/segment-builder.service';

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
  'reasoning',
  'rationale',
  'decision_basis',
  'regulation',
  'process_step',
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
  'action_item',
  'done_item',
  'blocker',
  'team_friction',
  'process_friction',
  'resource_gap',
  'suggestion',
  'client_request',
  'question',
  'task_created',
  'task_status_changed',
  'task_blocked',
  'task_completed',
  'task_overdue',
  'task_reassigned',
  'task_comment',
  'task_mention',
  'help_provided',
  'proactive_hint',
  'mentoring',
  'emotional_support',
  'constructive_feedback',
  'question_unanswered',
  'question_acknowledged_no_action',
  'helped_by',
  'helped_to',
  'thanks_explicit',
] as const;

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
  'market',
  'org_unit',
  'client',
  'custom',
] as const;

export const TYPED_ENTITY_TYPES = [
  'process',
  'decision',
  'regulation',
  'policy',
  'metric',
  'tool',
] as const;

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
          role_relevant: { type: 'boolean' },
          roleHint: { type: ['string', 'null'] },
          commitmentDueDateGuess: { type: ['string', 'null'] },
          commitmentRecipientNameGuess: { type: ['string', 'null'] },
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
    mission: { type: 'null' },
    vision: { type: 'null' },
    strategy: { type: 'null' },
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
    dataQuality: {
      type: 'object',
      additionalProperties: false,
      required: ['speakerCoveragePercent', 'transcriptTruncated', 'lowConfidenceBlockCount'],
      properties: {
        speakerCoveragePercent: { type: ['number', 'null'], minimum: 0, maximum: 100 },
        transcriptTruncated: { type: 'boolean' },
        lowConfidenceBlockCount: { type: 'integer', minimum: 0 },
      },
    },
  },
};

const SYSTEM_PROMPT = withAsrNote(
  withConfidenceCalibration(
    withDecisionDiscriminator(`# Кто ты
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
6. Выполнение (task_completed / done_item) ≠ обязательство ≠ план. Если человек сообщает, что конкретное дело УЖЕ сделано/закрыто/отправлено/готово (прошедшее время + результат: «отправил Насте письмо», «задачу по отчёту закрыл», «готово, выложил», «сделал»), — это сигнал ВЫПОЛНЕНИЯ: signalType=task_completed (для названной задачи) или done_item (для пункта/подзадачи). Это НЕ commitment (обещание на будущее) и НЕ plan_item (намерение). Сравни: «отправлю Насте» (будущее) = commitment; «отправил Насте» (прошедшее, результат) = task_completed/done_item.
7. Задача к исполнению (action_item) — конкретное «надо сделать X» / поручение / задача, сформулированная как действие («подготовить смету», «обновить договор», «настроить мониторинг»), без явного личного «я беру на себя» и без срока-обязательства. Это НЕ вопрос и НЕ «давайте обсудим/надо бы» (расплывчатое пожелание). Отличия: commitment = конкретный человек лично обещает сделать (со сроком → идёт в цели); plan_item = групповой план группы (идёт в цели); suggestion = предложение, ещё не принятое; task_created = ЭХО-событие трекера про уже существующую Issue (это не извлечение задачи). Если действие лежит на ком-то лично с обещанием — commitment, не action_item.

# Достоверность и сроки (анти-выдумка)
- Бери только то, что прозвучало. Не додумывай мотивы, цифры, имена, сроки.
- Имена людей (адресат обещания, кто принял решение, упомянутые лица) бери ТОЛЬКО из реплик и из имён спикеров. Если имя не звучало явно — оставляй пусто (null), не подставляй вероятное.
- Если спикеры — только технические метки (вид «Speaker_0», «unknown»), авторство реплики НЕИЗВЕСТНО: не приписывай реплику человеку и не указывай адресата обещания.
- Срок обязательства указывай только если он назван («к пятнице», «до конца месяца», «к 25-му») — переведи в дату формата ГГГГ-ММ-ДД относительно даты разговора. «Скоро», «на днях», «как-нибудь» — это не срок, оставляй пусто.
- Многосторонний факт (обещание/решение/договорённость, где участвуют >1 человека) сохраняй ПОЛНОСТЬЮ: и кто дал слово (автор — спикер реплики), и кому адресовано (commitmentRecipientNameGuess), и срок (commitmentDueDateGuess). НЕ схлопывай факт до одного исполнителя, теряя автора или срок. Если в реплике «А поручил Б сделать X к сроку C» — адресат Б и срок C обязательны к заполнению.

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

ПРИМЕР 7 (выполнение — НЕ обязательство и НЕ факт). Реплика: «Я выполнил задачу: написал Насте по поставке и отправил.»
ПЛОХО: signalType=commitment ИЛИ signalType=fact «Письмо Насте».
ХОРОШО: signalType=task_completed (или done_item); name «Выполнено: письмо Насте по поставке»; trustedAnswer «Сообщил, что написал Насте по поставке и отправил». Прошедшее время и результат — это сигнал закрытия: по нему система предложит закрыть связанную задачу. Будущее «напишу Насте» было бы commitment, а не выполнение.

# Граница «идея ↔ решение» (частая ошибка — соблюдай строго)
Идею от решения отличает РОВНО ОДИН признак: состоялась ли ФИКСАЦИЯ выбора в этом окне.
- Предложение/намерение без фиксации («давайте», «предлагаю», «может быть», «стоит ли», «хорошо бы», «а что если») → signalType=idea (или suggestion). Это ещё НЕ решение.
- ФИКСИРОВАННЫЙ выбор («решили», «договорились», «окей, делаем», «берём», «принято», «утверждаем», а также отказ «решили НЕ делать») → signalType=decision.
- Гипотетика («если бы…», «можно было бы…») и отложенное («подумаем», «вернёмся позже», «пока не решаем») → idea/suggestion, НЕ decision. Не выделяй отдельный блок «решение отложить» — отсрочка не является выбором по существу.
- АНТИ-ДУБЛЬ: если в окне предложение И ЕГО ПРИНЯТИЕ про ОДНО И ТО ЖЕ («а давайте X… — окей, решили, делаем X») — создай РОВНО ОДИН блок signalType=decision. НЕ создавай вдобавок отдельный блок idea про то же самое.
- АНТИ-ПОТЕРЯ: запрет дубля ≠ право терять блок. Спорное/мягкое (мнение руководителя без фиксации, гипотетика, отложенное, запрос клиента) всё равно извлекай как idea/suggestion — просто не как decision.
- Запрос/просьба клиента сделать функцию → idea/feature_request (это спрос, не наш выбор), даже если звучит уверенно.
- Личное обязательство («я к пятнице сделаю») → commitment, не decision и не idea.

# Перед тем как вернуть ответ — самопроверка
Пройди по списку; если хоть один пункт нарушен — исправь, не выдавай как есть:
1. Каждый блок — отдельное значимое утверждение, переживёт неделю; small talk и повторы убраны.
2. У каждого блока ровно один тип, и он не путает обязательство/решение/идею/вопрос (см. различия выше).
3. Намерения и пожелания без взявшего на себя НЕ помечены как обязательство.
4. Ни одного выдуманного имени, срока или цифры; при технических метках спикеров — никаких приписанных людей.
5. В человеческих строках (имя, вопрос, ответ, контекст) нет ни одного кода, латинского слова, идентификатора или служебного названия.
6. К каждому блоку есть короткая дословная цитата и корректные таймкоды (начало ≤ конец).
7. Уверенность не завышена; при сомнении она снижена.
8. Для каждого предложения, ПРИНЯТОГО в окне, ровно один блок signalType=decision и НЕТ дублирующего idea про то же; отложенное/гипотетика/мнение без фиксации — idea/suggestion, не decision.
9. Сообщения о УЖЕ сделанном (прошедшее время + результат: «сделал», «закрыл», «отправил», «готово», «выполнил») помечены как выполнение (task_completed/done_item), а не как обязательство или просто факт.
10. Многосторонние обязательства/договорённости не схлопнуты: адресат и срок заполнены, автор (спикер) не потерян.

Верни строго JSON по схеме block_ingest_v2. Никакого markdown, преамбул и пояснений вне JSON.
`),
  ),
);

interface BuildArgs {
  meetingTitle?: string | undefined;
  meetingDateIso?: string | undefined;
  meetingType?: string | undefined;
  participants?: string[] | undefined;
  segments: Segment[];
}

function formatDateRu(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getUTCFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

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

  const contextLines: string[] = [];
  if (args.meetingTitle) contextLines.push(`- Заголовок: ${args.meetingTitle}`);
  if (args.meetingType) contextLines.push(`- Тип: ${args.meetingType}`);
  const dateRu = args.meetingDateIso ? formatDateRu(args.meetingDateIso) : null;
  if (dateRu) contextLines.push(`- Дата разговора: ${dateRu}`);
  if (args.participants && args.participants.length > 0) {
    contextLines.push(`- Участники: ${args.participants.join(', ')}`);
  }
  const header =
    contextLines.length > 0 ? `Контекст эпизода:\n${contextLines.join('\n')}\n\n` : '';

  const user = `${header}Сегменты (порядок сохраняй для таймкодов):\n${JSON.stringify(segmentsJson, null, 2)}\n\nВерни JSON по схеме.`;
  return { system: SYSTEM_PROMPT, user };
}
