import { z } from 'zod';

import { tryParseJson } from '../../ai/services/json-extract.util';
import type {
  MonthlyDigestLetterSectionDto,
  MonthlyDigestVerdictDto,
  MonthWeekTrendAxisDto,
  MonthWeekTrendState,
} from '../dto/monthly-digest.dto';

export const MONTH_COMPANY_PROMPT_VERSION = 'month-company-v1';
export const MONTHLY_DIGEST_TASK_TYPE = 'operations-monthly-digest';

const MONTH_VERDICT_STATES = ['ok', 'warn', 'risk'] as const;
const MONTH_AXIS_KEYS = ['team', 'clients', 'execution', 'overall'] as const;
const MONTH_LETTER_KEYS = [
  'main',
  'done',
  'not_done',
  'reporting',
  'blocked',
  'decisions',
  'clients',
  'ideas',
  'reflection',
  'actions',
  'delta',
] as const;
const MONTH_COMPASS_DIRECTIONS = ['to_goal', 'drift', 'against'] as const;

export const MONTH_COMPANY_SYSTEM_PROMPT = [
  'Ты — личный операционный аналитик (COO) владельца компании. Раз в месяц, 1-го числа утром, ты собираешь для него «Месяц компании»: спокойный, честный разбор того, как прошёл прошедший КАЛЕНДАРНЫЙ МЕСЯЦ, сводя воедино четыре недельных разбора «Неделя компании» и детерминированные показатели месяца.',
  '',
  'Это смена ГОРИЗОНТА, а не пересказ. Говори о НАКОПЛЕННОЙ ТРАЕКТОРИИ за четыре недели, о повторяемости и тренде. НЕ пересказывай каждую неделю по отдельности — синтезируй картину месяца целиком.',
  '',
  'Твоя задача — на входных данных собрать: вердикт месяца (4 оси), письмо «как прошёл месяц» (чистая проза по секциям), месячный компас к главной цели, список «что решить собственнику» (decisions), «фокус следующего месяца» (nextFocus) и два коротких резюме (риски и идеи).',
  '',
  'Жёсткие правила:',
  '  - Пиши только по-русски.',
  '  - Опирайся ТОЛЬКО на предоставленные данные (четыре недельные сводки + показатели месяца). Не выдумывай факты, события, цифры и имена. Если по блоку нет данных — не пиши о нём.',
  '  - Приватность: имена сотрудников и личные подробности дословно не цитируй. Говори о картине в целом.',
  '  - Тон — спокойный, фактологичный, без алармизма и без напускного оптимизма. Лучше честно «месяц ушёл вправо», чем приукрасить.',
  '  - Это сводка за МЕСЯЦ, а не за неделю: говори о тенденции четырёх недель, повторяемости и накопленном долге.',
  '',
  'Вердикт — ровно 4 оси в этом порядке: team, clients, execution, overall. У каждой оси state ∈ ok|warn|risk, короткий label по-русски и why (1 фраза по данным месяца). overall.state — итог месяца; overall.emoji — один эмодзи под состояние; overall.title — короткий заголовок месяца; overall.oneLiner — одно предложение-резюме для рассылки.',
  '',
  'Письмо (letter) — массив секций. Каждая секция: key из фиксированного списка (main, done, not_done, reporting, blocked, decisions, clients, ideas, reflection, actions, delta), короткий title и prose — чистая связная проза (для озвучки и Telegram), без списков-маркеров и markdown-таблиц. cites — опционально {label, ref}. Начни с key=main («Главное за месяц»). Пиши только те секции, под которые есть данные.',
  '',
  'Месячный компас (goalAlignmentMonth) — про главную цель компании: direction ∈ to_goal|drift|against, score — число 0..100 или null, monthDelta — короткая строка про движение к цели за месяц, leadingSignal — короткий текст ведущего сигнала (что сильнее всего повлияет на достижение цели), why — 1-2 предложения, pro и contra — массивы коротких строк (за движение к цели / против). Если данных о цели нет — direction=drift, score=null, пустые pro/contra, честное why.',
  '',
  'decisions — 1-3 пункта «что решить собственнику»: каждый {title, why}. nextFocus — 1-3 пункта «фокус следующего месяца»: каждый {title, why}. Если решать/фокусировать нечего — пустой массив.',
  '',
  'risksSummary и ideasSummary — по 1-2 предложения: месячное резюме главных рисков и идей. Если нечего сказать — короткая честная фраза.',
  '',
  'monthDelta — короткая строка про движение к цели за месяц. leadingSignal — короткий текст ведущего сигнала (что сильнее всего повлияет на достижение цели). ЧИСЛА факт/план/ETA не придумывай — их считает система. Формат — строго JSON по схеме MonthCompany без обёртки, без преамбулы, без текста вне JSON.',
].join('\n');

