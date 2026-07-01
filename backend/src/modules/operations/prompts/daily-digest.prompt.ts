import { z } from 'zod';

import type {
  DailyDigestAggregates,
  DailyDigestMetricsDto,
  DailyDigestVerdictDto,
  DailyDigestLetterSectionDto,
} from '../dto/daily-digest.dto';

export const DAILY_DIGEST_PROMPT_VERSION = 'prompt-v1';

export const DAILY_DIGEST_TASK_TYPE = 'operations-daily-digest';

const SHORT_SUMMARY_DELIMITER = '---SHORT_SUMMARY---';

const INSIGHT_KIND_RU: Record<string, string> = {
  problem: 'проблема',
  risk: 'риск',
  blocker: 'блокер',
  inefficiency: 'неэффективность',
};
function insightKindRu(k: string): string {
  return INSIGHT_KIND_RU[k] ?? k;
}

export function parseDailyDigestLlmResponse(raw: string): {
  bodyMarkdown: string;
  shortSummary: string | null;
} {
  const trimmed = (raw ?? '').trim();
  const idx = trimmed.indexOf(SHORT_SUMMARY_DELIMITER);
  if (idx === -1) {
    const firstPara = trimmed.split(/\n{2,}/)[0]?.trim() ?? null;
    return {
      bodyMarkdown: trimmed,
      shortSummary: firstPara && firstPara.length <= 600 ? firstPara : null,
    };
  }
  const body = trimmed.slice(0, idx).trim();
  const short = trimmed.slice(idx + SHORT_SUMMARY_DELIMITER.length).trim();
  return {
    bodyMarkdown: body,
    shortSummary: short.length > 0 ? short : null,
  };
}

export function buildFallbackDigestMarkdown(agg: DailyDigestAggregates): {
  bodyMarkdown: string;
  shortSummary: string | null;
} {
  const lines: string[] = [];
  lines.push(`# Ежедневный отчёт за ${agg.dateLocal}`);
  lines.push('');
  lines.push('## Температура команды');
  lines.push(
    `Всего чек-инов: ${agg.totalCheckIns}. Зелёных ${pct(agg.greenShare)}, ` +
      `жёлтых ${pct(agg.yellowShare)}, красных ${pct(agg.redShare)}.`,
  );

  if (agg.newBlockers.length > 0) {
    lines.push('');
    lines.push('## Новые блокеры');
    for (const b of agg.newBlockers.slice(0, 5)) {
      lines.push(`- ${b.name}`);
    }
  }

  lines.push('');
  lines.push('## Цели');
  lines.push(
    `Закрыто ${agg.goals.completed}, провалено ${agg.goals.failed}, ` +
      `активны ${agg.goals.activated}.`,
  );

  if (agg.newHighInsights.length > 0) {
    lines.push('');
    lines.push('## Сигналы (важные)');
    for (const i of agg.newHighInsights.slice(0, 5)) {
      lines.push(`- [${insightKindRu(i.kind)}] ${i.statement}`);
    }
  }

  const shortSummary =
    `Сводка за ${agg.dateLocal}: чек-инов ${agg.totalCheckIns} ` +
    `(красных ${pct(agg.redShare)}), новых блокеров ${agg.newBlockers.length}, ` +
    `новых сигналов ${agg.newHighInsights.length}. ` +
    `Связный комментарий не сгенерирован — LLM недоступна.`;

  return { bodyMarkdown: lines.join('\n'), shortSummary };
}

