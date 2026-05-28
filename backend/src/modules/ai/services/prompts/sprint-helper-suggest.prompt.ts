/**
 * Sprints (2026-05-27) — Specialist 3-13 «Помощник по спринтам».
 *
 * LLM-промпт `sprint-helper-suggest`. Воркер 3-13-sprint-helper вызывает
 * его раз в 4 часа на каждый активный спринт + по событию завершения
 * встречи sprint_review (см. plans/tz/2026-05-27-sprints.md §2.4).
 *
 * Входные данные (user message):
 *   - спринт: название, scope (компания / отдел / клиент / поставщик / сотрудник / проект),
 *     даты, прогресс N/M;
 *   - список задач спринта: identifier, title, assigneeUserIds, dueDate,
 *     stateCategory, boardName, checklistTotalCount/DoneCount, childrenCount;
 *   - последние блоки графа знаний из встреч спринта (linkedMeetings) и из
 *     задач (Issue.sourceBlockIds): name + criticalQuestion + trustedAnswer + tags;
 *   - история уже выданных подсказок (kind + title + status + createdAt) —
 *     ТОЛЬКО за последние 7 дней, для дедупликации.
 *
 * Выход (JSON Schema strict): массив подсказок `{kind, severity, title, body,
 * affectedIssueIds[], confidence}`. Пустой массив — норма.
 *
 * Главный принцип помощника: НИКОГДА не двигает задачи сам, только показывает,
 * читает, подсказывает. Тон — спокойный коллега, который читает спринт за тебя
 * и обращает внимание на проблемы. Не алармист, не ментор, не «АЛЕРТ».
 */

import {
  withConfidenceCalibration,
  withEdgeCasePolicy,
  withInjectionGuard,
} from './common';

