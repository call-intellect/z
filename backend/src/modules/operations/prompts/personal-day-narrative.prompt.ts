import type {
  PersonalDayNarrativeMetricsDto,
  PersonDayPackage,
} from '../dto/personal-day-narrative.dto';

export const PERSONAL_DAY_NARRATIVE_TASK_TYPE = 'personal-day-narrative';

export const PERSONAL_DAY_NARRATIVE_PROMPT_VERSION = 'personal-day-v1';

const PERSONAL_DAY_VERDICT_STATES = ['ok', 'warn', 'risk'] as const;

const PERSONAL_DAY_AXIS_KEYS = ['tasks', 'commitments', 'load', 'contribution'] as const;

const PERSONAL_DAY_LETTER_KEYS = [
  'intro',
  'tasks',
  'commitments',
  'load',
  'contribution',
  'actions',
] as const;

const PERSONAL_DAY_FEW_SHOT_JSON = JSON.stringify(
  {
    verdict: {
      overall: {
        state: 'warn',
        emoji: '⚠️',
        title: 'День рабочий, но два хвоста',
        oneLiner: 'Закрыл 3 задачи, но одно обещание просрочено и две задачи зависли.',
      },
      axes: [
        { key: 'tasks', state: 'warn', label: 'Задачи', why: '3 закрыто, 2 зависли без движения' },
        { key: 'commitments', state: 'risk', label: 'Обещания', why: '1 обещание просрочено на 2 дня' },
        { key: 'load', state: 'ok', label: 'Загрузка', why: '5 активных задач — норма' },
        { key: 'contribution', state: 'ok', label: 'Вклад', why: '+2 к цели на этой неделе' },
      ],
    },
    letter: [
      {
        key: 'intro',
        title: 'Коротко',
        prose: 'Ирина, коротко — день рабочий: закрыла три задачи, но осталось два хвоста, которые лучше не тянуть.',
      },
      {
        key: 'tasks',
        title: 'Задачи',
        prose:
          'Закрыла заказ материалов и два звонка. Зависли «согласовать смету» и «ответить поставщику» — по ним не было движения несколько дней.',
        cites: [{ label: 'задача', ref: 'смета #142' }],
      },
      {
        key: 'commitments',
        title: 'Обещания',
        prose: 'Ты обещала прислать отчёт Петру — срок был позавчера. Стоит закрыть первым делом.',
      },
      {
        key: 'actions',
        title: 'На завтра',
        prose: 'Сначала отчёт Петру, потом сдвинь смету — по ней ждут.',
      },
    ],
    shortSummary: 'День рабочий: 3 закрыто, но отчёт Петру просрочен — закрой первым делом.',
  },
  null,
  0,
);

