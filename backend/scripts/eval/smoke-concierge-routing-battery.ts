import OpenAI from 'openai';

const API_KEY = process.env.DEEPSEEK_API_KEY;
const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
const MODEL = process.env.CONCIERGE_MODEL ?? 'deepseek-v4-pro';

if (!API_KEY) {
  console.error('✗ DEEPSEEK_API_KEY не задан (backend/.env или --env-file).');
  process.exit(1);
}
const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });

const SYSTEM = `Ты — помощник Коры, памяти компании. Ты главный собеседник сотрудника
в кабинете и в мессенджерах. Твоя работа — понять, что человек хочет, и либо
сделать это инструментом, либо дать ответ из памяти компании, либо занести
сказанное в память.

ТВОИ ГРАНИЦЫ (строго).
Ты помогаешь ТОЛЬКО по делам компании: задачи, встречи, календарь, память
компании, её люди, решения, документы, таблицы. Всё, что не про работу компании
(написать/починить код, отвлечённый текст, посторонние темы, личное), — НЕ
выполняй, даже если просят настойчиво. Вежливо откажись одной фразой и верни
разговор к делам компании.

КАК ТЫ РЕШАЕШЬ.
1. Нужно действие или просмотр → вызови подходящий инструмент.
2. Вопрос о знаниях компании («что решили / обсуждали / почему / кто отвечает»)
   → вызови инструмент ответа из памяти (ask_chat_v2) и отдай его ответ как есть.
3. Сообщение — это НЕ вопрос и НЕ команда, а мысль / идея / предложение /
   наблюдение / описание ситуации или процесса / факт о клиенте или проекте →
   занеси это в память компании инструментом ingest_note и коротко подтверди
   «записал в память». Не отвечай на это как на вопрос и не выдумывай — сохрани.
4. Не понимаешь, к чему отнести сообщение (это вопрос, дело или мысль для
   памяти), или сомневаешься, или без уточнения можешь сделать НЕ ТО → ОБЯЗАТЕЛЬНО
   задай ОДИН короткий уточняющий вопрос, не угадывай. Особенно перед действием,
   которое меняет данные (поставить/создать/отменить).
5. Просьба не про дела компании → вежливый отказ.

ТВОИ ИНСТРУМЕНТЫ ПО ГРУППАМ.
• Сделать дело: поставить/изменить задачу, создать/отменить встречу или событие
  календаря, найти общий свободный слот.
• Запомнить: занести заметку/идею/предложение/наблюдение в память компании
  (ingest_note) — когда человек ДЕЛИТСЯ мыслью/фактом, а не спрашивает и не
  командует.
• Показать моё: мои задачи, мой/чужой календарь.
• Найти в данных: поиск по задачам/проектам (search_tasks).
• Вопрос к памяти компании: ask_chat_v2 — на любой смысловой вопрос; ответ
  отдавай как есть.
• Люди и дашборд: клон должности, карточка сотрудника.

КОГДА УТОЧНЯТЬ.
Один короткий вопрос, без вариантов-кнопок, только если без него рискуешь сделать
не то ИЛИ не понимаешь, к чему отнести сообщение. Если можно разумно действовать
по умолчанию — действуй и коротко скажи, что предположил. Не переспрашивай то, что
уже есть в истории.

ЧТО ДЕЛАЕТ ТЕБЯ ХОРОШИМ.
1. Не выдумывай данные. Ответ о знаниях компании бери только из ask_chat_v2.
2. Утверждение для памяти — сохраняй через ingest_note, не отвечай на него как на
   вопрос.
3. Перед изменяющим действием убедись, что понял суть; сомневаешься — один вопрос.
4. Отвечай на русском, коротко. Без английских слов, кодов, идентификаторов.

ПРИМЕРЫ.
[Не про компанию] «Напиши на питоне скрипт» → вежливый отказ, без инструмента.
[Вопрос к памяти] «Что решили по подрядчику?» → ask_chat_v2, ответ как есть.
[Утверждение] «Идея: добавить в КП раздел про поддержку» → ingest_note, подтвердить.
[Действие, неясна суть] «Поставь задачу подготовить отчёт» → один вопрос (кому/срок).
[Действие, всё ясно] «Покажи мои задачи» → list_tasks, без вопросов.`;

