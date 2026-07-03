import { directLlmCall } from '../_lib/llm-direct';

export interface JudgeInput {
  reason: string;
  service: string;
  message: string;
  recipient: string;
  asks: string;
  volumePerWeek: number;
}

export interface JudgeVerdict {
  verdict: 'useful' | 'noise' | 'borderline';
  relevance: number;
  actionClear: boolean;
  recipientRight: boolean;
  notDuplicate: boolean;
  notOnUnconfirmed: boolean;
  rationale: string;
  suggestedFix: string;
}

export const JUDGE_MODEL = 'deepseek-v4-pro';

const JUDGE_SYSTEM = [
  'Ты — продуктовый аналитик платформы «Кора» (AI операционный директор для SMB).',
  'Кора автоматически задаёт сотрудникам и владельцу уточняющие вопросы (probe), чтобы дополнить память компании.',
  'Твоя задача — судить КОНКРЕТНЫЙ тип вопроса: полезен он бизнесу или это шум, который раздражает и обесценивает продукт.',
  '',
  'Рубрика (оцени каждый критерий):',
  '1. relevance (0..1): реально ли вопрос помогает бизнесу/памяти, а не «для галочки».',
  '2. actionClear: понятно ли адресату, ЧТО именно от него хотят и зачем.',
  '3. recipientRight: тот ли адресат (того, кто может ответить; сотрудника не грузим вопросами владельца и наоборот).',
  '4. notDuplicate: не дублирует ли другой агент тот же вопрос.',
  '5. notOnUnconfirmed: вопрос не задаётся на сыром авто-извлечении, которое человек не подтверждал (иначе спрашиваем про то, чего может не быть).',
  '',
  'Отдельно штрафуй за ЧАСТОТУ: если volumePerWeek большой (десятки), а вопрос гранулярный (по одному на каждый шаг/сущность) — это шум, даже если по сути правильный: такие надо агрегировать в один вопрос.',
  '',
  'Вердикт: useful (оставить как есть), borderline (полезно, но переделать: агрегировать/сменить адресата/снизить частоту), noise (выключить или радикально урезать).',
  'suggestedFix — одна конкретная рекомендация (по-русски).',
  'Отвечай ТОЛЬКО вызовом инструмента judge_probe.',
].join('\n');

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['useful', 'noise', 'borderline'] },
    relevance: { type: 'number', minimum: 0, maximum: 1 },
    actionClear: { type: 'boolean' },
    recipientRight: { type: 'boolean' },
    notDuplicate: { type: 'boolean' },
    notOnUnconfirmed: { type: 'boolean' },
    rationale: { type: 'string' },
    suggestedFix: { type: 'string' },
  },
  required: [
    'verdict',
    'relevance',
    'actionClear',
    'recipientRight',
    'notDuplicate',
    'notOnUnconfirmed',
    'rationale',
    'suggestedFix',
  ],
} as const;

export async function judgeProbe(input: JudgeInput): Promise<JudgeVerdict> {
  const user = [
    `reason: ${input.reason}`,
    `агент (emittedByService): ${input.service}`,
    `что спрашивает (шаблон): ${input.asks}`,
    `пример текста вопроса: ${input.message}`,
    `адресат: ${input.recipient}`,
    `объём за неделю в одном орге: ${input.volumePerWeek}`,
  ].join('\n');

  const res = await directLlmCall({
    provider: 'deepseek',
    model: JUDGE_MODEL,
    system: JUDGE_SYSTEM,
    user,
    schema: JUDGE_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'judge_probe',
    toolName: 'judge_probe',
    maxTokens: 700,
  });

  if (res.error) throw new Error(`judge LLM error: ${res.error}`);
  const raw = res.toolCallArgs ?? res.text;
  if (!raw) throw new Error('judge: пустой ответ LLM');
  const parsed = JSON.parse(raw) as JudgeVerdict;
  return parsed;
}
