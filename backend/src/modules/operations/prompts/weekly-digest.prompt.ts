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
  hangingDecisions: Array<{ statement: string; ageDays: number }>;
  topIdeas?: Array<{
    statement: string;
    status: string;
    supporterCount: number;
  }>;
}

export const WEEKLY_DIGEST_SYSTEM_PROMPT = [
  'Ты — аналитик операционного директора. На вход — агрегат показателей компании за прошедшую неделю.',
  'Твоя задача — собрать связный комментарий из 5-7 коротких разделов в формате Markdown:',
  '',
  '  1. Температура команды (доли зелёных/жёлтых/красных, динамика, тревожные моменты).',
  '  2. Главные блокеры (повторяющиеся, что мешает регулярно).',
  '  3. Сигналы недели (топ-инсайты — что обостряется).',
  '  4. Цели (что закрыли, что провалили, что в работе; динамика к прошлой неделе).',
  '  5. Висящие решения (что зависло без отметки о результате).',
  '  6. Главный вывод (1-2 предложения — на что обратить внимание в первую очередь).',
  '',
  'Жёсткие правила:',
  '  - На русском, plain markdown без HTML и без таблиц.',
  '  - Только то, что есть в данных. Не додумывай и не давай советов на пустом месте.',
  '  - Без воды и без преамбулы. Сразу к делу.',
  '  - Тон — спокойный и фактологичный (не алармизм, не оптимизм).',
  '  - Если по какому-то блоку данных нет — пропусти раздел, не пиши «нет данных» как пункт.',
  '  - Не называй сотрудников по именам и не цитируй персональные подробности из чек-инов (приватность).',
  '  - Длина — 250-600 слов.',
].join('\n');

export function buildWeeklyDigestUserMessage(agg: WeeklyDigestAggregates): string {
  const lines: string[] = [];
  lines.push(`Период: ${agg.weekStart} — ${agg.weekEnd}.`);
  lines.push('');
  lines.push('Температура команды:');
  lines.push(
    `  всего чек-инов: ${agg.totalCheckIns}; зелёных ${pct(agg.greenShare)}, ` +
      `жёлтых ${pct(agg.yellowShare)}, красных ${pct(agg.redShare)}.`,
  );

  if (agg.topBlockers.length > 0) {
    lines.push('');
    lines.push('Повторяющиеся блокеры (топ-5):');
    for (const b of agg.topBlockers.slice(0, 5)) {
      lines.push(`  - ${truncate(b.text, 200)} (упоминаний: ${b.count}).`);
    }
  }

  if (agg.topInsights.length > 0) {
    lines.push('');
    lines.push('Главные сигналы (топ-3 по динамике):');
    for (const i of agg.topInsights.slice(0, 3)) {
      lines.push(`  - [${i.kind}, динамика ${i.dynamicLabel}] ${truncate(i.statement, 200)}.`);
    }
  }

  lines.push('');
  lines.push('Цели:');
  lines.push(
    `  закрыто ${agg.goals.completed} (${signed(agg.goals.completedDelta)} к прошлой неделе), ` +
      `провалено ${agg.goals.failed} (${signed(agg.goals.failedDelta)}), в работе ${agg.goals.inProgress}.`,
  );

  if (agg.hangingDecisions.length > 0) {
    lines.push('');
    lines.push('Висящие решения (старше 7 дней без отметки о результате):');
    for (const d of agg.hangingDecisions.slice(0, 5)) {
      lines.push(`  - ${truncate(d.statement, 200)} (возраст ${d.ageDays} дн.).`);
    }
  }

  if (agg.topIdeas && agg.topIdeas.length > 0) {
    lines.push('');
    lines.push('Идеи недели (топ-5 по весу):');
    for (const i of agg.topIdeas.slice(0, 5)) {
      lines.push(
        `  - [${i.status}, поддержали ${i.supporterCount}] ${truncate(i.statement, 200)}.`,
      );
    }
  }

  return lines.join('\n');
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

  if (agg.hangingDecisions.length > 0) {
    lines.push('');
    lines.push('## Висящие решения');
    for (const d of agg.hangingDecisions.slice(0, 5)) {
      lines.push(`- ${d.statement} (возраст ${d.ageDays} дн.)`);
    }
  }

  if (agg.topIdeas && agg.topIdeas.length > 0) {
    lines.push('');
    lines.push('## Идеи недели');
    for (const i of agg.topIdeas.slice(0, 5)) {
      lines.push(`- [${i.status}/поддержали ${i.supporterCount}] ${i.statement}`);
    }
  }

  return lines.join('\n');
}