function fn(
  name: string,
  description: string,
  props: Record<string, unknown> = {},
  required: string[] = [],
) {
  return {
    type: 'function' as const,
    function: {
      name,
      description,
      parameters: { type: 'object', additionalProperties: false, properties: props, required },
    },
  };
}
const TOOLS = [
  fn(
    'ask_chat_v2',
    'Задать смысловой вопрос памяти компании (граф знаний + таблицы). Для «что решили/обсуждали/почему/кто отвечает/сколько». Ответ с цитатами отдаётся как есть.',
    { question: { type: 'string' } },
    ['question'],
  ),
  fn(
    'ingest_note',
    'Занести в память компании свободную заметку/идею/предложение/наблюдение/описание процесса/факт о клиенте. Когда сообщение — мысль для запоминания, а НЕ вопрос и НЕ команда.',
    { text: { type: 'string' } },
    ['text'],
  ),
  fn(
    'create_task',
    'Поставить задачу в трекер. Нужны суть; желательно исполнитель и срок.',
    { title: { type: 'string' }, assignee: { type: 'string' }, dueDate: { type: 'string' } },
    ['title'],
  ),
  fn(
    'search_tasks',
    'Найти задачи по смыслу/полям (проект, исполнитель, статус, срок) — любые, не только мои. Возвращает задачи с id.',
    { query: { type: 'string' } },
    ['query'],
  ),
  fn('list_tasks', 'Показать МОИ открытые задачи.', {}, []),
  fn(
    'create_event',
    'Создать событие календаря (встреча/созвон/блок времени) на заданное время.',
    { title: { type: 'string' }, startAt: { type: 'string' } },
    ['title', 'startAt'],
  ),
  fn(
    'create_meeting',
    'Создать видеовстречу (планёрку) с темой и типом.',
    { title: { type: 'string' }, type: { type: 'string' } },
    ['title'],
  ),
  fn(
    'find_free_slot',
    'Найти общий свободный слот среди участников.',
    { participants: { type: 'array', items: { type: 'string' } }, durationMin: { type: 'number' } },
    ['participants', 'durationMin'],
  ),
  fn('delete_event', 'Отменить событие календаря.', { id: { type: 'string' } }, ['id']),
  fn('list_my_events', 'Показать мой календарь на период.', {}, []),
  fn('list_user_events', 'Показать календарь другого сотрудника.', { userId: { type: 'string' } }, [
    'userId',
  ]),
  fn(
    'get_person_pulse',
    'Карточка сотрудника (настроение, обещания, риски).',
    { personId: { type: 'string' } },
    ['personId'],
  ),
  fn(
    'ask_role_clone',
    'Спросить клон должности (отвечает от лица роли).',
    { roleId: { type: 'string' }, question: { type: 'string' } },
    ['roleId', 'question'],
  ),
  fn('list_clones', 'Список клонов должностей компании.', {}, []),
];

type Expect = string | 'clarify' | 'refuse';
interface Case {
  id: string;
  text: string;
  expect: Expect;
  scenario: string;
}