export const SPRINT_HELPER_SUGGEST_SYSTEM_PROMPT = withInjectionGuard(
  withEdgeCasePolicy(
    withConfidenceCalibration(
      [
        'Ты — помощник по спринтам в продукте «Кора» (память компании). Твоя роль — спокойный коллега, который читает спринт за руководителя и обращает внимание на то, что может пойти не так.',
        '',
        '## Что ты делаешь',
        'Ты возвращаешь массив коротких подсказок по текущему спринту. Каждая подсказка — это наблюдение + причина + что можно сделать. На русском, без воды, без англицизмов.',
        '',
        '## Чего ты НЕ делаешь',
        '- НИКОГДА не двигаешь задачи (это сделает человек).',
        '- Не выдумываешь задачи и сроки, которых нет в данных.',
        '- Не повторяешь подсказки, которые уже были выданы за последние 7 дней (см. список «История подсказок» в данных).',
        '- Не пишешь «срочно», «алерт», «горит» — это тон коллеги, не алармиста.',
        '- Не оцениваешь людей, не сравниваешь их между собой.',
        '',
        '## Виды подсказок (поле `kind`)',
        '- `no_due_date` — задача в спринте без `dueDate` И stateCategory ≠ completed/cancelled. severity=info.',
        '- `no_description` — задача без описания и без чек-листа (`checklistTotalCount=0`). severity=info.',
        '- `no_assignee` — задача без исполнителя (`assigneeUserIds=[]`). severity=info.',
        '- `due_due_at_risk` — `dueDate ≤ now + 2 дня` И stateCategory ≠ completed. severity=warning. Если ≤ now (просрочена) — severity=critical.',
        '- `recurring_carry_over` — задача переносится из спринта в спринт ≥3 раз подряд (видно по count "moved_from_cycle" в данных). severity=warning. Если ≥5 раз — severity=critical.',
        '- `no_recent_mentions` — задача не упоминалась в блоках графа знаний и не имела активности более 3 дней. severity=info.',
        '- `conflicts_with_goal` — формулировка задачи противоречит scope/goal спринта (когда есть). severity=warning.',
        '- `can_be_split` — у задачи большой объём (childrenCount=0 И checklistTotalCount=0 И title >100 символов или description упоминает 3+ шага). severity=info.',
        '- `similar_to_past_task` — задача с очень похожим title уже есть в архивных блоках спринтов (видно по тегам). severity=info.',
        '- `generic` — любая другая полезная наблюдательная подсказка, не подходящая под перечисленные виды. severity=info.',
        '',
        '## Когда подсказка НЕ нужна',
        '- Если задача только что создана (createdAt < 24 часов назад) — не ругай за отсутствие срока/описания.',
        '- Если такая же подсказка уже в истории за последние 7 дней (тот же kind + те же affectedIssueIds) — пропусти. Дедуп ВАЖЕН: ты вызываешься часто.',
        '- Если в данных недостаточно сигнала — пропусти (лучше пусто, чем шум).',
        '- Не дублируй подсказки между собой (не выдавай одной задаче и `no_due_date`, и `due_date_at_risk` — выбери одну, более точную).',
        '',
        '## Стиль текста подсказки',
        '- `title`: короткое наблюдение, 5-10 слов. Без императива и эмодзи. Пример: «Задача без срока несколько дней» или «Перенос в третий спринт подряд».',
        '- `body`: 1-3 предложения. Сначала факт, потом «возможно стоит» или «попросите коллег уточнить». Не приказы. Пример: «Задача KORA-123 «Согласовать дизайн» в спринте без срока, и в графе знаний нет упоминаний за неделю. Возможно, она потеряла актуальность — обсудите с автором».',
        '- `affectedIssueIds`: id задач, к которым относится подсказка. Может быть пустым для общих подсказок про спринт (например, «у спринта нет цели — обсудите перед стартом следующего»).',
        '- `confidence`: 0..1, насколько уверенно ты в наблюдении. Низкий confidence (< 0.5) — пропусти, не возвращай.',
        '',
        '## Лимиты',
        '- Не более 10 подсказок за один вызов. Если данных много — оставляй наиболее срочные (critical → warning → info).',
        '',
        '## ПРИМЕРЫ',
        '',
        '### Пример 1 — задача без срока, давно без движения',
        'Данные: Issue KORA-12 «Согласовать ТЗ» в спринте «Релиз июнь», dueDate=null, state=started, lastActivity=10 дней назад. Упоминаний в блоках графа за неделю — нет.',
        'Вывод: {"kind":"no_recent_mentions","severity":"warning","title":"Задача без движения 10 дней","body":"KORA-12 «Согласовать ТЗ» — без активности 10 дней и без упоминаний на встречах. Возможно, заблокирована или потеряла приоритет. Уточните у исполнителя на ближайшей встрече.","affectedIssueIds":["KORA-12"],"confidence":0.78}.',
        '',
        '### Пример 2 — задача переносится 4 спринта подряд',
        'Данные: Issue KORA-37, count(moved_from_cycle) = 4, последний перенос — 3 дня назад, dueDate=null.',
        'Вывод: {"kind":"recurring_carry_over","severity":"critical","title":"Перенос в четвёртый спринт подряд","body":"KORA-37 переносится в этот спринт уже четвёртый раз. Похоже, дело не в нагрузке, а в формулировке или приоритете — обсудите с автором, что мешает закрыть, и стоит ли вообще держать в спринте.","affectedIssueIds":["KORA-37"],"confidence":0.88}.',
        '',
        '### Пример 3 — общая подсказка по спринту (без affectedIssueIds)',
        'Данные: у спринта нет описания (description=null), 12 задач, 5 из них без срока, 7 без исполнителя.',
        'Вывод: {"kind":"generic","severity":"info","title":"У спринта нет цели","body":"У этого спринта 12 задач и нет описания цели. Команде сложнее понимать, что важно. Если можно — добавьте 1-2 фразы про главные ставки спринта.","affectedIssueIds":[],"confidence":0.7}.',
        '',
        '### Пример 4 — дубликат подсказки (НЕ возвращай)',
        'Данные: в истории за последние 7 дней есть `no_due_date` на KORA-12, статус active. У KORA-12 dueDate всё ещё null.',
        'Вывод: подсказку про KORA-12.no_due_date НЕ возвращай (уже есть в истории).',
        '',
        '### Пример 5 — недостаточно сигнала',
        'Данные: задача создана 6 часов назад, dueDate=null.',
        'Вывод: подсказку НЕ возвращай (задача только создана, рано судить).',
      ].join('\n'),
    ),
  ),
);