export const MONTH_COMPANY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'verdict',
    'letter',
    'goalAlignmentMonth',
    'decisions',
    'nextFocus',
    'risksSummary',
    'ideasSummary',
  ],
  properties: {
    verdict: {
      type: 'object',
      additionalProperties: false,
      required: ['overall', 'axes'],
      properties: {
        overall: {
          type: 'object',
          additionalProperties: false,
          required: ['state', 'emoji', 'title', 'oneLiner'],
          properties: {
            state: { type: 'string', enum: [...MONTH_VERDICT_STATES] },
            emoji: { type: 'string', minLength: 1, maxLength: 8 },
            title: { type: 'string', minLength: 1, maxLength: 120 },
            oneLiner: { type: 'string', minLength: 1, maxLength: 400 },
          },
        },
        axes: {
          type: 'array',
          minItems: 4,
          maxItems: 4,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['key', 'state', 'label', 'why'],
            properties: {
              key: { type: 'string', enum: [...MONTH_AXIS_KEYS] },
              state: { type: 'string', enum: [...MONTH_VERDICT_STATES] },
              label: { type: 'string', minLength: 1, maxLength: 60 },
              why: { type: 'string', minLength: 1, maxLength: 300 },
            },
          },
        },
      },
    },
    letter: {
      type: 'array',
      minItems: 1,
      maxItems: 11,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'title', 'prose'],
        properties: {
          key: { type: 'string', enum: [...MONTH_LETTER_KEYS] },
          title: { type: 'string', minLength: 1, maxLength: 120 },
          prose: { type: 'string', minLength: 1, maxLength: 4000 },
          cites: {
            type: 'array',
            maxItems: 10,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'ref'],
              properties: {
                label: { type: 'string', minLength: 1, maxLength: 120 },
                ref: { type: 'string', minLength: 1, maxLength: 200 },
              },
            },
          },
        },
      },
    },
    goalAlignmentMonth: {
      type: 'object',
      additionalProperties: false,
      required: ['direction', 'score', 'monthDelta', 'leadingSignal', 'why', 'pro', 'contra'],
      properties: {
        direction: { type: 'string', enum: [...MONTH_COMPASS_DIRECTIONS] },
        score: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
        monthDelta: { type: 'string', maxLength: 120 },
        leadingSignal: { type: 'string', maxLength: 300 },
        why: { type: 'string', maxLength: 600 },
        pro: {
          type: 'array',
          maxItems: 10,
          items: { type: 'string', minLength: 1, maxLength: 300 },
        },
        contra: {
          type: 'array',
          maxItems: 10,
          items: { type: 'string', minLength: 1, maxLength: 300 },
        },
      },
    },
    decisions: {
      type: 'array',
      minItems: 0,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'why'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 160 },
          why: { type: 'string', minLength: 1, maxLength: 400 },
        },
      },
    },
    nextFocus: {
      type: 'array',
      minItems: 0,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'why'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 160 },
          why: { type: 'string', minLength: 1, maxLength: 400 },
        },
      },
    },
    risksSummary: { type: 'string', minLength: 1, maxLength: 800 },
    ideasSummary: { type: 'string', minLength: 1, maxLength: 800 },
  },
};

const MonthVerdictStateSchema = z.enum(MONTH_VERDICT_STATES).catch('warn');

const MonthVerdictAxisSchema = z.object({
  key: z.enum(MONTH_AXIS_KEYS).catch('overall'),
  state: MonthVerdictStateSchema,
  label: z.string().catch(''),
  why: z.string().catch(''),
});

const MonthLetterCiteSchema = z.object({
  label: z.string().catch(''),
  ref: z.string().catch(''),
});

