import { z } from 'zod';

import type {
  WeeklyDigestLetterSectionDto,
  WeeklyDigestVerdictDto,
} from '../dto/weekly-digest.dto';

export const WEEKLY_DIGEST_PROMPT_VERSION = 'prompt-v1';

export interface WeeklyDigestAggregates {
  weekStart: string;
  weekEnd: string;
  totalCheckIns: number;
  greenShare: number;
  yellowShare: number;
  redShare: number;
  topBlockers: Array<{ text: string; count: number }>;
  topInsights: Array<{ statement: string; kind: string; dynamicLabel: string }>;
  goals: {
    completed: number;
    failed: number;
    inProgress: number;
    completedDelta: number;
    failedDelta: number;
  };
  topIdeas?: Array<{
    statement: string;
    status: string;
    supporterCount: number;
  }>;
}

function pct(v: number): string {
  if (!Number.isFinite(v)) return '0%';
  return `${Math.round(v * 100)}%`;
}

function signed(v: number): string {
  if (v > 0) return `+${v}`;
  return String(v);
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export function buildFallbackDigestMarkdown(agg: WeeklyDigestAggregates): string {
  const lines: string[] = [];
  lines.push(`# Недельная сводка ${agg.weekStart} — ${agg.weekEnd}`);
  lines.push('');
  lines.push('## Температура команды');
  lines.push(
    `Всего чек-инов: ${agg.totalCheckIns}. Зелёных ${pct(agg.greenShare)}, ` +
      `жёлтых ${pct(agg.yellowShare)}, красных ${pct(agg.redShare)}.`,
  );

  if (agg.topBlockers.length > 0) {
    lines.push('');
    lines.push('## Повторяющиеся блокеры');
    for (const b of agg.topBlockers.slice(0, 5)) {
      lines.push(`- ${b.text} (упоминаний: ${b.count})`);
    }
  }

  if (agg.topInsights.length > 0) {
    lines.push('');
    lines.push('## Главные сигналы');
    for (const i of agg.topInsights.slice(0, 3)) {
      lines.push(`- [${i.kind}/${i.dynamicLabel}] ${i.statement}`);
    }
  }

  lines.push('');
  lines.push('## Цели');
  lines.push(
    `Закрыто ${agg.goals.completed} (${signed(agg.goals.completedDelta)}), ` +
      `провалено ${agg.goals.failed} (${signed(agg.goals.failedDelta)}), в работе ${agg.goals.inProgress}.`,
  );

  if (agg.topIdeas && agg.topIdeas.length > 0) {
    lines.push('');
    lines.push('## Идеи недели');
    for (const i of agg.topIdeas.slice(0, 5)) {
      lines.push(`- [${i.status}/поддержали ${i.supporterCount}] ${i.statement}`);
    }
  }

  return lines.join('\n');
}

export const WEEK_COMPANY_PROMPT_VERSION = 'week-company-v1';
export const WEEKLY_DIGEST_TASK_TYPE = 'operations-weekly-digest';

const WEEK_VERDICT_STATES = ['ok', 'warn', 'risk'] as const;
const WEEK_AXIS_KEYS = ['team', 'clients', 'execution', 'overall'] as const;
const WEEK_LETTER_KEYS = [
  'main',
  'done',
  'not_done',
  'reporting',
  'blocked',
  'clients',
  'ideas',
  'reflection',
  'actions',
  'delta',
] as const;
const WEEK_COMPASS_DIRECTIONS = ['to_goal', 'drift', 'against'] as const;

export const WEEK_COMPANY_SYSTEM_PROMPT = [
  'Ты — личный операционный аналитик (COO) владельца компании. Раз в неделю, в понедельник утром, ты собираешь для него «Неделю компании»: спокойный, честный разбор того, как прошла прошедшая рабочая неделя (пн–пт), сводя воедино пять ежедневных разборов «День компании» и детерминированные показатели недели.',
  '',
  'Твоя задача — на входных данных собрать четыре вещи: вердикт недели (4 оси), письмо «как прошла неделя» (чистая проза по секциям), недельный компас к главной цели и два коротких резюме (риски и идеи).',
  '',
  'Жёсткие правила:',
  '  - Пиши только по-русски.',
  '  - Опирайся ТОЛЬКО на предоставленные данные (пять дневных сводок + показатели недели). Не выдумывай факты, события, цифры и имена. Если по блоку нет данных — не пиши о нём.',
  '  - Приватность: имена сотрудников из чек-инов и личные подробности дословно не цитируй. Говори о картине в целом.',
  '  - Тон — спокойный, фактологичный, без алармизма и без напускного оптимизма. Лучше честно «неделя ушла вправо», чем приукрасить.',
  '  - Это сводка за НЕДЕЛЮ, а не за день: говори о тенденции пяти дней, повторяемости и накопленном долге, не пересказывай каждый день по отдельности.',
  '',
  'Вердикт — ровно 4 оси в этом порядке: team, clients, execution, overall. У каждой оси state ∈ ok|warn|risk, короткий label по-русски и why (1 фраза по данным недели). overall.state — итог недели; overall.emoji — один эмодзи под состояние; overall.title — короткий заголовок недели; overall.oneLiner — одно предложение-резюме для рассылки.',
  '',
  'Письмо (letter) — массив секций. Каждая секция: key из фиксированного списка (main, done, not_done, reporting, blocked, clients, ideas, reflection, actions, delta), короткий title и prose — чистая связная проза (для озвучки и Telegram), без списков-маркеров и markdown-таблиц. cites — опционально {label, ref}. Начни с key=main («Главное за неделю»). Пиши только те секции, под которые есть данные. В секции delta опиши динамику к прошлой неделе, если её показатели даны.',
  '',
  'Недельный компас (goalAlignmentWeek) — про главную цель компании: direction ∈ to_goal|drift|against, score — число 0..100 или null, weekDelta — короткая строка про движение к цели за неделю (например «+2 из 10»), why — 1-2 предложения, pro и contra — массивы коротких строк (за движение к цели / против). Если данных о цели нет — direction=drift, score=null, пустые pro/contra, честное why.',
  '',
  'risksSummary и ideasSummary — по 1-2 предложения: недельное резюме главных рисков и идей. Если нечего сказать — короткая честная фраза.',
  '',
  'Формат ответа — строго JSON по схеме WeekCompany (см. response_format). Без markdown-обёртки, без преамбулы, без текста вне JSON.',
].join('\n');

export const WEEK_COMPANY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'letter', 'goalAlignmentWeek', 'risksSummary', 'ideasSummary'],
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
            state: { type: 'string', enum: [...WEEK_VERDICT_STATES] },
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
              key: { type: 'string', enum: [...WEEK_AXIS_KEYS] },
              state: { type: 'string', enum: [...WEEK_VERDICT_STATES] },
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
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'title', 'prose'],
        properties: {
          key: { type: 'string', enum: [...WEEK_LETTER_KEYS] },
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
    goalAlignmentWeek: {
      type: 'object',
      additionalProperties: false,
      required: ['direction', 'score', 'weekDelta', 'why', 'pro', 'contra'],
      properties: {
        direction: { type: 'string', enum: [...WEEK_COMPASS_DIRECTIONS] },
        score: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
        weekDelta: { type: 'string', maxLength: 120 },
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
    risksSummary: { type: 'string', minLength: 1, maxLength: 800 },
    ideasSummary: { type: 'string', minLength: 1, maxLength: 800 },
  },
};

const WeekVerdictStateSchema = z.enum(WEEK_VERDICT_STATES).catch('warn');

const WeekVerdictAxisSchema = z.object({
  key: z.enum(WEEK_AXIS_KEYS).catch('overall'),
  state: WeekVerdictStateSchema,
  label: z.string().catch(''),
  why: z.string().catch(''),
});

const WeekLetterCiteSchema = z.object({
  label: z.string().catch(''),
  ref: z.string().catch(''),
});

const WeekLetterSectionSchema = z.object({
  key: z.string().catch('main'),
  title: z.string().catch(''),
  prose: z.string().catch(''),
  cites: z.array(WeekLetterCiteSchema).optional().catch(undefined),
});

export const WeekCompanyResponseSchema = z.object({
  verdict: z.object({
    overall: z.object({
      state: WeekVerdictStateSchema,
      emoji: z.string().catch('⚠️'),
      title: z.string().catch('Неделя компании'),
      oneLiner: z.string().catch(''),
    }),
    axes: z.array(WeekVerdictAxisSchema).min(1),
  }),
  letter: z.array(WeekLetterSectionSchema).min(1),
  goalAlignmentWeek: z.object({
    direction: z.enum(WEEK_COMPASS_DIRECTIONS).catch('drift'),
    score: z.number().nullable().catch(null),
    weekDelta: z.string().catch(''),
    why: z.string().catch(''),
    pro: z.array(z.string()).catch([]),
    contra: z.array(z.string()).catch([]),
  }),
  risksSummary: z.string().catch(''),
  ideasSummary: z.string().catch(''),
});

export type WeekCompanyResponse = z.infer<typeof WeekCompanyResponseSchema>;

export interface WeekCompanyPackageDay {
  dateLocal: string;
  overallState: 'ok' | 'warn' | 'risk' | null;
  title: string | null;
  shortSummary: string | null;
  axes: Array<{ key: 'team' | 'clients' | 'execution' | 'overall'; state: 'ok' | 'warn' | 'risk' }>;
}

export interface WeekCompanyPackageTeam {
  tasksDone: number;
  tasksPlanned: number;
  tasksNotDone: number;
}

export interface WeekCompanyPackageBlocker {
  text: string;
  count: number;
}

export interface WeekCompanyPackageRisk {
  statement: string;
  kind: string;
  dynamicLabel: string;
}

export interface WeekCompanyPackageCompass {
  goalName: string | null;
  score: number | null;
  delta: number | null;
  explanation: string | null;
  pro: string[];
  contra: string[];
}

export interface WeekCompanyPackagePrevWeek {
  state: string | null;
  title: string | null;
  shortSummary: string | null;
}

export interface WeekCompanyPackage {
  weekStart: string;
  weekEnd: string;
  goalId: string | null;
  goalName: string | null;
  days: WeekCompanyPackageDay[];
  team: WeekCompanyPackageTeam;
  repeatedBlockers: WeekCompanyPackageBlocker[];
  repeatedRisks: WeekCompanyPackageRisk[];
  compass: WeekCompanyPackageCompass | null;
  prevWeek: WeekCompanyPackagePrevWeek | null;
  missingDays: string[];
}

export function buildWeekCompanyUserMessage(pkg: WeekCompanyPackage): string {
  const lines: string[] = [];
  lines.push('Контекст и правила — в system. Ниже переменные данные за неделю.');
  lines.push('');
  lines.push(
    `Неделя: ${pkg.weekStart} — ${pkg.weekEnd} (пн–пт, прошедшая рабочая неделя).`,
  );

  if (pkg.missingDays.length > 0) {
    lines.push(
      `Нет дневной сводки за: ${pkg.missingDays.join(', ')} — учти пробел, не достраивай.`,
    );
  }

  lines.push('');
  lines.push('Пять дней недели (вердикт + резюме каждого дня):');
  for (const d of pkg.days) {
    const title = d.title ? ` — ${d.title}` : '';
    const summary = d.shortSummary ? `. ${truncate(d.shortSummary, 200)}` : '';
    lines.push(`  - ${d.dateLocal}: ${d.overallState ?? 'нет данных'}${title}${summary}`);
  }

  lines.push('');
  lines.push('Команда за неделю (план↔факт):');
  lines.push(
    `  задачи план→факт ${pkg.team.tasksDone} ` +
      `из ${pkg.team.tasksPlanned} (не сделано ${pkg.team.tasksNotDone}).`,
  );

  if (pkg.repeatedBlockers.length > 0) {
    lines.push('');
    lines.push('Повторяющиеся блокеры недели (топ):');
    for (const b of pkg.repeatedBlockers) {
      lines.push(`  - ${truncate(b.text, 200)} (×${b.count}).`);
    }
  }

  if (pkg.repeatedRisks.length > 0) {
    lines.push('');
    lines.push('Повторяющиеся риски/сигналы недели:');
    for (const r of pkg.repeatedRisks) {
      lines.push(`  - [${r.kind}, динамика: ${r.dynamicLabel}] ${truncate(r.statement, 200)}.`);
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

  lines.push('');
  if (pkg.prevWeek) {
    const state = pkg.prevWeek.state ?? '—';
    const title = pkg.prevWeek.title ? ` (${pkg.prevWeek.title})` : '';
    lines.push(`Прошлая неделя: вердикт ${state}${title}.`);
    if (pkg.prevWeek.shortSummary) {
      lines.push(`Резюме прошлой недели: ${truncate(pkg.prevWeek.shortSummary, 300)}.`);
    }
  } else {
    lines.push('Сводки за прошлую неделю нет — динамику к прошлой неделе не строй.');
  }

  lines.push('');
  lines.push('Верни строго JSON по схеме (см. system).');
  return lines.join('\n');
}

export function weekCompanyToBodyMarkdown(
  verdict: WeeklyDigestVerdictDto,
  letter: WeeklyDigestLetterSectionDto[],
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