export const PERSONAL_DAY_NARRATIVE_SYSTEM_PROMPT = [
  'РОЛЬ',
  'Ты — личный помощник сотрудника. В конце его рабочего дня ты пишешь ему короткое личное письмо «Твой день» — честный, тёплый разбор того, как прошёл ЕГО день: что сделал, что зависло, что обещал, чем помог компании, что мешает. Не сухая сводка, а связный человеческий рассказ с конкретикой и ссылками на источники.',
  '',
  'ВХОД',
  'Тебе дают данные ТОЛЬКО по этому сотруднику за прошедший день: его задачи (закрытые сегодня, просроченные, зависшие без движения); его план на день и вечерний факт (сделано / не сделано); его обещания (данные сегодня и просроченные); его загрузку (число активных задач, уровень); его вклад в цель компании за неделю (готовое число); его собственные высказывания/идеи из графа со ссылками; его блокеры. Числа бери КАК ЕСТЬ — не пересчитывай и не округляй.',
  '',
  'ТОН',
  '- По-русски, обращайся к сотруднику на «ты», по имени: «<Имя>, коротко — …».',
  '- Тёплый и поддерживающий, но честный и без воды: если обещание просрочено — скажи прямо, но по-человечески, без обвинений и алармизма.',
  '- Каждый значимый факт по возможности привязывай к источнику через cites: {label, ref}, где label — метка задачи/канала, ref — номер/срок. Метку и номер бери ТОЛЬКО из входных данных — не придумывай.',
  '- НИЧЕГО не выдумывай: ни фактов, ни чисел, ни имён, ни ссылок. Нет данных по секции — пропусти секцию целиком, не пиши «нет данных».',
  '',
  'СТРОГО ЗАПРЕЩЕНО',
  '- Не упоминай настроение, эмоциональное состояние, самочувствие — ни сотрудника, ни коллег.',
  '- Не упоминай конфликты, трения, напряжение между людьми, «кто с кем не сработался».',
  '- Не сравнивай сотрудника с другими людьми и не давай рейтингов «лучше/хуже коллег».',
  '- Пиши только про работу этого человека и факты его дня.',
  '',
  'СОСТАВ ПИСЬМА — до 6 секций, строго в этом порядке; пиши только те, под которые есть данные. Каждая секция — элемент массива letter с {key, title, prose, cites?}, где key из фиксированного списка, prose — связная проза (без markdown-таблиц и служебной разметки).',
  '  - intro (Коротко): «<Имя>, коротко — <итог дня в 1-2 предложения>.»',
  '  - tasks (Задачи): что закрыл сегодня + что зависло/просрочено; связной прозой, ключевое привяжи к источнику через cites. Без поштучного сухого списка.',
  '  - commitments (Обещания): твои обещания — что дал сегодня и что просрочено. Нейтрально и по делу: «дано X, просрочено Y» — без оценочного «ты нарушил».',
  '  - load (Загрузка): 1-2 предложения про объём работы — сколько активных задач, перегруз/норма. Только если есть сигнал (перегруз или простой).',
  '  - contribution (Вклад): чем твоя работа за неделю двигает цель компании — готовое число вклада, коротко и по-доброму.',
  '  - actions (На завтра): 1-3 конкретных действия на завтра, каждое с короткой причиной-почему, приоритет по срочности.',
  '',
  'ВЕРДИКТ (verdict) — обложка дня: overall с {state ∈ ok|warn|risk, emoji (🟢/⚠️/🔴 или близкий), title (короткий заголовок дня), oneLiner (одно предложение-резюме для push)} и axes — ровно 4 оси в порядке tasks, commitments, load, contribution, у каждой {key, state ∈ ok|warn|risk, label по-русски, why (1 фраза на данных)}. tasks — закрытые/зависшие/просроченные задачи. commitments — обещания и их просрочка. load — загрузка (перегруз/норма/простой). contribution — вклад в цель за неделю.',
  '',
  'ФОРМАТ ВЫХОДА — строго JSON по схеме PersonalDay: объект с полями verdict, letter (массив секций, каждая {key, title, prose, cites?}, key ∈ intro|tasks|commitments|load|contribution|actions), shortSummary (одно предложение для push). Без markdown-обёртки, без преамбулы, без текста вне JSON.',
  '',
  'ПРИМЕР валидного ответа (данные выдуманы — копируй ТОЛЬКО структуру и стиль, не факты):',
  PERSONAL_DAY_FEW_SHOT_JSON,
].join('\n');

export const PERSONAL_DAY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'letter', 'shortSummary'],
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
            state: { type: 'string', enum: [...PERSONAL_DAY_VERDICT_STATES] },
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
              key: { type: 'string', enum: [...PERSONAL_DAY_AXIS_KEYS] },
              state: { type: 'string', enum: [...PERSONAL_DAY_VERDICT_STATES] },
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
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'title', 'prose'],
        properties: {
          key: { type: 'string', enum: [...PERSONAL_DAY_LETTER_KEYS] },
          title: { type: 'string', minLength: 1, maxLength: 120 },
          prose: { type: 'string', minLength: 1, maxLength: 2000 },
          cites: {
            type: 'array',
            maxItems: 8,
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
    shortSummary: { type: 'string', minLength: 1, maxLength: 400 },
  },
};

function taskLines(label: string, tasks: PersonDayPackage['tasksDoneToday']): string[] {
  if (tasks.length === 0) return [];
  const lines = [label];
  for (const t of tasks) {
    lines.push(`  - ${t.title}${t.hint ? ` (${t.hint})` : ''} [id:${t.id}]`);
  }
  return lines;
}

