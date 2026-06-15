/**
 * Полевой тест «ПОНИМАНИЯ ЗАПРОСА» (dialog-layer) на реальной модели
 * (deepseek-v4-flash). Промпты — из ТЗ 2026-06-14-dialog-layer (Прил. A + B).
 *
 * Шаг 1 (Прил. A): история + реплика → ТРИ самодостаточных формулировки
 *   (раскрыть «это/он/там», покрыть запрос с разных сторон).
 * Шаг 2 (Прил. B): три формулировки → ПЛАН-фильтр (период, темы, сущности,
 *   типы записей, «посчитать?»).
 *
 * Наглядно показывает, что такое «3 формулировки + план» и что местоимения
 * раскрываются по истории.
 *
 * Запуск: bun run --env-file=c:/work/z/backend/.env \
 *           c:/work/z/backend/scripts/eval/smoke-query-understanding-battery.ts
 */
import OpenAI from 'openai';

const API_KEY = process.env.DEEPSEEK_API_KEY;
const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
const MODEL = process.env.DEEPSEEK_DEFAULT_MODEL ?? 'deepseek-v4-flash';
if (!API_KEY) {
  console.error('✗ DEEPSEEK_API_KEY не задан.');
  process.exit(1);
}
const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });

// ─────────── Прил. A: понимание запроса → 3 формулировки ───────────
const EXPAND_SYSTEM = `Ты — модуль понимания запроса в Коре, памяти компании. Кора хранит знания
компании графом: встречи, решения, задачи, договорённости, риски, люди.
Твоя работа — превратить реплику сотрудника в живом диалоге в запросы, по
которым система найдёт нужное в этом графе.

ЗАЧЕМ ЭТО НУЖНО.
Реплика часто неполная: «а сколько это стоит?», «а он что решил?». Без истории
непонятно, о ком и о чём речь. Восстанови смысл по истории и сформулируй
полноценные вопросы.

КОМУ АДРЕСОВАН ВЫВОД.
Твои вопросы читает НЕ человек, а поисковый движок по графу. Каждый вопрос
должен быть понятен сам по себе, без истории диалога.

ЧТО СТАНЕТ С РЕЗУЛЬТАТОМ.
Каждый из трёх вопросов уйдёт ОТДЕЛЬНЫМ поиском, результаты объединятся.
Три вопроса должны покрывать запрос с РАЗНЫХ сторон — поймать записи, где то
же сказано другими словами.

ЧТО СДЕЛАТЬ.
1. Восстанови смысл: замени «это», «он», «там» и пропущенные сущности на
   конкретные имена из истории.
2. Сформулируй ТРИ самодостаточных вопроса об одном и том же, но по-разному:
   • Вопрос 1 — точная переформулировка (другие слова/синонимы).
   • Вопрос 2 — другой ракурс (причина, участники, сроки, последствия).
   • Вопрос 3 — конкретизирующий, узкий.

КРИТЕРИИ.
1. Каждый вопрос понятен БЕЗ истории — местоимения раскрыты именами.
2. Все три — об одном запросе; не уводи в сторону.
3. Три вопроса РАЗНЫЕ по ракурсу, а не синонимы одной фразы.
4. Русский → русские формулировки.
5. Одна мысль, ≤200 символов.
6. Реплика полная — всё равно дай три, но НЕ выдумывай деталей, которых нет.
7. Не отвечай на вопрос — только формулируй.

ЗАПРЕТЫ. Ни одного английского слова/кода/идентификатора. Не добавляй сущности,
которых нет ни в реплике, ни в истории.

ПРИМЕР.
История:
— Пользователь: Что у нас по продукту «Маяк»?
— Ассистент: Это новая система для логистики, запуск в августе.
Реплика: а сколько это стоит?
ХОРОШО:
{"queries":[
 "Сколько стоит продукт Маяк?",
 "Из чего складывается цена системы Маяк для логистики и какие условия оплаты?",
 "Обсуждали ли скидки или особые условия по стоимости продукта Маяк?"
]}

ФОРМАТ ОТВЕТА. Строго JSON: {"queries":["…","…","…"]} — ровно три строки, без
markdown, без пояснений.`;

function expandUser(args: { summary: string; history: string; reply: string }): string {
  return `Краткое содержание диалога:\n${args.summary || '(нет)'}\n\nПоследние сообщения диалога:\n${args.history || '(диалог только начался)'}\n\nРеплика пользователя:\n${args.reply}\n\nТри вопроса:`;
}

