/**
 * SBA β-8.3 — промпт `operations-daily-digest`.
 *
 * Источник: plans/tz/2026-05-25-sba-beta-8-3-coo-daily-and-doelka.md §1.7.
 *
 * Задача: на вход — структурированный агрегат за вчерашний день
 * (доли green/yellow/red, новые блокеры, просроченные обещания, цели,
 * новые high-severity инсайты, решения). На выход — связный markdown
 * из 4-6 коротких разделов + `shortSummary` для Telegram и блока на главной.
 *
 * Code-fallback (без PromptRegistry) — как `operations-weekly-digest` и
 * `dashboard-summary`. Версия промпта — `prompt-v1`.
 */

import type { DailyDigestAggregates } from '../dto/daily-digest.dto';

export const DAILY_DIGEST_PROMPT_VERSION = 'prompt-v1';

export const DAILY_DIGEST_TASK_TYPE = 'operations-daily-digest';

/** Маркер для отделения основного текста от shortSummary в ответе LLM. */
const SHORT_SUMMARY_DELIMITER = '---SHORT_SUMMARY---';

/** RU-названия типов сигналов (InsightKind). Неизвестный — как есть. */
const INSIGHT_KIND_RU: Record<string, string> = {
  problem: 'проблема',
  risk: 'риск',
  blocker: 'блокер',
  inefficiency: 'неэффективность',
};
function insightKindRu(k: string): string {
  return INSIGHT_KIND_RU[k] ?? k;
}

/** RU-названия статусов решений (DecisionStatus). Неизвестный — как есть. */
const DECISION_STATUS_RU: Record<string, string> = {
  active: 'действует',
  rolled_back: 'откатано',
  superseded: 'заменено',
  proposed: 'предложено',
  approved: 'утверждено',
  rejected: 'отклонено',
  implemented: 'внедрено',
  cancelled: 'отменено',
};
function decisionStatusRu(s: string): string {
  return DECISION_STATUS_RU[s] ?? s;
}

export const DAILY_DIGEST_SYSTEM_PROMPT = [
  'Ты — аналитик операционного директора. На вход — агрегат показателей компании за прошедшие сутки.',
  'Твоя задача — собрать связный комментарий из 4-6 коротких разделов в формате Markdown:',
  '',
  '  1. Температура команды вчера + красные точки (если есть).',
  '  2. Новые блокеры за день.',
  '  3. Просроченные обещания (на кого ждём ответа).',
  '  4. Что закрыли / что упустили из целей.',
  '  5. Сигналы (новые важные инсайты).',
  '  6. Что критично взять в руки сегодня (1-2 пункта).',
  '',
  'После основного текста — отдельной секцией строка-разделитель:',
  `${SHORT_SUMMARY_DELIMITER}`,
  'а после него — `shortSummary` (3-4 коротких предложения для Telegram-рассылки и блока на главной).',
  '',
  'Жёсткие правила:',
  '  - На русском, plain markdown без HTML и без таблиц.',
  '  - Только то, что есть в данных. Не додумывай и не давай советов на пустом месте.',
  '  - Без воды и без преамбулы. Сразу к делу.',
  '  - Тон — спокойный и фактологичный (не алармизм, не оптимизм).',
  '  - Если по какому-то блоку данных нет — пропусти раздел, не пиши «нет данных» как пункт.',
  '  - Имена сотрудников не цитируй и персональные подробности из чек-инов не пересказывай (приватность).',
  '  - Длина основного текста — 200-450 слов, shortSummary — 3-4 предложения.',
].join('\n');

/**
 * Сборка user-сообщения: компактная сериализация агрегатов.
 */