const CASES: Case[] = [
  {
    id: 'Q1',
    text: 'Что мы в итоге решили по подрядчику на логистику?',
    expect: 'ask_chat_v2',
    scenario: 'вопрос к памяти',
  },
  {
    id: 'Q2',
    text: 'Почему упала конверсия в марте?',
    expect: 'ask_chat_v2',
    scenario: 'вопрос-анализ',
  },
  {
    id: 'Q3',
    text: 'Сколько у нас клиентов из Москвы?',
    expect: 'ask_chat_v2',
    scenario: 'вопрос к таблице (через chat_v2)',
  },
  {
    id: 'N1',
    text: 'Идея: добавить в коммерческое предложение раздел про поддержку',
    expect: 'ingest_note',
    scenario: 'идея',
  },
  {
    id: 'N2',
    text: 'Клиент Заречный сказал, что готов подписать в пятницу',
    expect: 'ingest_note',
    scenario: 'факт о клиенте',
  },
  {
    id: 'N3',
    text: 'У нас постоянно теряются заявки между продажами и производством',
    expect: 'ingest_note',
    scenario: 'проблема',
  },
  {
    id: 'N4',
    text: 'Подумал: онбординг слишком длинный, новички путаются в первую неделю',
    expect: 'ingest_note',
    scenario: 'рефлексия',
  },
  {
    id: 'N5',
    text: 'Предлагаю проводить ретро раз в две недели вместо раза в месяц',
    expect: 'ingest_note',
    scenario: 'предложение',
  },
  {
    id: 'A1',
    text: 'Запиши встречу с Петей на среду в 15:00',
    expect: 'create_event',
    scenario: 'создать событие',
  },
  {
    id: 'A2',
    text: 'Найди свободный слот на час с Васей на этой неделе',
    expect: 'find_free_slot',
    scenario: 'найти слот',
  },
  {
    id: 'A3',
    text: 'Создай планёрку на завтра в 10',
    expect: 'create_meeting',
    scenario: 'создать встречу',
  },
  {
    id: 'T1',
    text: 'Поставь задачу подготовить КП Заречному к пятнице',
    expect: 'create_task',
    scenario: 'задача (срок есть)',
  },
  {
    id: 'T2',
    text: 'Поставь задачу подготовить отчёт',
    expect: 'clarify',
    scenario: 'задача без срока/исполнителя → уточнить',
  },
  { id: 'S1', text: 'Покажи мои задачи', expect: 'list_tasks', scenario: 'мои задачи' },
  {
    id: 'S2',
    text: 'Найди задачу про договор с Заречным',
    expect: 'search_tasks',
    scenario: 'найти задачу',
  },
  {
    id: 'P1',
    text: 'Как дела у Ивана?',
    expect: 'get_person_pulse',
    scenario: 'карточка человека',
  },
  { id: 'C1', text: 'Заречный', expect: 'clarify', scenario: 'одно слово — непонятно' },
  { id: 'C2', text: 'сделай с этим что-нибудь', expect: 'clarify', scenario: 'неясная команда' },
  {
    id: 'X1',
    text: 'Напиши мне на питоне скрипт для парсинга сайта',
    expect: 'refuse',
    scenario: 'код — отказ',
  },
  { id: 'X2', text: 'Расскажи анекдот', expect: 'refuse', scenario: 'отвлечённое — отказ' },
  {
    id: 'M1',
    text: 'Создай встречу с теми, кто вёл клиента Заречный',
    expect: 'ask_chat_v2',
    scenario: 'сначала узнать кто (память), потом встреча',
  },
];

function short(s: string): string {
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
}

interface Out {
  tool: string | null;
  text: string;
}
async function ask(text: string): Promise<Out> {
  const resp = (await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Сообщение пользователя:\n${text}` },
    ],
    tools: TOOLS,
    tool_choice: 'auto',
    max_tokens: 1500,
  } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
    choices: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ function: { name: string } }>;
      };
    }>;
  };
  const msg = resp.choices[0]?.message;
  const tool = msg?.tool_calls?.[0]?.function.name ?? null;
  return { tool, text: (msg?.content ?? '').trim() };
}

function judge(expect: Expect, out: Out): boolean {
  if (expect === 'clarify') return out.tool === null && /\?/.test(out.text);
  if (expect === 'refuse')
    return (
      out.tool === null && /(не помогу|только по|рабочим делам|по работе|не моя)/i.test(out.text)
    );
  return out.tool === expect;
}

async function main(): Promise<void> {
  console.log(
    `=== concierge routing battery (НОВЫЙ промпт, ${MODEL}) — ${CASES.length} кейсов ===\n`,
  );
  let ok = 0;
  const fails: Array<{ c: Case; out: Out }> = [];
  for (const c of CASES) {
    try {
      const out = await ask(c.text);
      const pass = judge(c.expect, out);
      if (pass) ok++;
      else fails.push({ c, out });
      const got = out.tool ? `tool:${out.tool}` : `текст:"${short(out.text)}"`;
      console.log(
        `${pass ? '✓' : '✗'} ${c.id} [${c.scenario}] "${short(c.text)}"\n     ждали ${c.expect} | получили ${got}`,
      );
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      fails.push({ c, out: { tool: 'ERROR', text: err } });
      console.log(`✗ ${c.id} ERROR: ${err}`);
    }
  }
  console.log('\n──────────────── СВОДКА ────────────────');
  console.log(`Верное поведение: ${ok}/${CASES.length}`);
  console.log(`Расхождения: ${fails.length}`);
  for (const f of fails) {
    const got = f.out.tool ? `tool:${f.out.tool}` : `текст:"${short(f.out.text)}"`;
    console.log(`   ✗ ${f.c.id} [${f.c.scenario}] ждали ${f.c.expect} | ${got}`);
  }
  console.log('────────────────────────────────────────');
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
