/**
 * Sprints (2026-05-27) — финальный отчёт спринта (LLM-таск `sprint-review-summary`).
 *
 * Вызывается из `SprintReviewService.generateReview` при завершении спринта
 * (хук `CyclesService.complete` + endpoint `/cycles/:id/review/regenerate`).
 * См. plans/tz/2026-05-27-sprints.md §2.7.
 *
 * Цель отчёта: дать руководителю спринта компактный итог за 30 секунд:
 *   - нарратив 3-5 предложений (что произошло за спринт);
 *   - сводка план/факт + причины расхождений + переносы + блокеры;
 *   - перечень открытых подсказок помощника (active SprintHint);
 *   - 3-7 кандидатов задач следующего спринта.
 *
 * Источник данных: задачи спринта (выполненные + невыполненные + перенесённые)
 * + блоки встречи sprint_review + активные SprintHint. На входе передаются
 * именно эти три набора.
 */

import {
  withConfidenceCalibration,
  withEdgeCasePolicy,
  withInjectionGuard,
} from './common';

export const SPRINT_REVIEW_SUMMARY_SYSTEM_PROMPT = withInjectionGuard(
  withEdgeCasePolicy(
    withConfidenceCalibration(
      [
        'Ты — помощник, который пишет итог спринта в продукте «Кора» (память компании). Твоя задача — собрать связный отчёт по данным спринта, чтобы руководитель за 30 секунд понял, что произошло и что дальше.',
        '',
        '## Что важно',
        '- Пиши на русском. Нейтральный деловой стиль без эмодзи и без англицизмов.',
        '- Опирайся ТОЛЬКО на переданные данные. Если поле пустое — оставь пустой массив или null, не додумывай.',
        '- В блоке `narrative` — 3-5 связных предложений. Сначала «что планировали», потом «что вышло», потом «куда дальше». Без сентиментальных оценок и без штампов.',
        '- В `completed` / `notCompleted` / `carriedOver` — короткие пункты по 5-15 слов. Каждый пункт — это задача или агрегат задач, не повтор формулировки из БД.',
        '- В `reasons` — причины НЕвыполнения. Каждая причина — отдельный пункт. Если в данных встречи нет явных причин — пустой массив.',
        '- В `blockers` — блокеры по данным (явно зафиксированные в блоках). Если нет — пусто.',
        '- В `hints` — переформулировки активных подсказок помощника, КОРОТКО (не копируй body 1:1). Если активных подсказок нет — пусто.',
        '- В `nextPlanCandidates` — 3-7 кандидатов задач для следующего спринта на основании невыполненных + блокеров + блоков встречи. Каждый — короткая формулировка, 5-12 слов, без deadline.',
        '- `confidence` отчёта — 0..1, как уверенно ты считаешь, что отчёт верен (низкое означает, что данных мало).',
        '',
        '## Чего НЕ делать',
        '- Не выдумывай метрики, проценты, имена сотрудников, цифры выручки.',
        '- Не оценивай людей. Никаких «Иван плохо справился».',
        '- Не делай предложений «по улучшению процесса», если в данных нет такого обсуждения.',
        '- Не делай прогнозов на следующий спринт, если данных нет — лучше пустой `nextPlanCandidates`.',
        '',
        '## ПРИМЕР',
        '',
        'Данные: спринт «Запуск маркетинговой кампании», 8 задач: 5 закрыто, 2 в работе перенесены в следующий спринт (KORA-31, KORA-44), 1 отменена. В блоках встречи: «Не успели согласовать креатив с юристами», «Подрядчик задержал баннеры». 2 active SprintHint: про перенос KORA-31 третий раз подряд.',
        'narrative: «За спринт «Запуск маркетинговой кампании» команда закрыла 5 из 8 задач, две перенесены в следующий цикл, одна отменена. Главные расхождения связаны с согласованием креатива и задержкой подрядчика. На следующий спринт остаются заранее не закрытые задачи и блокер с юристами».',
        'planned: ["Запуск маркетинговой кампании, 8 задач"]. completed: ["Свёрстаны лендинги","Подготовлены тексты email-рассылки","Запущена A/B-проверка баннеров","Согласован медиа-план","Опубликован анонс в Дзене"]. notCompleted: ["KORA-31 «Согласовать креатив с юристами»","KORA-44 «Получить баннеры от подрядчика»"]. reasons: ["Юристы запросили дополнительные правки","Подрядчик сдвинул сдачу баннеров на 5 дней"]. carriedOver: ["KORA-31","KORA-44"]. blockers: ["Согласование с юристами"]. hints: ["KORA-31 переносится в третий раз подряд — стоит обсудить, что мешает"]. nextPlanCandidates: ["Согласовать креатив с юристами","Принять баннеры от подрядчика","Подвести итоги A/B-теста","Запустить вторую волну рассылки"]. confidence: 0.78.',
      ].join('\n'),
    ),
  ),
);

