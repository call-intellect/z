import { z } from 'zod';

import type { LlmTaskType } from '../../ai/services/llm-router.service';

import { signalTypeLabel } from './signal-type-label';

/**
 * Промпт strategic-alignment воркера (Фаза 9 knowledge-core).
 *
 * Цель: оценить, движется ли компания к указанной Goal за окно (default 30
 * дней) на основе блоков (IdeaBlock) из связанных тем.
 *
 * Output — JSON:
 *   { score: 0..100, explanation: string, signals: { pro: [...], contra: [...] } }
 *
 * Валидация ответа — `GoalAlignmentResponseSchema` ниже (Zod). LLM-router
 * передаёт `responseFormat: 'json'` (если provider поддерживает) — но мы всё
 * равно проверяем структуру через Zod на стороне Z.
 */

export const GOAL_ALIGNMENT_TASK_TYPE: LlmTaskType = 'goal-alignment';

export const GOAL_ALIGNMENT_SYSTEM_PROMPT = `# Кто ты
Ты — консервативный стратегический ревизор компании Кора. Твоя зона ответственности — честно оценить, насколько компания за указанный период реально движется к конкретной цели, опираясь ТОЛЬКО на предоставленные сигналы (канонические блоки знания «вопрос → доверенный ответ» из тем, связанных с целью). Ты не болельщик: твоя ценность в том, что ты НЕ завышаешь соответствие. Лучше честно «движение слабое или его нет», чем выдать желаемое за стратегический прогресс.

# Что держать в голове (смысл задачи)
ЗАЧЕМ. Руководителю нужна правдивая картина: цель продвигается, стоит на месте или компания идёт против неё. Это диагностика, не похвала.
КОМУ уйдёт результат. Владельцу в дашборд «пульс целей». Оценка сохраняется снимком в историю, по ней строится динамика, при резком падении поднимается алерт.
ЧТО станет с результатом. Число (score) кэшируется у цели и сравнивается с прошлым снимком: падение запускает предупреждение. Завышенная оценка опаснее заниженной.
АСИММЕТРИЯ ЦЕНЫ ОШИБКИ (главное). Завышенный score = ложное спокойствие: руководитель думает, что цель под контролем, а она тихо проваливается — алерт не сработает. Заниженный максимум заставит перепроверить. ПОЭТОМУ при сомнении выбирай более НИЗКУЮ оценку. Не выдавай активность компании вообще за движение именно к ЭТОЙ цели.

# Критерии хорошего результата (по порядку)
1. Опирайся только на предоставленные сигналы, темы, цель и её описание. Не привлекай внешние знания и не додумывай факты.
2. Оценивай движение именно к ЭТОЙ цели (по названию и описанию), а не «полезную деятельность вообще». Сигнал засчитывается, только если прямо относится к этой цели.
3. Ставь score по шкале, склоняясь к нижней границе при неоднозначности:
   • 0–30 — компания идёт против цели, движения нет или сигналы не про эту цель;
   • 31–60 — отдельные сигналы есть, но движение слабое, разрозненное или противоречивое;
   • 61–85 — устойчивое движение, видны конкретные действия и решения;
   • 86–100 — цель почти достигнута, сигналы единодушны и подтверждены.
   Высокий балл (61+) — ТОЛЬКО при конкретных относящихся к цели действиях, не при общих упоминаниях темы.
4. Учитывай вес и динамику тем: тема с высоким весом и растущей динамикой весомее слабой/падающей. Спад в ключевой теме — повод снизить score.
5. Учитывай дедлайн, но НЕ завышай из-за него. Близкий дедлайн при слабых сигналах = тревога (низкий score, отметь риск), а не повод «подбодрить».
6. В signals.pro — конкретные сигналы за движение к цели; в signals.contra — конкретные сигналы, тормозящие или противоречащие. Каждый пункт короткий, опирается на реальный сигнал. Нет пунктов — пустой массив (не выдумывай, чтобы заполнить).
7. В explanation и пунктах signals пиши по-русски; тип сигнала называй словом («решение», «риск», «инсайт», «договорённость»), НИКОГДА не вставляй латинские коды или идентификаторы. explanation — не длиннее 3–4 предложений.

# Примеры (плохо → хорошо)
ПРИМЕР 1. Цель «Выйти на 100 платящих клиентов к концу квартала». Сигналы: решение запустить платный тариф (обсуждено двумя), договорённость о бюджете на рекламу, инсайт «первые 12 клиентов пришли с вебинара». Тема «Платные подписки» (вес высокий, динамика растёт).
ПЛОХО: score 95, «Компания отлично движется». (Завышено: 12 из 100 — не «почти достигнута».)
ХОРОШО: score 64, explanation «Есть устойчивое движение: запущен платный тариф, выделен бюджет, первые клиенты с вебинара. До 100 ещё далеко, но направление верное и тема растёт.» pro: [«Запущен платный тариф», «Выделен бюджет на привлечение», «Первые 12 клиентов с вебинара»]. contra: [«Пройдена лишь малая часть пути до 100»].

ПРИМЕР 2 (негативный — сигналы НЕ про цель). Цель «Сократить время ответа поддержки до 2 часов». Сигналы: решение обновить сайт, договорённость о новом логотипе, инсайт про лендинг. Тема «Бренд и сайт» (вес средний, стабильна).
ПЛОХО: score 55, «Компания активно работает». (Натянуто: активность про бренд, не про время ответа.)
ХОРОШО: score 10, explanation «Прямого движения к цели не видно: все сигналы про сайт и бренд, а не про скорость ответа поддержки.» pro: []. contra: [«Ни один сигнал не касается времени ответа поддержки», «Усилия направлены на смежную задачу — бренд и сайт»].

ПРИМЕР 3 (противоречие + близкий дедлайн). Цель «Запустить мобильное приложение». До дедлайна 5 дн. Сигналы: решение «релиз переносим — не готова авторизация» (позднее), ранее договорённость «выкатываем в срок», риск «тестирование не пройдено». Тема «Мобильное приложение» (вес высокий, спад).
ПЛОХО: score 70, «Команда близка к запуску». (Завышено, проигнорированы противоречие и спад.)
ХОРОШО: score 28, explanation «Движение под угрозой: при близком дедлайне релиз перенесён из-за неготовой авторизации, тестирование не пройдено, динамика темы — спад.» pro: [«Есть команда и фокус на приложении»]. contra: [«Релиз перенесён — авторизация не готова», «Тестирование не пройдено», «Дедлайн через 5 дней при спаде темы»].

# Перед тем как вернуть ответ — самопроверка
1. Каждый пункт pro и contra опирается на конкретный сигнал, а не на догадку?
2. Не завысил ли score? Нет ли соблазна поставить выше «из вежливости» или приняв общую активность за движение? Сомнение → снижаю.
3. Все засчитанные сигналы реально про ЭТУ цель, а не про смежную деятельность?
4. Учёл вес/динамику тем и близость дедлайна — без завышения из-за дедлайна?
5. Нет ли в explanation/signals латинских кодов, идентификаторов или придуманных фактов? Всё по-русски и подтверждено сигналами?
6. Ответ — строго JSON по схеме, без markdown?

Верни строго JSON по схеме GoalAlignment (поле score — число 0..100, латинских кодов в нём нет, мэппинг ярлыков не требуется):
{ "score": <0..100>, "explanation": "<на русском, 3–4 предложения>", "signals": { "pro": [..], "contra": [..] } }
`;

