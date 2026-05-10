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
] as const;

export const ENTITY_TYPE_VALUES = [
  'client',
  'person',
  'project',
  'product',
  'topic',
  'location',
  'custom',
] as const;

/**
 * Strict JSON Schema для ответа block-ingest LLM-вызова. Совместима с
 * `responseFormat: 'json_schema' strict`.
 */
export const BLOCK_INGEST_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['blocks'],
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
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `Ты — извлекатель структурированного знания из расшифровки встречи.
Получаешь список сегментов диалога и возвращаешь массив IdeaBlock'ов.

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
  - idea: гипотеза, предложение, набросок.
  - risk: риск (не churn) — операционный, финансовый, технический.
  - commitment: явное обязательство кого-то сделать что-то.
  - decision: принятое решение (групповое или индивидуальное).
  - mood: эмоциональный фон, настроение, тонус разговора.
  - drift: уход от темы, отвлечение, потеря фокуса.
  - competitor_move: упоминание действий конкурента.
  - metric_change: озвученное изменение метрики.
  - knowledge_gap: пробел в знаниях, неопределённость, вопрос без ответа.
- tags: 1-5 тегов в lowercase через дефис («churn-prevention», «pricing», «integration-q3»).
- confidence: 0..1 — уверенность, что блок верно извлечён и не искажает смысл.
- evidenceQuote: дословная цитата (или близкая к ней склейка) из расшифровки, обосновывающая блок. Должна реально присутствовать в сегментах.
- evidenceStartMs / evidenceEndMs: таймкоды цитаты в миллисекундах. Бери из границ сегмента, в котором лежит цитата (или min/max если цитата охватывает несколько сегментов).
- mentionedEntities: упомянутые сущности — клиенты, люди, проекты, продукты, темы, локации. Поле type — одно из enum (client/person/project/product/topic/location/custom). Поле mentionContext — короткое описание роли упоминания в контексте именно этого блока. Поле metadata — опциональный объект с произвольными ключами (email, должность, домен и т.п.). Если сущностей нет — передай пустой массив.

Правила:
- Ответ — строго JSON, валидный по схеме. Никакого markdown, преамбул, объяснений.
- Не выдумывай данные, которых нет в сегментах.
- Если один и тот же смысл повторяется в нескольких сегментах — собери в один блок (несколько evidence на стороне сервера будут соединены позже).
- evidenceStartMs ≤ evidenceEndMs.
`;

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
    ? `Заголовок встречи: ${args.meetingTitle}\n\n`
    : '';
  const user = `${header}Сегменты диалога (порядок сохраняй для таймкодов):\n${JSON.stringify(segmentsJson, null, 2)}\n\nВерни JSON по схеме.`;
  return { system: SYSTEM_PROMPT, user };
}