export function buildPersonDayUserMessage(pkg: PersonDayPackage): string {
  const lines: string[] = [];
  lines.push(`ДАННЫЕ ЗА ДЕНЬ ${pkg.dateLocal}`);
  lines.push(`Сотрудник: ${pkg.personName ?? '—'}`);
  lines.push('');

  if (pkg.meetings.length > 0) {
    lines.push('ВСТРЕЧИ ДНЯ (AI-резюме, для cites):');
    for (const m of pkg.meetings) {
      lines.push(`  - [${m.title} · ${m.ref}] ${m.summary}`);
    }
    lines.push('');
  }

  lines.push(...taskLines('ЗАКРЫТО СЕГОДНЯ:', pkg.tasksDoneToday));
  lines.push(...taskLines('ПРОСРОЧЕНО:', pkg.tasksOverdue));
  lines.push(...taskLines('ЗАВИСЛО БЕЗ ДВИЖЕНИЯ:', pkg.tasksStuck));

  if (pkg.planText) {
    lines.push('', `ПЛАН НА ДЕНЬ (утро): ${pkg.planText}`);
  }
  if (pkg.factText) {
    lines.push(`ФАКТ (вечер): ${pkg.factText}`);
  }
  if (pkg.notDone.length > 0) {
    lines.push(`НЕ СДЕЛАНО (из отчёта): ${pkg.notDone.join('; ')}`);
  }

  if (pkg.commitmentsGiven.length > 0) {
    lines.push('', 'ОБЕЩАНИЯ ДАНЫ СЕГОДНЯ:');
    for (const c of pkg.commitmentsGiven) {
      lines.push(
        `  - ${c.text}${c.counterpartName ? ` (кому: ${c.counterpartName})` : ''}${c.dueLabel ? ` — срок ${c.dueLabel}` : ''} [id:${c.id}]`,
      );
    }
  }
  if (pkg.commitmentsOverdue.length > 0) {
    lines.push('', 'ОБЕЩАНИЯ ПРОСРОЧЕНЫ:');
    for (const c of pkg.commitmentsOverdue) {
      lines.push(`  - ${c.text}${c.dueLabel ? ` — срок был ${c.dueLabel}` : ''} [id:${c.id}]`);
    }
  }

  lines.push('', `ЗАГРУЗКА: активных задач ${pkg.activeTasks}${pkg.loadLevel ? `, уровень ${pkg.loadLevel}` : ''}`);

  if (pkg.goalNetScore !== null) {
    lines.push(
      `ВКЛАД В ЦЕЛЬ ЗА НЕДЕЛЮ: ${pkg.goalNetScore}${pkg.goalName ? ` (цель: ${pkg.goalName})` : ''}${pkg.weekStart ? ` с ${pkg.weekStart}` : ''}`,
    );
  }

  if (pkg.blockers.length > 0) {
    lines.push('', 'БЛОКЕРЫ:');
    for (const b of pkg.blockers) lines.push(`  - ${b.text} [id:${b.id}]`);
  }

  if (pkg.voice.length > 0) {
    lines.push('', 'ТВОИ ВЫСКАЗЫВАНИЯ/ИДЕИ ИЗ ГРАФА (для cites):');
    for (const v of pkg.voice) lines.push(`  - [${v.label} · ${v.ref}] ${v.excerpt}`);
  }

  return lines.join('\n');
}

export function buildPersonDayFallbackMarkdown(pkg: PersonDayPackage): {
  bodyMarkdown: string;
  shortSummary: string | null;
} {
  const lines: string[] = [];
  lines.push(`# Твой день — ${pkg.dateLocal}`);
  lines.push('');
  lines.push(
    `Закрыто сегодня: ${pkg.tasksDoneToday.length}. Просрочено: ${pkg.tasksOverdue.length}. Зависло: ${pkg.tasksStuck.length}.`,
  );
  if (pkg.commitmentsOverdue.length > 0) {
    lines.push(`Просроченных обещаний: ${pkg.commitmentsOverdue.length}.`);
  }
  lines.push(`Активных задач: ${pkg.activeTasks}.`);
  if (pkg.goalNetScore !== null) {
    lines.push(`Вклад в цель за неделю: ${pkg.goalNetScore}.`);
  }
  const short =
    pkg.tasksOverdue.length + pkg.commitmentsOverdue.length > 0
      ? `Закрыто ${pkg.tasksDoneToday.length}, есть просрочки — загляни в задачи.`
      : `Закрыто ${pkg.tasksDoneToday.length} задач за день.`;
  return { bodyMarkdown: lines.join('\n'), shortSummary: short };
}

export function computePersonalDayMetrics(pkg: PersonDayPackage): PersonalDayNarrativeMetricsDto {
  return {
    tasksDone: pkg.tasksDoneToday.length,
    tasksNotDone: pkg.notDone.length,
    tasksOverdue: pkg.tasksOverdue.length,
    tasksStuck: pkg.tasksStuck.length,
    commitmentsGiven: pkg.commitmentsGiven.length,
    commitmentsOverdue: pkg.commitmentsOverdue.length,
    activeTasks: pkg.activeTasks,
    loadLevel: pkg.loadLevel,
    goalNetScore: pkg.goalNetScore,
    weekStart: pkg.weekStart,
  };
}
