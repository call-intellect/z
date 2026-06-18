export const GOALS_PULSE_PROMPT_VERSION = 'prompt-v1';

export const GOALS_PULSE_TASK_TYPE = 'goals-pulse-summarize';

const SHORT_SUMMARY_DELIMITER = '---SHORT_SUMMARY---';

export interface GoalsPulseCounters {
  achieved: number;
  on_track: number;
  at_risk: number;
  stalled: number;
  dropped: number;
  total: number;
  newThisWeek: number;
}

export interface GoalsPulseGoalLine {
  name: string;
  progressStatus: 'on_track' | 'at_risk' | 'stalled' | 'achieved' | 'dropped';
  avgKrProgress: number | null;
  isNew: boolean;
}

export interface GoalsPulseAggregate {
  isoWeek: string;
  weekStart: string;
  weekEnd: string;
  counters: GoalsPulseCounters;
  goals: GoalsPulseGoalLine[];
}

export const GOALS_PULSE_SYSTEM_PROMPT = [
  'Ты — аналитик целей компании. На вход — статистика прогресса целей за прошедшую неделю.',
  'Твоя задача — собрать связный «пульс целей» из 4-6 коротких разделов в формате Markdown:',
  '',
  '  1. Обзор (сколько целей достигнуто / в движении / под риском / застряло / выпало).',
  '  2. Что движется (цели on_track и achieved — куда идём уверенно).',
  '  3. Что требует внимания (цели at_risk и stalled — где буксуем).',
  '  4. Новые цели недели (если появились).',
  '  5. Рекомендация (1-2 предложения — на что направить фокус на следующей неделе).',
  '',
  'После основного текста — отдельной секцией строка-разделитель:',
  `${SHORT_SUMMARY_DELIMITER}`,
  'а после него — `shortSummary` (2-3 коротких предложения для Telegram-рассылки и блока на главной).',
  '',
  'Жёсткие правила:',
  '  - На русском, plain markdown без HTML и без таблиц.',
  '  - Только то, что есть в данных. Не додумывай и не давай советов на пустом месте.',
  '  - Без воды и без преамбулы. Сразу к делу.',
  '  - Тон — спокойный и фактологичный (не алармизм, не оптимизм).',
  '  - Если по какому-то блоку данных нет — пропусти раздел, не пиши «нет данных» как пункт.',
  '  - Не называй людей по именам и не цитируй персональные подробности (приватность).',
  '  - Длина основного текста — 250-500 слов.',
].join('\n');

function statusLabel(s: GoalsPulseGoalLine['progressStatus']): string {
  switch (s) {
    case 'achieved':
      return 'достигнута';
    case 'on_track':
      return 'в движении';
    case 'at_risk':
      return 'под риском';
    case 'stalled':
      return 'застряла';
    case 'dropped':
      return 'выпала';
    default:
      return s;
  }
}

export function buildGoalsPulseUserMessage(agg: GoalsPulseAggregate): string {
  const c = agg.counters;
  const lines: string[] = [];
  lines.push(`Неделя: ${agg.isoWeek} (${agg.weekStart} — ${agg.weekEnd}), МСК.`);
  lines.push('');
  lines.push('Сводка по статусам движения целей:');
  lines.push(
    `  всего активных целей: ${c.total}; достигнуто ${c.achieved}, ` +
      `в движении ${c.on_track}, под риском ${c.at_risk}, ` +
      `застряло ${c.stalled}, выпало ${c.dropped}.`,
  );
  lines.push(`  новых целей за неделю: ${c.newThisWeek}.`);

  if (agg.goals.length > 0) {
    lines.push('');
    lines.push('Цели (статус движения, средний прогресс ключевых результатов):');
    for (const g of agg.goals.slice(0, 30)) {
      const prog =
        g.avgKrProgress === null
          ? 'без числовых результатов'
          : `прогресс ${Math.round(g.avgKrProgress)}%`;
      const isNew = g.isNew ? ', новая' : '';
      lines.push(
        `  - ${truncate(g.name, 200)} — ${statusLabel(g.progressStatus)}, ${prog}${isNew}.`,
      );
    }
  }

  return lines.join('\n');
}

export function parseGoalsPulseLlmResponse(raw: string): {
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

export function buildGoalsPulseFallbackMarkdown(agg: GoalsPulseAggregate): {
  bodyMarkdown: string;
  shortSummary: string | null;
} {
  const c = agg.counters;
  const lines: string[] = [];
  lines.push(`# Пульс целей за неделю ${agg.isoWeek}`);
  lines.push('');
  lines.push('## Обзор');
  lines.push(
    `Всего активных целей: ${c.total}. Достигнуто ${c.achieved}, ` +
      `в движении ${c.on_track}, под риском ${c.at_risk}, ` +
      `застряло ${c.stalled}, выпало ${c.dropped}.`,
  );

  const attention = agg.goals.filter(
    (g) => g.progressStatus === 'at_risk' || g.progressStatus === 'stalled',
  );
  if (attention.length > 0) {
    lines.push('');
    lines.push('## Требует внимания');
    for (const g of attention.slice(0, 10)) {
      lines.push(`- ${g.name} (${statusLabel(g.progressStatus)})`);
    }
  }

  const fresh = agg.goals.filter((g) => g.isNew);
  if (fresh.length > 0) {
    lines.push('');
    lines.push('## Новые цели недели');
    for (const g of fresh.slice(0, 10)) {
      lines.push(`- ${g.name}`);
    }
  }

  const shortSummary =
    `Пульс целей ${agg.isoWeek}: всего ${c.total} ` +
    `(достигнуто ${c.achieved}, под риском ${c.at_risk}, застряло ${c.stalled}), ` +
    `новых ${c.newThisWeek}. Связный комментарий не сгенерирован — LLM недоступна.`;

  return { bodyMarkdown: lines.join('\n'), shortSummary };
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