function pct(v: number): string {
  if (!Number.isFinite(v)) return '0%';
  return `${Math.round(v * 100)}%`;
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export const DAY_COMPANY_PROMPT_VERSION = 'day-company-v1';

const VERDICT_STATES = ['ok', 'warn', 'risk'] as const;
const AXIS_KEYS = ['team', 'clients', 'execution', 'overall'] as const;
const LETTER_KEYS = [
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
const COMPASS_DIRECTIONS = ['to_goal', 'drift', 'against'] as const;

export const DAY_COMPANY_SYSTEM_PROMPT = [
  'Ты — личный операционный аналитик (COO) владельца компании. Раз в сутки ты собираешь для него «День компании»: спокойный, честный разбор того, как прошёл день, на основе агрегированных данных за прошедшие сутки.',
  '',
  'Твоя задача — на входных данных собрать четыре вещи: вердикт дня (4 оси), письмо «как прошёл день» (чистая проза по секциям), дневной компас к главной цели и два коротких резюме (риски и идеи).',
  '',
  'Жёсткие правила:',
  '  - Пиши только по-русски.',
  '  - Опирайся ТОЛЬКО на предоставленные данные. Не выдумывай факты, события, цифры и имена. Если по блоку нет данных — не пиши о нём.',
  '  - Приватность: имена сотрудников из чек-инов и личные подробности дословно не цитируй. Говори о картине в целом, без персональных деталей из настроений.',
  '  - Тон — спокойный, фактологичный, без алармизма и без напускного оптимизма. Ты не болельщик: лучше честно «есть трение», чем приукрасить.',
  '',
  'Вердикт — ровно 4 оси в этом порядке: team, clients, execution, overall. У каждой оси state ∈ ok|warn|risk, короткий label по-русски и why (1 фраза, опирается на данные). overall.state в блоке overall — итог дня; overall.emoji — один эмодзи под состояние (🟢/⚠️/🔴 или близкий); overall.title — короткий заголовок дня; overall.oneLiner — одно предложение-резюме для рассылки.',
  '',
  'Письмо (letter) — массив секций. Каждая секция: key из фиксированного списка (main, done, not_done, reporting, blocked, clients, ideas, reflection, actions, delta), короткий title и prose — чистая связная проза (для озвучки и Telegram), без списков-маркеров и без markdown-таблиц. cites — опционально, ссылки на источники {label, ref}. Начни с секции key=main («Главное за день»). Пиши только те секции, под которые есть данные.',
  '',
  'Дневной компас (goalAlignmentDay) — про главную цель компании: direction ∈ to_goal|drift|against, score — число 0..100 или null (если оценки нет), todayDelta — короткая строка про изменение ко вчера, why — 1-2 предложения, pro и contra — массивы коротких строк (за движение к цели / против). Если данных о цели нет — direction=drift, score=null, пустые pro/contra, честное why.',
  '',
  'risksSummary и ideasSummary — по 1-2 предложения каждое: дневное резюме главных рисков и главных идей. Если нечего сказать — короткая честная фраза.',
  '',
  'Формат ответа — строго JSON по схеме DayCompany (см. response_format). Без markdown-обёртки, без преамбулы, без текста вне JSON.',
].join('\n');

export const DAY_COMPANY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'letter', 'goalAlignmentDay', 'risksSummary', 'ideasSummary'],
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
            state: { type: 'string', enum: [...VERDICT_STATES] },
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
              key: { type: 'string', enum: [...AXIS_KEYS] },
              state: { type: 'string', enum: [...VERDICT_STATES] },
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
          key: { type: 'string', enum: [...LETTER_KEYS] },
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
    goalAlignmentDay: {
      type: 'object',
      additionalProperties: false,
      required: ['direction', 'score', 'todayDelta', 'why', 'pro', 'contra'],
      properties: {
        direction: { type: 'string', enum: [...COMPASS_DIRECTIONS] },
        score: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
        todayDelta: { type: 'string', maxLength: 120 },
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

const VerdictStateSchema = z.enum(VERDICT_STATES).catch('warn');

const VerdictAxisSchema = z.object({
  key: z.enum(AXIS_KEYS).catch('overall'),
  state: VerdictStateSchema,
  label: z.string().catch(''),
  why: z.string().catch(''),
});

const LetterCiteSchema = z.object({
  label: z.string().catch(''),
  ref: z.string().catch(''),
});

const LetterSectionSchema = z.object({
  key: z.string().catch('main'),
  title: z.string().catch(''),
  prose: z.string().catch(''),
  cites: z.array(LetterCiteSchema).optional().catch(undefined),
});

export const DayCompanyResponseSchema = z.object({
  verdict: z.object({
    overall: z.object({
      state: VerdictStateSchema,
      emoji: z.string().catch('⚠️'),
      title: z.string().catch('День компании'),
      oneLiner: z.string().catch(''),
    }),
    axes: z.array(VerdictAxisSchema).min(1),
  }),
  letter: z.array(LetterSectionSchema).min(1),
  goalAlignmentDay: z.object({
    direction: z.enum(COMPASS_DIRECTIONS).catch('drift'),
    score: z.number().nullable().catch(null),
    todayDelta: z.string().catch(''),
    why: z.string().catch(''),
    pro: z.array(z.string()).catch([]),
    contra: z.array(z.string()).catch([]),
  }),
  risksSummary: z.string().catch(''),
  ideasSummary: z.string().catch(''),
});

export type DayCompanyResponse = z.infer<typeof DayCompanyResponseSchema>;

export interface DayCompanyPackageMeeting {
  id: string;
  title: string;
  summary: string | null;
}

export interface DayCompanyPackageInsight {
  id: string;
  statement: string;
  severity: string;
  kind: string;
}

export interface DayCompanyPackageIdea {
  id: string;
  statement: string;
  weight: number;
  supporterCount: number;
}

export interface DayCompanyPackageCustomer {
  customerName: string;
  riskLevel: string;
  signals: string;
}

export interface DayCompanyPackageCompass {
  goalName: string | null;
  score: number | null;
  delta: number | null;
  explanation: string | null;
  pro: string[];
  contra: string[];
}

export interface DayCompanyPackageYesterday {
  state: string | null;
  title: string | null;
  shortSummary: string | null;
}

export interface DayCompanyEmployeeVoiceItem {
  text: string;
  signalType: string;
}

export interface DayCompanyEmployeeVoice {
  personId: string;
  personName: string;
  ideas: DayCompanyEmployeeVoiceItem[];
  risks: DayCompanyEmployeeVoiceItem[];
  other: DayCompanyEmployeeVoiceItem[];
}

export interface DayCompanyRawTurn {
  author: string;
  personId: string | null;
  isClient: boolean;
  ts: string;
  text: string;
}

export interface DayCompanyRawSession {
  session: string;
  turns: DayCompanyRawTurn[];
}

export interface DayCompanyRawConversations {
  bitrix: DayCompanyRawSession[];
  chatbox: DayCompanyRawSession[];
}

export interface DayCompanySignalBlocker {
  text: string;
  confidence: number;
}

export interface DayCompanySignalRisk {
  text: string;
  causeCategory: string | null;
  dynamicLabel: string;
  observations: number;
  frequencyScore: number;
  status: string;
  severity: string;
}

export interface DayCompanySignalIdea {
  text: string;
  supporterCount: number;
  weight: number;
  status: string;
  clusterId: string | null;
}

export interface DayCompanySignals {
  blockers: DayCompanySignalBlocker[];
  risks: DayCompanySignalRisk[];
  ideas: DayCompanySignalIdea[];
}

export interface DayCompanyConflict {
  fromPersonName: string | null;
  toPersonName: string | null;
  confidence: number;
  explanation: string;
  since: string;
}

export interface DayCompanyReportingPerson {
  personName: string;
  planSubmitted: boolean;
  reportSubmitted: boolean;
  planned: number;
  done: number;
  mismatchReason?: string;
}

export interface DayCompanyReporting {
  planSubmitted: { done: number; total: number };
  reportSubmitted: { done: number; total: number };
  perPerson: DayCompanyReportingPerson[];
  noReport: string[];
  tasksSet: number;
  tasksDone: number;
  dayPlan: { done: number; total: number };
}

export interface DayCompanyYesterdaySignal {
  text: string;
  axis: string;
  state: string;
}

export interface DayCompanyPackage {
  dateLocal: string;
  goalId: string | null;
  goalName: string | null;
  meetings: DayCompanyPackageMeeting[];
  topInsights: DayCompanyPackageInsight[];
  topIdeas: DayCompanyPackageIdea[];
  customersAtRisk: DayCompanyPackageCustomer[];
  compass: DayCompanyPackageCompass | null;
  yesterday: DayCompanyPackageYesterday | null;
  employeeVoice: DayCompanyEmployeeVoice[];
  rawConversations: DayCompanyRawConversations;
  signals: DayCompanySignals;
  conflicts: DayCompanyConflict[];
  reporting: DayCompanyReporting;
  yesterdayOpenSignals: DayCompanyYesterdaySignal[];
}

export function buildDayCompanyUserMessage(
  pkg: DayCompanyPackage,
  metrics: DailyDigestMetricsDto,
  dateLocal: string,
): string {
  const lines: string[] = [];
  lines.push('Контекст и правила — в system. Ниже переменные данные за день.');
  lines.push('');
  lines.push(`Дата отчёта: ${dateLocal} (прошедшие сутки в МСК).`);
  lines.push('');

  lines.push('Температура команды:');
  lines.push(
    `  всего чек-инов: ${metrics.totalCheckIns}; зелёных ${pct(metrics.greenShare)}, ` +
      `жёлтых ${pct(metrics.yellowShare)}, красных ${pct(metrics.redShare)}.`,
  );

  if (pkg.meetings.length > 0) {
    lines.push('');
    lines.push('Встречи дня (резюме fast-отчётов):');
    for (const m of pkg.meetings.slice(0, 12)) {
      const summary = m.summary ? `: ${truncate(m.summary, 240)}` : '';
      lines.push(`  - ${truncate(m.title, 120)}${summary}`);
    }
  }

  if (metrics.newBlockers.length > 0) {
    lines.push('');
    lines.push('Новые блокеры за день (топ-5):');
    for (const b of metrics.newBlockers.slice(0, 5)) {
      lines.push(`  - ${truncate(b.name, 200)} (уверенность ${pct(b.confidence)}).`);
    }
  }

  lines.push('');
  lines.push('Цели (изменения статуса за день):');
  lines.push(
    `  закрыто ${metrics.goals.completed}, провалено ${metrics.goals.failed}, ` +
      `вновь активны ${metrics.goals.activated}.`,
  );

  if (pkg.topInsights.length > 0) {
    lines.push('');
    lines.push('Риски и сигналы (важные, топ-5):');
    for (const i of pkg.topInsights) {
      lines.push(
        `  - [${insightKindRu(i.kind)}, острота: ${i.severity}] ${truncate(i.statement, 200)}.`,
      );
    }
  }

  if (pkg.topIdeas.length > 0) {
    lines.push('');
    lines.push('Идеи (топ-5 по весу):');
    for (const idea of pkg.topIdeas) {
      lines.push(
        `  - ${truncate(idea.statement, 200)} (вес ${idea.weight.toFixed(2)}, поддержали ${idea.supporterCount}).`,
      );
    }
  }

  if (pkg.customersAtRisk.length > 0) {
    lines.push('');
    lines.push('Клиенты под риском (топ-5):');
    for (const c of pkg.customersAtRisk) {
      lines.push(`  - ${truncate(c.customerName, 80)} — ${c.riskLevel} (${c.signals}).`);
    }
  }

  lines.push('');
  if (pkg.compass) {
    lines.push('Главная цель компании и движение к ней:');
    lines.push(`  цель: ${pkg.compass.goalName ?? '—'}.`);
    const scoreStr = pkg.compass.score !== null ? `${pkg.compass.score}/100` : 'нет оценки';
    const deltaStr = pkg.compass.delta !== null ? `, изменение ${pkg.compass.delta}` : '';
    lines.push(`  последняя оценка: ${scoreStr}${deltaStr}.`);
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
    lines.push('Главная цель компании: не задана или оценки движения ещё нет.');
  }

  lines.push('');
  if (pkg.yesterday) {
    const state = pkg.yesterday.state ?? '—';
    const title = pkg.yesterday.title ? ` (${pkg.yesterday.title})` : '';
    lines.push(`Вчерашний вердикт: ${state}${title}.`);
    if (pkg.yesterday.shortSummary) {
      lines.push(`Вчерашнее резюме: ${truncate(pkg.yesterday.shortSummary, 300)}.`);
    }
  } else {
    lines.push('Вчерашнего отчёта нет — динамику ко вчера не строй.');
  }

  lines.push('');
  lines.push('Верни строго JSON по схеме (см. system).');
  return lines.join('\n');
}

export function dayCompanyToBodyMarkdown(
  verdict: DailyDigestVerdictDto,
  letter: DailyDigestLetterSectionDto[],
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
