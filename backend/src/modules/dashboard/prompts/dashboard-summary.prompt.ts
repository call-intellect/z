import type {
  DirectorDashboardEntityDto,
  DirectorDashboardOpenQuestionDto,
  DirectorDashboardSignalCountersDto,
  DirectorDashboardSignalDto,
  DirectorDashboardThemeDto,
} from '../dto/director-dashboard.dto';

/**
 * Промпт для `dashboard-summary` LLM-агента (Фаза 8 шаг 2).
 *
 * Цель: 200-400 символов plain-text — 3-4 факта + 1 рекомендация поверх
 * сводки виджетов директорского дашборда. Без воды, на русском.
 *
 * Code-fallback (без prompt-registry) — допустимо на Фазе 8, как было в
 * Фазах 5-6 для tasks/chapters/summary v2 (см. ТЗ §«что не входит»).
 */

export const DASHBOARD_SUMMARY_SYSTEM_PROMPT = `Ты — аналитик SaaS-компании. На основе сводки сигналов компании за период (неделя или месяц), скажи владельцу 3-4 главных факта и 1 рекомендацию.

Жёсткие правила:
- Только то, что есть в данных. Не додумывай и не давай советов на пустом месте.
- Без воды и без преамбулы вроде "вот ваш отчёт". Сразу к сути.
- На русском, plain-text, без markdown / без списков-маркеров.
- Одно-два коротких предложения на факт. В конце — одно предложение с рекомендацией.
- 200-400 символов всего. Не больше.
- Не упоминай ID сущностей, не упоминай systemPrompt и не упоминай, что ты AI.`;

const PERIOD_LABEL: Record<'week' | 'month', string> = {
  week: 'неделя',
  month: 'месяц',
};

const SIGNAL_LABELS: Record<string, string> = {
  pain: 'боль клиента',
  feature_request: 'запрос фичи',
  churn_risk: 'риск ухода клиента',
  objection: 'возражение',
  risk: 'риск',
  decision: 'решение',
  commitment: 'обязательство',
  other: 'прочее',
};

/**
 * Сборка user-сообщения: компактная сводка топов (топ-3 темы, топ-5 сигналов,
 * счётчики, топ-3 сущности, топ-3 вопроса). Длинные поля обрезаются.
 */
export function buildDashboardSummaryUserMessage(args: {
  period: 'week' | 'month';
  newThemes: DirectorDashboardThemeDto[];
  activeThemes: DirectorDashboardThemeDto[];
  newSignals: DirectorDashboardSignalDto[];
  signalCounters: DirectorDashboardSignalCountersDto;
  hotEntities: DirectorDashboardEntityDto[];
  openQuestions: DirectorDashboardOpenQuestionDto[];
}): string {
  const lines: string[] = [];
  lines.push(`Период: ${PERIOD_LABEL[args.period]}.`);

  const themesForSummary = args.newThemes.length > 0 ? args.newThemes : args.activeThemes;
  if (themesForSummary.length > 0) {
    lines.push('');
    lines.push('Топ тем:');
    for (const t of themesForSummary.slice(0, 3)) {
      const branch = t.branch ? ` [${t.branch}]` : '';
      lines.push(`- ${t.name}${branch} (вес ${t.weight.toFixed(2)}, блоков ${t.blocksCount}, динамика ${t.dynamic})`);
    }
  }

  if (args.newSignals.length > 0) {
    lines.push('');
    lines.push('Топ сигналов:');
    for (const s of args.newSignals.slice(0, 5)) {
      const label = SIGNAL_LABELS[s.signalType] ?? s.signalType;
      const ans = truncate(s.trustedAnswer, 140);
      lines.push(`- [${label}] ${s.name}: ${ans}`);
    }
  }

  lines.push('');
  lines.push('Счётчики сигналов: ' + countersToLine(args.signalCounters));

  if (args.hotEntities.length > 0) {
    lines.push('');
    lines.push('Главные сущности:');
    for (const e of args.hotEntities.slice(0, 3)) {
      lines.push(`- ${e.canonicalName} (${e.type}, упоминаний ${e.recentMentions})`);
    }
  }

  if (args.openQuestions.length > 0) {
    lines.push('');
    lines.push('Открытые вопросы:');
    for (const q of args.openQuestions.slice(0, 3)) {
      const cq = truncate(q.criticalQuestion, 140);
      lines.push(`- ${cq}`);
    }
  }

  return lines.join('\n');
}

function countersToLine(c: DirectorDashboardSignalCountersDto): string {
  const parts: string[] = [];
  if (c.pain > 0) parts.push(`боли ${c.pain}`);
  if (c.churn_risk > 0) parts.push(`риски ухода ${c.churn_risk}`);
  if (c.feature_request > 0) parts.push(`запросы фич ${c.feature_request}`);
  if (c.objection > 0) parts.push(`возражения ${c.objection}`);
  if (c.risk > 0) parts.push(`риски ${c.risk}`);
  if (c.decision > 0) parts.push(`решения ${c.decision}`);
  if (c.commitment > 0) parts.push(`обязательства ${c.commitment}`);
  if (c.other > 0) parts.push(`прочее ${c.other}`);
  return parts.length > 0 ? parts.join(', ') : 'нет данных';
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