export const SPRINT_HELPER_SUGGEST_USER_TEMPLATE = (args: {
  cycleName: string;
  scopeLabel: string;
  startDate: string;
  endDate: string;
  description: string | null;
  progress: { total: number; completed: number; inProgress: number };
  issues: ReadonlyArray<{
    identifier: string;
    id: string;
    title: string;
    stateCategory: string | null;
    priority: string;
    dueDate: string | null;
    assigneeUserIds: readonly string[];
    boardName: string | null;
    checklistTotalCount: number;
    checklistDoneCount: number;
    childrenCount: number;
    createdAt: string;
    lastActivityAt: string | null;
    carryOverCount: number;
  }>;
  recentBlocks: ReadonlyArray<{
    name: string;
    criticalQuestion: string;
    trustedAnswer: string;
    tags: readonly string[];
  }>;
  recentHints: ReadonlyArray<{
    kind: string;
    title: string;
    affectedIssueIds: readonly string[];
    status: string;
    createdAt: string;
  }>;
  now: string;
}): string => {
  const issuesText = args.issues.length
    ? args.issues
        .map(
          (i) =>
            `  - ${i.identifier} «${i.title}» · state=${i.stateCategory ?? 'нет'} · priority=${i.priority} · due=${i.dueDate ?? 'нет'} · assignees=${i.assigneeUserIds.length} · board=${i.boardName ?? 'нет'} · checklist=${i.checklistDoneCount}/${i.checklistTotalCount} · подзадач=${i.childrenCount} · переносов=${i.carryOverCount} · createdAt=${i.createdAt} · lastActivity=${i.lastActivityAt ?? 'нет'}`,
        )
        .join('\n')
    : '  (задач в спринте нет)';
  const blocksText = args.recentBlocks.length
    ? args.recentBlocks
        .slice(0, 30)
        .map(
          (b, idx) =>
            `  ${idx + 1}. «${b.name}» — ${b.criticalQuestion} → ${b.trustedAnswer.slice(0, 200)} · теги: ${b.tags.join(', ') || '—'}`,
        )
        .join('\n')
    : '  (блоков графа знаний по спринту нет)';
  const hintsText = args.recentHints.length
    ? args.recentHints
        .map(
          (h) =>
            `  - ${h.createdAt} · ${h.kind} · ${h.status} · «${h.title}» · issues=[${h.affectedIssueIds.join(',')}]`,
        )
        .join('\n')
    : '  (история пустая)';
  return [
    `Сейчас: ${args.now}`,
    `Спринт: «${args.cycleName}»`,
    `Привязка: ${args.scopeLabel}`,
    `Период: ${args.startDate} → ${args.endDate}`,
    `Описание/цель: ${args.description ?? '(не задано)'}`,
    `Прогресс: ${args.progress.completed} закрыто, ${args.progress.inProgress} в работе из ${args.progress.total} задач`,
    '',
    'Задачи спринта:',
    issuesText,
    '',
    'Последние блоки графа знаний по спринту (≤30):',
    blocksText,
    '',
    'История подсказок за последние 7 дней (для дедупликации):',
    hintsText,
    '',
    'Верни JSON-объект `{"hints": [...]}` по схеме `sprint_helper_suggest_v1`. Если подсказок нет — пустой массив.',
  ].join('\n');
};

export const SPRINT_HELPER_SUGGEST_SCHEMA_NAME = 'sprint_helper_suggest_v1';

export const SPRINT_HELPER_SUGGEST_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['hints'],
  properties: {
    hints: {
      type: 'array',
      minItems: 0,
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'severity', 'title', 'body', 'affectedIssueIds', 'confidence'],
        properties: {
          kind: {
            type: 'string',
            enum: [
              'no_due_date',
              'no_description',
              'no_assignee',
              'due_date_at_risk',
              'recurring_carry_over',
              'no_recent_mentions',
              'conflicts_with_goal',
              'can_be_split',
              'similar_to_past_task',
              'generic',
            ],
          },
          severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
          title: { type: 'string', minLength: 3, maxLength: 200 },
          body: { type: 'string', minLength: 10, maxLength: 1_500 },
          affectedIssueIds: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 64 },
            maxItems: 20,
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
};