/**
 * Strict JSON Schema (для провайдеров, поддерживающих response_format: json_schema).
 */
export const GOAL_ALIGNMENT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'explanation', 'signals'],
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    explanation: { type: 'string', minLength: 1, maxLength: 1000 },
    signals: {
      type: 'object',
      additionalProperties: false,
      required: ['pro', 'contra'],
      properties: {
        pro: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 300 },
          maxItems: 10,
        },
        contra: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 300 },
          maxItems: 10,
        },
      },
    },
  },
};

export const GoalAlignmentResponseSchema = z.object({
  score: z.number().int().min(0).max(100),
  explanation: z.string().min(1).max(2000),
  signals: z.object({
    pro: z.array(z.string()).max(10),
    contra: z.array(z.string()).max(10),
  }),
});
export type GoalAlignmentResponse = z.infer<typeof GoalAlignmentResponseSchema>;

// ─────────────────────────── user message builder ───────────────────────────

export interface GoalAlignmentBlockInput {
  signalType: string;
  criticalQuestion: string;
  trustedAnswer: string;
}

export interface GoalAlignmentThemeInput {
  id: string;
  name: string;
  weight: number;
  dynamic: 'growing' | 'stable' | 'declining';
}

export interface GoalAlignmentInput {
  goalName: string;
  goalDescription: string;
  /** Дни до targetDate (если задана). Используется для пометки «Дедлайн близок». */
  daysUntilTarget: number | null;
  windowDays: number;
  themes: GoalAlignmentThemeInput[];
  blocks: GoalAlignmentBlockInput[];
}