// ─────────── Прил. B: 3 формулировки → план-фильтр ───────────
const PLAN_SYSTEM = `Ты — анализатор структуры запроса в Коре. Тебе дают ТРИ формулировки ОДНОГО
запроса. Задача — понять, по каким условиям сузить поиск по графу, и вернуть
один JSON-план. Ты НЕ отвечаешь на вопрос — только извлекаешь структуру.

ПОЧЕМУ ТРИ ФОРМУЛИРОВКИ. Имя клиента/тема/тип записи могут быть названы только
в одной из них. Собери ОБЩУЮ структуру: условие есть хотя бы в одной → включи.
Не накапливай лишнего.

ИНВАРИАНТ: если оси НЕТ — пустое значение ([] / "none" / false / null). НИКОГДА
не выдумывай значения вне наборов ниже.

ОСЬ periodExpr: this_week,last_week,yesterday,today,this_month,last_month,
last_n_days,none. «за месяц»→last_n_days+periodDays=30. Квартал/год/даты НЕ
поддержаны → none. Нет времени → none.
ОСЬ signalTypes (массив): «решали/решение»→decision; «задачи/дела»→task_created,
commitment; «риски»→risk,churn_risk; «блокеры»→blocker; «идеи»→idea;
«запрос клиента»→client_request. Нет → [].
ОСЬ themeBranches (массив из: strategy,clients,sales,marketing,product,operations,
team,finance,technology,production,partnerships,legal). «продукт»→product,
«продажи»→sales, «клиенты»→clients, «финансы/бюджет»→finance, «юр/договор»→legal,
«команда/найм»→team. Нет → [].
ОСЬ entityHints (массив имён собственных КАК НАПИСАНО: клиенты/компании/люди/
проекты). Нет → [].
ОСЬ personScope: true при «я/мой/мне/у меня».
ОСЬ aggregation: true при «сколько/сумма/количество/больше всего».
ОСЬ needsAction: true при «предложи/что делать/посоветуй».
ОСЬ activeNow: true при «сейчас/актуальные/действующие/текущие».
confidence 0..1.

ПЕРЕД ОТВЕТОМ: каждое условие реально стоит в одной из формулировок; ничего не
выдумано. Если нет — убери.

ПРИМЕР.
Формулировки:
1. Что клиент Заречный решил по договору?
2. На каком этапе согласование контракта с Заречным?
3. Какие условия договора с Заречным ещё обсуждаются?
План:
{"periodExpr":"none","periodDays":null,"signalTypes":["decision"],"themeBranches":["clients","legal"],"entityHints":["Заречный"],"personScope":false,"aggregation":false,"needsAction":false,"activeNow":false,"confidence":0.85}

ФОРМАТ. Строго JSON, без markdown. Все поля обязательны:
{"periodExpr":"<токен>","periodDays":<число|null>,"signalTypes":[...],"themeBranches":[...],"entityHints":[...],"personScope":<bool>,"aggregation":<bool>,"needsAction":<bool>,"activeNow":<bool>,"confidence":<0..1>}`;

function planUser(queries: string[]): string {
  return `Сегодня: 2026-06-15 14:00. Таймзона компании: Europe/Moscow.\n\nТри формулировки запроса:\n1. ${queries[0] ?? ''}\n2. ${queries[1] ?? ''}\n3. ${queries[2] ?? ''}\n\nПлан:`;
}

interface Scenario { id: string; summary: string; history: string; reply: string; note: string }
const SCENARIOS: Scenario[] = [
  {
    id: 'Маяк/цена',
    summary: '',
    history: '— Пользователь: Что у нас по продукту «Маяк»?\n— Ассистент: Это система для логистики, запуск в августе.',
    reply: 'а сколько это стоит?',
    note: '«это» должно раскрыться в «Маяк»',
  },
  {
    id: 'продажи/почему',
    summary: '',
    history: '— Пользователь: Как прошёл квартал у отдела продаж?\n— Ассистент: Выручка ниже плана на 15%, особенно просел март.',
    reply: 'а почему так вышло?',
    note: 'follow-up «почему» → раскрыть продажи/квартал',
  },
  {
    id: 'Заречный/месяц',
    summary: '',
    history: '— Пользователь: Что у нас по клиенту Заречный?\n— Ассистент: Ведём договор на поставку, на этапе согласования.',
    reply: 'а что решили за этот месяц?',
    note: 'раскрыть «Заречный» + период this_month',
  },
  {
    id: '1С/риски (без истории)',
    summary: '',
    history: '',
    reply: 'Какие риски по проекту внедрения 1С?',
    note: 'полная реплика, истории нет — не выдумывать',
  },
];

async function callJson(system: string, user: string): Promise<unknown> {
  const resp = (await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
    choices: Array<{ message?: { content?: string | null } }>;
  };
  return JSON.parse(resp.choices[0]?.message?.content ?? '{}');
}

async function main(): Promise<void> {
  console.log(`=== query-understanding (${MODEL}) — ${SCENARIOS.length} сценариев ===\n`);
  for (const s of SCENARIOS) {
    console.log(`■ ${s.id}  (${s.note})`);
    console.log(`  Реплика: "${s.reply}"`);
    try {
      const exp = (await callJson(EXPAND_SYSTEM, expandUser(s))) as { queries?: string[] };
      const queries = exp.queries ?? [];
      console.log('  3 формулировки:');
      queries.forEach((q, i) => console.log(`    ${i + 1}. ${q}`));
      const plan = (await callJson(PLAN_SYSTEM, planUser(queries))) as Record<string, unknown>;
      console.log(
        `  План: период=${plan.periodExpr} типы=${JSON.stringify(plan.signalTypes)} ` +
          `темы=${JSON.stringify(plan.themeBranches)} сущности=${JSON.stringify(plan.entityHints)} ` +
          `посчитать=${plan.aggregation} увер=${plan.confidence}`,
      );
    } catch (e) {
      console.log(`  ✗ ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
    console.log('');
  }
  console.log('Проверь глазами: местоимения раскрыты именами, три вопроса разные по ракурсу,');
  console.log('план собрал период/тему/сущности из формулировок и не выдумал лишнего.');
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