export function buildDailyDigestUserMessage(agg: DailyDigestAggregates): string {
  const lines: string[] = [];
  lines.push(`Дата отчёта: ${agg.dateLocal} (вчерашние сутки в МСК).`);
  lines.push('');
  lines.push('Температура команды:');
  lines.push(
    `  всего чек-инов: ${agg.totalCheckIns}; зелёных ${pct(agg.greenShare)}, ` +
      `жёлтых ${pct(agg.yellowShare)}, красных ${pct(agg.redShare)}.`,
  );

  if (agg.topRedCheckIns.length > 0) {
    lines.push('');
    lines.push('Красные точки (топ-3 по дню):');
    for (const r of agg.topRedCheckIns.slice(0, 3)) {
      lines.push(`  - ${truncate(r.excerpt, 200)}.`);
    }
  }

  if (agg.newBlockers.length > 0) {
    lines.push('');
    lines.push('Новые блокеры за день (топ-5):');
    for (const b of agg.newBlockers.slice(0, 5)) {
      lines.push(`  - ${truncate(b.name, 200)} (уверенность ${pct(b.confidence)}).`);
    }
  }

  if (agg.overdueCommitments.length > 0) {
    lines.push('');
    lines.push('Просроченные обещания (на сегодня, топ-5):');
    for (const c of agg.overdueCommitments.slice(0, 5)) {
      const due = c.dueDate ? ` (срок ${c.dueDate})` : '';
      lines.push(`  - ${truncate(c.name, 200)}${due}.`);
    }
  }

  lines.push('');
  lines.push('Цели (изменения статуса за вчера):');
  lines.push(
    `  закрыто ${agg.goals.completed}, провалено ${agg.goals.failed}, ` +
      `вновь активированы ${agg.goals.activated}.`,
  );

  if (agg.newHighInsights.length > 0) {
    lines.push('');
    lines.push('Новые сигналы (важные, топ-5):');
    for (const i of agg.newHighInsights.slice(0, 5)) {
      const cause = i.causeCategory ? `, причина: ${i.causeCategory}` : '';
      lines.push(`  - [${insightKindRu(i.kind)}${cause}] ${truncate(i.statement, 200)}.`);
    }
  }

  if (agg.decisions.length > 0) {
    lines.push('');
    lines.push('Решения за вчера (топ-5):');
    for (const d of agg.decisions.slice(0, 5)) {
      lines.push(`  - [${decisionStatusRu(d.status)}] ${truncate(d.statement, 200)}.`);
    }
  }

  return lines.join('\n');
}

/**
 * Парсит ответ LLM на основной текст и shortSummary по разделителю
 * `---SHORT_SUMMARY---`. Если разделителя нет — bodyMarkdown = весь ответ,
 * shortSummary = первый абзац.
 */
export function parseDailyDigestLlmResponse(
  raw: string,
): { bodyMarkdown: string; shortSummary: string | null } {
  const trimmed = (raw ?? '').trim();
  const idx = trimmed.indexOf(SHORT_SUMMARY_DELIMITER);
  if (idx === -1) {
    // Fallback: берём первый абзац как shortSummary.
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

/**
 * «Сухой» вариант комментария при провале LLM. Структура остаётся,
 * связного текста нет — это маркер для UI (badge «не доставлено LLM»).
 */
export function buildFallbackDigestMarkdown(
  agg: DailyDigestAggregates,
): { bodyMarkdown: string; shortSummary: string | null } {
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

  if (agg.overdueCommitments.length > 0) {
    lines.push('');
    lines.push('## Просроченные обещания');
    for (const c of agg.overdueCommitments.slice(0, 5)) {
      const due = c.dueDate ? ` (срок ${c.dueDate})` : '';
      lines.push(`- ${c.name}${due}`);
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

  if (agg.decisions.length > 0) {
    lines.push('');
    lines.push('## Решения');
    for (const d of agg.decisions.slice(0, 5)) {
      lines.push(`- [${decisionStatusRu(d.status)}] ${d.statement}`);
    }
  }

  const shortSummary =
    `Сводка за ${agg.dateLocal}: чек-инов ${agg.totalCheckIns} ` +
    `(красных ${pct(agg.redShare)}), новых блокеров ${agg.newBlockers.length}, ` +
    `просроченных обещаний ${agg.overdueCommitments.length}, ` +
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