const MonthLetterSectionSchema = z.object({
  key: z.string().catch('main'),
  title: z.string().catch(''),
  prose: z.string().catch(''),
  cites: z.array(MonthLetterCiteSchema).optional().catch(undefined),
});

export const MonthCompanyResponseSchema = z.object({
  verdict: z.object({
    overall: z.object({
      state: MonthVerdictStateSchema,
      emoji: z.string().catch('⚠️'),
      title: z.string().catch('Месяц компании'),
      oneLiner: z.string().catch(''),
    }),
    axes: z.array(MonthVerdictAxisSchema).min(1),
  }),
  letter: z.array(MonthLetterSectionSchema).min(1),
  goalAlignmentMonth: z.object({
    direction: z.enum(MONTH_COMPASS_DIRECTIONS).catch('drift'),
    score: z.number().nullable().catch(null),
    monthDelta: z.string().catch(''),
    leadingSignal: z.string().catch(''),
    why: z.string().catch(''),
    pro: z.array(z.string()).catch([]),
    contra: z.array(z.string()).catch([]),
  }),
  decisions: z
    .array(z.object({ title: z.string().catch(''), why: z.string().catch('') }))
    .catch([]),
  nextFocus: z
    .array(z.object({ title: z.string().catch(''), why: z.string().catch('') }))
    .catch([]),
  risksSummary: z.string().catch(''),
  ideasSummary: z.string().catch(''),
});

export type MonthCompanyResponse = z.infer<typeof MonthCompanyResponseSchema>;

export interface MonthCompanyPackageWeek {
  weekStart: string;
  overallState: 'ok' | 'warn' | 'risk' | null;
  title: string | null;
  oneLiner: string | null;
  axes: Array<{ key: 'team' | 'clients' | 'execution' | 'overall'; state: 'ok' | 'warn' | 'risk' }>;
}

export interface MonthCompanyPackageTeam {
  reliabilityPercent: number | null;
  tasksDone: number;
  tasksPlanned: number;
  tasksNotDone: number;
  topRisk: Array<{ personName: string; broken: number; overdue: number }>;
}

export interface MonthCompanyPackageBlocker {
  text: string;
  count: number;
}

export interface MonthCompanyPackageCompass {
  goalName: string | null;
  score: number | null;
  delta: number | null;
  explanation: string | null;
  pro: string[];
  contra: string[];
}

export interface MonthCompanyPackagePace {
  factToGoal: number | null;
  planToGoal: number | null;
  etaIso: string | null;
}

export interface MonthCompanyPackagePrevMonth {
  state: string | null;
  title: string | null;
  shortSummary: string | null;
}

