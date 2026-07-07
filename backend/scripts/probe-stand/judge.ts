import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { directLlmCall } from '../_lib/llm-direct';

export interface JudgeInput {
  reason: string;
  service: string;
  message: string;
  recipient: string;
  asks: string;
  trigger: string;
  volumePerWeek: number;
}

export interface JudgeVerdict {
  verdict: 'keep' | 'rework' | 'automate' | 'drop';
  humanOnly: boolean;
  machinePath: string;
  violatedPrinciples: string[];
  recipientRight: boolean;
  rationale: string;
  suggestedFix: string;
}

export interface GapCandidate {
  moment: string;
  question: string;
  whyHuman: string;
  recipient: string;
}

export const JUDGE_MODEL = 'deepseek-v4-pro';

const FIELD_RULES_PATH = resolve(process.cwd(), '../docs/testing/probe-field-rules.md');

const FIELD_RULES_FALLBACK = [
  'P1 только человек знает ответ; P2 сначала автоматика, вопрос — фолбэк; P3 несоответствия/противоречия важны;',
  'P4 не спрашивать про неподтверждённое авто-извлечение; P5 адресат — тот, кто знает ответ;',
  'P6 один смысл — один вопрос (без дублей и дроби); P7 понятное действие сразу; P8 метрики/напоминания — не вопросы.',
  'Бюджет: не больше 5 вопросов на человека в сутки. Минимум вопросов, максимум автоматики.',
].join('\n');

export function loadFieldRules(): string {
  try {
    return readFileSync(FIELD_RULES_PATH, 'utf8');
  } catch {
    return FIELD_RULES_FALLBACK;
  }
}

function judgeSystem(): string {
  return [
    'Ты — продуктовый судья платформы «Кора» (AI операционный директор для SMB).',
    'Кора задаёт сотрудникам и владельцу уточняющие вопросы (probe). Ниже — «поле правильности»: смысловые принципы владельца, что можно спрашивать у человека, а что Кора обязана закрывать сама.',
    '',
    '=== ПОЛЕ ПРАВИЛЬНОСТИ (рубрика) ===',
    loadFieldRules(),
    '=== КОНЕЦ ПОЛЯ ===',
    '',
    'Суди КОНКРЕТНЫЙ тип вопроса по смыслу против принципов P1–P8. Вердикты:',
    'keep — вопрос уместен (только человек знает ответ, автоматика испробована, адресат верный).',
    'rework — смысл нужен, исполнение нарушает P5–P7 (адресат/дробь/повторы/непонятное действие).',
    'automate — нарушает P1/P2/P4: ответ выводим из данных или спрашивает про неподтверждённое авто-извлечение; заменить авто-заполнением/индикатором.',
    'drop — не нужен ни как вопрос, ни как автоматика (метрика в отчёт, дубль, мёртвая сущность).',
    '',
    'Поля ответа: humanOnly — может ли ответить ТОЛЬКО человек; machinePath — как машина закрыла бы дыру без вопроса (пустая строка, если никак); violatedPrinciples — коды нарушенных принципов (например ["P2","P4"], пустой массив если ок); recipientRight — верен ли адресат по P5.',
    'rationale и suggestedFix — по-русски, максимум 2 предложения каждый.',
    'Отвечай ТОЛЬКО вызовом инструмента judge_probe. Если инструмент недоступен — верни ЧИСТЫЙ JSON-объект по той же схеме, без пояснений и без markdown.',
  ].join('\n');
}

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['keep', 'rework', 'automate', 'drop'] },
    humanOnly: { type: 'boolean' },
    machinePath: { type: 'string' },
    violatedPrinciples: { type: 'array', items: { type: 'string' } },
    recipientRight: { type: 'boolean' },
    rationale: { type: 'string' },
    suggestedFix: { type: 'string' },
  },
  required: [
    'verdict',
    'humanOnly',
    'machinePath',
    'violatedPrinciples',
    'recipientRight',
    'rationale',
    'suggestedFix',
  ],
} as const;

const GAPS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    gaps: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          moment: { type: 'string' },
          question: { type: 'string' },
          whyHuman: { type: 'string' },
          recipient: { type: 'string' },
        },
        required: ['moment', 'question', 'whyHuman', 'recipient'],
      },
    },
  },
  required: ['gaps'],
} as const;

function extractJson(raw: string): string {
  const cleaned = raw.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return cleaned;
  return cleaned.slice(start, end + 1);
}

async function llmJson<T>(args: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  toolName: string;
  validate: (parsed: T) => boolean;
}): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await directLlmCall({
        provider: 'deepseek',
        model: JUDGE_MODEL,
        system: args.system,
        user: args.user,
        schema: args.schema,
        schemaName: args.toolName,
        toolName: args.toolName,
        maxTokens: 2500,
      });
      if (res.error) throw new Error(`judge LLM error: ${res.error}`);
      const raw = res.toolCallArgs ?? res.text;
      if (!raw) throw new Error('judge: пустой ответ LLM');
      const parsed = JSON.parse(extractJson(raw)) as T;
      if (!args.validate(parsed)) throw new Error('judge: ответ не соответствует схеме');
      return parsed;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function judgeProbe(input: JudgeInput): Promise<JudgeVerdict> {
  const user = [
    `reason: ${input.reason}`,
    `агент (emittedByService): ${input.service}`,
    `триггер и происхождение данных: ${input.trigger}`,
    `что спрашивает (шаблон): ${input.asks}`,
    `пример текста вопроса: ${input.message}`,
    `адресат: ${input.recipient}`,
    `объём за окно наблюдения в одном орге: ${input.volumePerWeek}`,
  ].join('\n');
  return llmJson<JudgeVerdict>({
    system: judgeSystem(),
    user,
    schema: JUDGE_SCHEMA as unknown as Record<string, unknown>,
    toolName: 'judge_probe',
    validate: (p) => Boolean(p.verdict) && typeof p.rationale === 'string',
  });
}

export async function judgeGaps(inventory: string): Promise<GapCandidate[]> {
  const system = [
    'Ты — продуктовый судья платформы «Кора» (AI операционный директор для SMB).',
    'Ниже — «поле правильности» уточняющих вопросов (принципы владельца) и полный инвентарь вопросов, которые Кора УЖЕ умеет задавать.',
    '',
    '=== ПОЛЕ ПРАВИЛЬНОСТИ ===',
    loadFieldRules(),
    '=== КОНЕЦ ПОЛЯ ===',
    '',
    'Задача — ОБРАТНАЯ проверка: найди до 5 моментов жизни SMB-компании (встречи, чаты, задачи, решения, клиенты, найм/уход людей, деньги), где по P1/P3 вопрос человеку был бы ценен, а в инвентаре его НЕТ.',
    'Каждый кандидат: moment — когда/что произошло; question — формулировка вопроса по-русски; whyHuman — почему ответ знает только человек (P1/P3), а не выводится из данных; recipient — кому.',
    'Не предлагай то, что нарушает P2/P4/P8 (выводимое из данных, про неподтверждённое, метрики). Не дублируй инвентарь по смыслу. Если честных кандидатов меньше 5 — верни меньше.',
    'Отвечай ТОЛЬКО вызовом инструмента propose_gaps. Если инструмент недоступен — верни ЧИСТЫЙ JSON-объект по схеме, без пояснений.',
  ].join('\n');
  const res = await llmJson<{ gaps: GapCandidate[] }>({
    system,
    user: inventory,
    schema: GAPS_SCHEMA as unknown as Record<string, unknown>,
    toolName: 'propose_gaps',
    validate: (p) => Array.isArray(p.gaps),
  });
  return res.gaps;
}