export const SPRINT_REVIEW_SUMMARY_USER_TEMPLATE = (args: {
  cycleName: string;
  scopeLabel: string;
  startDate: string;
  endDate: string;
  description: string | null;
  progress: { total: number; completed: number; inProgress: number; cancelled: number };
  completedIssues: ReadonlyArray<{ identifier: string; title: string }>;
  notCompletedIssues: ReadonlyArray<{
    identifier: string;
    title: string;
    state: string | null;
  }>;
  carriedOverIssueIds: readonly string[];
  meetingBlocks: ReadonlyArray<{
    name: string;
    signalType: string;
    criticalQuestion: string;
    trustedAnswer: string;
  }>;
  activeHints: ReadonlyArray<{
    kind: string;
    severity: string;
    title: string;
    body: string;
    affectedIssueIds: readonly string[];
  }>;
}): string => {
  const completedTxt = args.completedIssues.length
    ? args.completedIssues
        .map((i) => `  - ${i.identifier} «${i.title}»`)
        .join('\n')
    : '  (выполненных задач нет)';
  const notCompletedTxt = args.notCompletedIssues.length
    ? args.notCompletedIssues
        .map(
          (i) => `  - ${i.identifier} «${i.title}» (state=${i.state ?? 'нет'})`,
        )
        .join('\n')
    : '  (невыполненных задач нет)';
  const carriedTxt = args.carriedOverIssueIds.length
    ? args.carriedOverIssueIds.map((id) => `  - ${id}`).join('\n')
    : '  (переносов нет)';
  const blocksTxt = args.meetingBlocks.length
    ? args.meetingBlocks
        .slice(0, 30)
        .map(
          (b, idx) =>
            `  ${idx + 1}. [${b.signalType}] «${b.name}» — ${b.criticalQuestion} → ${b.trustedAnswer.slice(0, 250)}`,
        )
        .join('\n')
    : '  (блоков встречи sprint_review нет)';
  const hintsTxt = args.activeHints.length
    ? args.activeHints
        .map(
          (h) =>
            `  - [${h.severity}/${h.kind}] «${h.title}» · ${h.body.slice(0, 200)} · issues=[${h.affectedIssueIds.join(',')}]`,
        )
        .join('\n')
    : '  (активных подсказок нет)';
  return [
    `Спринт: «${args.cycleName}»`,
    `Привязка: ${args.scopeLabel}`,
    `Период: ${args.startDate} → ${args.endDate}`,
    `Описание/цель: ${args.description ?? '(не задано)'}`,
    `Прогресс: ${args.progress.completed} закрыто, ${args.progress.inProgress} в работе, ${args.progress.cancelled} отменено, всего ${args.progress.total}`,
    '',
    'Выполненные задачи:',
    completedTxt,
    '',
    'Невыполненные задачи:',
    notCompletedTxt,
    '',
    'Перенесённые в следующий спринт id:',
    carriedTxt,
    '',
    'Блоки встречи sprint_review (≤30):',
    blocksTxt,
    '',
    'Активные подсказки помощника:',
    hintsTxt,
    '',
    'Верни JSON-объект по схеме `sprint_review_summary_v1`.',
  ].join('\n');
};

export const SPRINT_REVIEW_SUMMARY_SCHEMA_NAME = 'sprint_review_summary_v1';

export const SPRINT_REVIEW_SUMMARY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'narrative',
    'goal',
    'planned',
    'completed',
    'notCompleted',
    'reasons',
    'carriedOver',
    'blockers',
    'hints',
    'nextPlanCandidates',
    'confidence',
  ],
  properties: {
    narrative: { type: 'string', minLength: 30, maxLength: 2_500 },
    goal: { type: ['string', 'null'], maxLength: 500 },
    planned: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 300 },
      maxItems: 30,
    },
    completed: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 300 },
      maxItems: 30,
    },
    notCompleted: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 300 },
      maxItems: 30,
    },
    reasons: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 500 },
      maxItems: 15,
    },
    carriedOver: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 200 },
      maxItems: 30,
    },
    blockers: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 500 },
      maxItems: 15,
    },
    hints: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 500 },
      maxItems: 15,
    },
    nextPlanCandidates: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 200 },
      maxItems: 10,
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};