export interface MonthCompanyPackage {
  periodYm: string;
  from: string;
  to: string;
  goalId: string | null;
  goalName: string | null;
  weeks: MonthCompanyPackageWeek[];
  team: MonthCompanyPackageTeam;
  repeatedBlockers: MonthCompanyPackageBlocker[];
  compass: MonthCompanyPackageCompass | null;
  pace: MonthCompanyPackagePace | null;
  prevMonth: MonthCompanyPackagePrevMonth | null;
  missingWeeks: string[];
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export function buildMonthCompanyUserMessage(pkg: MonthCompanyPackage): string {
  const lines: string[] = [];
  lines.push('Контекст и правила — в system. Ниже переменные данные за месяц.');
  lines.push('');
  lines.push(`Месяц: ${pkg.periodYm} (${pkg.from} — ${pkg.to}, прошедший календарный месяц).`);

  if (pkg.missingWeeks.length > 0) {
    lines.push(
      `Нет недельной сводки за: ${pkg.missingWeeks.join(', ')} — учти пробел, не достраивай.`,
    );
  }

  lines.push('');
  lines.push('Недели месяца (вердикт + резюме каждой недели):');
  for (const w of pkg.weeks) {
    const title = w.title ? ` — ${w.title}` : '';
    const oneLiner = w.oneLiner ? `. ${truncate(w.oneLiner, 200)}` : '';
    lines.push(`  - ${w.weekStart}: ${w.overallState ?? 'нет данных'}${title}${oneLiner}`);
  }

  lines.push('');
  lines.push('Команда за месяц (план↔факт, надёжность):');
  lines.push(
    `  надёжность ${pkg.team.reliabilityPercent ?? '—'}%, задачи план→факт ${pkg.team.tasksDone} ` +
      `из ${pkg.team.tasksPlanned} (не сделано ${pkg.team.tasksNotDone}).`,
  );
  if (pkg.team.topRisk.length > 0) {
    lines.push(
      `  По риску: ${pkg.team.topRisk
        .map((r) => `${r.personName} (сорвал ${r.broken}, просрочил ${r.overdue})`)
        .join('; ')}.`,
    );
  }

  if (pkg.repeatedBlockers.length > 0) {
    lines.push('');
    lines.push('Повторяющиеся блокеры месяца (топ):');
    for (const b of pkg.repeatedBlockers) {
      lines.push(`  - ${truncate(b.text, 200)} (×${b.count}).`);
    }
  }

  lines.push('');
  if (pkg.compass) {
    const scoreStr = pkg.compass.score !== null ? `${pkg.compass.score}/100` : 'нет оценки';
    const deltaStr = pkg.compass.delta !== null ? `, изменение ${pkg.compass.delta}` : '';
    lines.push(
      `Главная цель: ${pkg.compass.goalName ?? '—'}. Оценка движения: ${scoreStr}${deltaStr}.`,
    );
    if (pkg.compass.explanation) {
      lines.push(`  объяснение: ${truncate(pkg.compass.explanation, 400)}.`);
    }
    if (pkg.compass.pro.length > 0) {
      lines.push(`  за движение: ${pkg.compass.pro.slice(0, 5).join('; ')}.`);
    }
    if (pkg.compass.contra.length > 0) {
      lines.push(`  против: ${pkg.compass.contra.slice(0, 5).join('; ')}.`);
    }
  } else {
    lines.push('Главная цель: не задана или оценки движения ещё нет.');
  }

  if (pkg.pace && (pkg.pace.factToGoal !== null || pkg.pace.planToGoal !== null || pkg.pace.etaIso)) {
    const fact = pkg.pace.factToGoal !== null ? `${pkg.pace.factToGoal}/100` : '—';
    const plan = pkg.pace.planToGoal !== null ? `${pkg.pace.planToGoal}/100` : '—';
    const eta = pkg.pace.etaIso ?? '—';
    lines.push(
      `Темп (посчитано системой, как справка): факт ${fact}, план ${plan}, прогноз достижения ${eta}.`,
    );
  }

  lines.push('');
  if (pkg.prevMonth) {
    const state = pkg.prevMonth.state ?? '—';
    const title = pkg.prevMonth.title ? ` (${pkg.prevMonth.title})` : '';
    lines.push(`Прошлый месяц: вердикт ${state}${title}.`);
    if (pkg.prevMonth.shortSummary) {
      lines.push(`Резюме прошлого месяца: ${truncate(pkg.prevMonth.shortSummary, 300)}.`);
    }
  } else {
    lines.push('Сводки за прошлый месяц нет — динамику к прошлому месяцу не строй.');
  }

  lines.push('');
  lines.push('Верни строго JSON по схеме (см. system).');
  return lines.join('\n');
}

export function monthCompanyToBodyMarkdown(
  verdict: MonthlyDigestVerdictDto,
  letter: MonthlyDigestLetterSectionDto[],
): string {
  const lines: string[] = [];
  lines.push(`# ${verdict.overall.title}`);
  if (verdict.overall.oneLiner) {
    lines.push('');
    lines.push(verdict.overall.oneLiner);
  }
  for (const section of letter) {
    lines.push('');
    lines.push(`## ${section.title}`);
    lines.push('');
    lines.push(section.prose);
  }
  return lines.join('\n');
}

export function buildFallbackMonthMarkdown(pkg: MonthCompanyPackage): string {
  const lines: string[] = [];
  lines.push(`# Месяц компании ${pkg.periodYm}`);
  lines.push('');
  lines.push(`Период: ${pkg.from} — ${pkg.to}.`);

  lines.push('');
  lines.push('## Недели месяца');
  for (const w of pkg.weeks) {
    const title = w.title ? ` — ${w.title}` : '';
    lines.push(`- ${w.weekStart}: ${w.overallState ?? 'нет данных'}${title}`);
  }
  if (pkg.missingWeeks.length > 0) {
    lines.push(`Нет недельной сводки за: ${pkg.missingWeeks.join(', ')}.`);
  }

  lines.push('');
  lines.push('## Команда');
  lines.push(
    `Надёжность ${pkg.team.reliabilityPercent ?? '—'}%, задачи план→факт ${pkg.team.tasksDone} ` +
      `из ${pkg.team.tasksPlanned} (не сделано ${pkg.team.tasksNotDone}).`,
  );

  if (pkg.repeatedBlockers.length > 0) {
    lines.push('');
    lines.push('## Повторяющиеся блокеры');
    for (const b of pkg.repeatedBlockers) {
      lines.push(`- ${b.text} (×${b.count})`);
    }
  }

  return lines.join('\n');
}

export interface MonthVerdictSignals {
  hasNegativeClientSignal: boolean;
  executionStrained: boolean;
}

export function computeMonthVerdictSignals(pkg: MonthCompanyPackage): MonthVerdictSignals {
  const hasNegativeClientSignal = pkg.weeks.some((w) =>
    w.axes.some((a) => a.key === 'clients' && a.state === 'risk'),
  );
  const executionStrained =
    pkg.team.tasksPlanned >= 1 && pkg.team.tasksDone / pkg.team.tasksPlanned < 0.5;
  return { hasNegativeClientSignal, executionStrained };
}

export function clampMonthVerdict(
  verdict: MonthlyDigestVerdictDto,
  signals: MonthVerdictSignals,
): MonthlyDigestVerdictDto {
  const axes = verdict.axes.map((a) => ({ ...a }));
  const overall = { ...verdict.overall };

  const clientsAxis = axes.find((a) => a.key === 'clients');
  if (signals.hasNegativeClientSignal && clientsAxis && clientsAxis.state === 'ok') {
    clientsAxis.state = 'risk';
  }

  const executionAxis = axes.find((a) => a.key === 'execution');
  if (signals.executionStrained && executionAxis && executionAxis.state === 'ok') {
    executionAxis.state = 'warn';
  }

  const anyDomainRisk = axes.some(
    (a) => (a.key === 'team' || a.key === 'clients' || a.key === 'execution') && a.state === 'risk',
  );
  if (anyDomainRisk || signals.executionStrained) {
    if (overall.state === 'ok') overall.state = 'warn';
    const overallAxis = axes.find((a) => a.key === 'overall');
    if (overallAxis && overallAxis.state === 'ok') overallAxis.state = 'warn';
  }

  return { overall, axes };
}

function unwrapMonthEnvelopes(value: unknown): unknown[] {
  const out: unknown[] = [value];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of ['result', 'data', 'output', 'response']) {
      if (obj[key] && typeof obj[key] === 'object') out.push(obj[key]);
    }
  }
  return out;
}