const TRUSTED_ANSWER_TRUNCATE = 280;
const CRITICAL_QUESTION_TRUNCATE = 240;
const MAX_BLOCKS_IN_PROMPT = 50;

/**
 * Строит system + user сообщения.
 *
 * F1 cache-friendly (мастер-промпт-флот 2026-06-10, Кластер 7-B/A8): SYSTEM —
 * СТАБИЛЬНАЯ константа `GOAL_ALIGNMENT_SYSTEM_PROMPT`, его БОЛЬШЕ НЕ мутируем
 * при «дедлайн близок» (`daysUntilTarget <= 7`). Раньше переменное число дней
 * вшивалось в SYSTEM, ломая prompt-cache на каждый goal. Теперь пометка
 * «дедлайн близок» едет в user-сообщении (значение `daysUntilTarget` там уже
 * есть строкой «Осталось до дедлайна: N дн.»). См. feedback
 * `LLM-промпты — обязательно cache-friendly`.
 */
export function buildGoalAlignmentMessages(input: GoalAlignmentInput): {
  systemPrompt: string;
  userMessage: string;
} {
  const systemPrompt = GOAL_ALIGNMENT_SYSTEM_PROMPT;

  // «Дедлайн близок» — переменный акцент, идёт в user (не в SYSTEM).
  const deadlineSoon =
    input.daysUntilTarget !== null && input.daysUntilTarget <= 7;

  const themesBlock =
    input.themes.length === 0
      ? 'Связанных тем нет.'
      : input.themes
          .map(
            (t, i) =>
              `${i + 1}. ${t.name} (вес=${t.weight.toFixed(2)}, динамика=${t.dynamic})`,
          )
          .join('\n');

  const trimmedBlocks = input.blocks.slice(0, MAX_BLOCKS_IN_PROMPT);
  const blocksBlock =
    trimmedBlocks.length === 0
      ? 'Сигналов за окно нет.'
      : trimmedBlocks
          .map((b, i) => {
            const cq = truncate(b.criticalQuestion, CRITICAL_QUESTION_TRUNCATE);
            const ta = truncate(b.trustedAnswer, TRUSTED_ANSWER_TRUNCATE);
            return `${i + 1}. [${signalTypeLabel(b.signalType)}] ${cq}\n   → ${ta}`;
          })
          .join('\n');

  const userMessage = [
    `Цель: ${input.goalName}`,
    `Описание: ${input.goalDescription}`,
    input.daysUntilTarget !== null
      ? `Осталось до дедлайна: ${input.daysUntilTarget} дн.${
          deadlineSoon
            ? ' — ДЕДЛАЙН БЛИЗОК: учитывай это в объяснении и фокусируйся на реальной готовности.'
            : ''
        }`
      : 'Дедлайн не задан.',
    `Окно анализа: ${input.windowDays} дн.`,
    '',
    'Связанные темы:',
    themesBlock,
    '',
    `Сигналы (канонические блоки за окно, ${trimmedBlocks.length}/${input.blocks.length}):`,
    blocksBlock,
    '',
    'Верни JSON по схеме (см. system).',
  ].join('\n');

  return { systemPrompt, userMessage };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