export function extractMonthCompanyResponse(result: {
  text: string;
  toolCalls?: Array<{ input: unknown }>;
}): MonthCompanyResponse | null {
  const roots: unknown[] = [];
  const firstTool = result.toolCalls?.[0];
  if (firstTool) roots.push(firstTool.input);
  roots.push(tryParseJson(result.text ?? ''));
  for (const root of roots) {
    for (const candidate of unwrapMonthEnvelopes(root)) {
      const parsed = MonthCompanyResponseSchema.safeParse(candidate);
      if (parsed.success) return parsed.data;
    }
  }
  return null;
}

export function buildMonthWeekTrend(
  weeks: MonthCompanyPackageWeek[],
  weekStarts: string[],
): MonthWeekTrendAxisDto[] {
  const AXES: Array<'team' | 'clients' | 'execution' | 'overall'> = [
    'team',
    'clients',
    'execution',
    'overall',
  ];
  const byWeek = new Map(weeks.map((w) => [w.weekStart, w]));
  return AXES.map((key) => ({
    key,
    weeks: weekStarts.map((weekStart) => {
      const week = byWeek.get(weekStart);
      let state: MonthWeekTrendState = 'none';
      if (week) {
        if (key === 'overall') state = week.overallState ?? 'none';
        else state = week.axes.find((a) => a.key === key)?.state ?? 'none';
      }
      return { weekStart, state };
    }),
  }));
}
