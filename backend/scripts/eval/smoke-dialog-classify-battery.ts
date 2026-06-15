/**
 * Полевой РАЗНОСТОРОННИЙ тест классификатора намерений (dialog-classify)
 * на РЕАЛЬНОЙ модели (deepseek-v4-flash — как в проде).
 *
 * Берёт продакшен-промпт DIALOG_CLASSIFY_SYSTEM_PROMPT (как есть в коде) и гоняет
 * батарею сообщений. Проверяем ОБА направления:
 *
 *   ИНВАРИАНТ A: УТВЕРЖДЕНИЕ (отчёт/план/заметка/идея/проблема/процесс)
 *               → в обработку (checkin / ingest→граф), НИКОГДА не в assistant.
 *   ИНВАРИАНТ B: ВОПРОС → assistant (помощник/чат), НЕ в граф/задачи.
 *   ДЕЙСТВИЯ (запиши встречу / найди слот / отмени) — должны идти помощнику
 *               (через инструменты). Классификатор не имеет «action»-интента —
 *               смотрим, что он с ними делает (ожидаемый пробел, который
 *               закрывает перевод канала на помощника, Ф5).
 *
 * Запуск: bun run --env-file=c:/work/z/backend/.env \
 *           c:/work/z/backend/scripts/eval/smoke-dialog-classify-battery.ts
 */
import OpenAI from 'openai';

import {
  DIALOG_CLASSIFY_SYSTEM_PROMPT,
  buildClassifyUserPrompt,
} from '../../src/modules/dialog-layer/prompts/classify.prompt';

const API_KEY = process.env.DEEPSEEK_API_KEY;
const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
const MODEL =
  process.env.DIALOG_CLASSIFY_MODEL ??
  process.env.DEEPSEEK_DEFAULT_MODEL ??
  'deepseek-v4-flash';

if (!API_KEY) {
  console.error('✗ DEEPSEEK_API_KEY не задан (backend/.env или --env-file).');
  process.exit(1);
}

const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });

type Route = 'assistant' | 'checkin' | 'ingest' | 'task' | 'show_tasks' | 'unknown';
type Kind = 'question' | 'statement' | 'action' | 'task' | 'show_tasks';

function intentToRoute(intent: string): Route {
  switch (intent) {
    case 'factual':
    case 'exploratory':
    case 'analytical':
    case 'clone_roleplay':
      return 'assistant';
    case 'daily_plan_morning':
    case 'daily_report_evening':
      return 'checkin';
    case 'note':
      return 'ingest';
    case 'task':
      return 'task';
    case 'show_tasks':
      return 'show_tasks';
    default:
      return 'unknown';
  }
}

interface Case {
  id: string;
  text: string;
  kind: Kind;
  /** Куда ДОЛЖНО уйти (для action — идеально assistant, но у классификатора нет интента). */
  expectRoute: Route;
  scenario: string;
}

const CASES: Case[] = [
  // ── ВОПРОСЫ → assistant (инвариант B) ──
  { id: 'Q1', text: 'Какой бюджет на маркетинг в марте?', kind: 'question', expectRoute: 'assistant', scenario: 'факт' },
  { id: 'Q2', text: 'Расскажи, что обсуждали про найм', kind: 'question', expectRoute: 'assistant', scenario: 'обзор' },
  { id: 'Q3', text: 'Почему упала конверсия в марте?', kind: 'question', expectRoute: 'assistant', scenario: 'анализ' },
  { id: 'Q4', text: 'Что бы сказал клон маркетолога про каналы продвижения?', kind: 'question', expectRoute: 'assistant', scenario: 'клон' },
  { id: 'Q5', text: 'Сколько у нас клиентов из Москвы?', kind: 'question', expectRoute: 'assistant', scenario: 'вопрос к таблице' },
  { id: 'Q6', text: 'Напомни, что мы решили по Заречному?', kind: 'question', expectRoute: 'assistant', scenario: 'ловушка: «напомни», но это вопрос к памяти' },
  { id: 'Q7', text: 'Кто отвечает за договор с поставщиком?', kind: 'question', expectRoute: 'assistant', scenario: 'факт-кто' },
  { id: 'Q8', text: 'Сравни выручку за первый и второй квартал', kind: 'question', expectRoute: 'assistant', scenario: 'анализ-сравнение' },
  { id: 'Q9', text: 'Как дела у Ивана?', kind: 'question', expectRoute: 'assistant', scenario: 'вопрос про человека (pulse-инструмент)' },
  { id: 'Q10', text: 'Какие задачи у проекта внедрения 1С?', kind: 'question', expectRoute: 'assistant', scenario: 'ловушка: ЧУЖИЕ/проектные задачи = вопрос, не show_tasks' },
  { id: 'Q11', text: 'Что у Васи в календаре на завтра?', kind: 'question', expectRoute: 'assistant', scenario: 'чужой календарь = вопрос' },

  // ── ДЕЙСТВИЯ → должны идти помощнику (инструменты). Классиф. интента нет ──
  { id: 'A1', text: 'Запиши встречу с Петей на среду в 15:00', kind: 'action', expectRoute: 'assistant', scenario: 'создать событие (create_event)' },
  { id: 'A2', text: 'Найди свободный слот на час с Васей на этой неделе', kind: 'action', expectRoute: 'assistant', scenario: 'найти слот (find_free_slot)' },
  { id: 'A3', text: 'Отмени встречу в четверг', kind: 'action', expectRoute: 'assistant', scenario: 'отменить событие (delete_event)' },
  { id: 'A4', text: 'Создай планёрку на завтра в 10', kind: 'action', expectRoute: 'assistant', scenario: 'создать встречу (create_meeting)' },

  // ── УТВЕРЖДЕНИЯ: планы/отчёты → checkin (инвариант A) ──
  { id: 'P1', text: 'План на день: КП Заречному, созвон с дизайнером, отчёт за апрель', kind: 'statement', expectRoute: 'checkin', scenario: 'утренний план' },
  { id: 'P2', text: 'Доброе утро, сегодня хочу закрыть КП и созвониться с Петровым', kind: 'statement', expectRoute: 'checkin', scenario: 'утренний план' },
  { id: 'R1', text: 'Итоги дня: КП отправил, созвон перенесли, отчёт не успел', kind: 'statement', expectRoute: 'checkin', scenario: 'вечерний отчёт' },
  { id: 'R2', text: 'Сегодня закрыл задачу А, по Б застрял на согласовании', kind: 'statement', expectRoute: 'checkin', scenario: 'отчёт пораньше (днём)' },
  { id: 'R3', text: 'Ещё забыл написать: дозвонился до поставщика, договорились на пятницу', kind: 'statement', expectRoute: 'checkin', scenario: 'второй отчёт-дополнение днём' },
  { id: 'R4', text: 'Сегодня сделал лендинг, не успел отчёт — помешало что не прислали данные. И придумал: давайте автоматизируем выгрузку.', kind: 'statement', expectRoute: 'checkin', scenario: 'отчёт + блокер + идея (микс)' },

  // ── УТВЕРЖДЕНИЯ: заметки/идеи/проблемы/процессы → ingest→граф (инвариант A) ──
  { id: 'N1', text: 'Клиент Заречный сказал, что готов подписать в пятницу', kind: 'statement', expectRoute: 'ingest', scenario: 'заметка-факт' },
  { id: 'N2', text: 'Идея: добавить в коммерческое предложение раздел про поддержку', kind: 'statement', expectRoute: 'ingest', scenario: 'идея' },
  { id: 'N3', text: 'Была встреча с поставщиком, договорились снизить цену на 10%', kind: 'statement', expectRoute: 'ingest', scenario: 'пересказ встречи' },
  { id: 'N4', text: 'У нас постоянно проблема: заявки теряются между продажами и производством', kind: 'statement', expectRoute: 'ingest', scenario: 'проблема' },
  { id: 'N5', text: 'Процесс приёмки оборудования: проверка по накладной, тест-запуск, акт', kind: 'statement', expectRoute: 'ingest', scenario: 'описание процесса' },
  { id: 'N6', text: 'Подумал: наш онбординг слишком длинный, новички путаются в первую неделю', kind: 'statement', expectRoute: 'ingest', scenario: 'рефлексия' },
  { id: 'N7', text: 'Предлагаю проводить ретро раз в две недели вместо раза в месяц', kind: 'statement', expectRoute: 'ingest', scenario: 'предложение' },
  { id: 'B2', text: 'Думаю, надо бы автоматизировать отчёты', kind: 'statement', expectRoute: 'ingest', scenario: 'мысль вслух (не задача)' },
  { id: 'B3', text: 'Опять клиенты жалуются на долгую доставку', kind: 'statement', expectRoute: 'ingest', scenario: 'проблема-заметка' },
  { id: 'B4', text: 'Закрыл 3 задачи, одна висит из-за смежников. Мысль: нужен общий чат с производством.', kind: 'statement', expectRoute: 'checkin', scenario: 'отчёт + идея (микс)' },

  // ── ЗАДАЧИ → task; показать → show_tasks ──
  { id: 'T1', text: 'Поставь задачу: подготовить КП Заречному к пятнице', kind: 'task', expectRoute: 'task', scenario: 'поставить задачу' },
  { id: 'T2', text: 'Напомни завтра позвонить клиенту', kind: 'task', expectRoute: 'task', scenario: 'поставить задачу/напоминание' },
  { id: 'S1', text: 'Какие у меня задачи?', kind: 'show_tasks', expectRoute: 'show_tasks', scenario: 'мои задачи' },
  { id: 'S2', text: 'Покажи мои задачи', kind: 'show_tasks', expectRoute: 'show_tasks', scenario: 'мои задачи' },

  // ── ЛОВУШКА: похоже на отчёт, но это вопрос → assistant ──
  { id: 'B1', text: 'Что я сегодня сделал?', kind: 'question', expectRoute: 'assistant', scenario: 'ловушка: вопрос, не отчёт' },
];

function short(s: string): string {
  return s.length > 64 ? `${s.slice(0, 63)}…` : s;
}
function bothIngest(a: Route, b: Route): boolean {
  const isIng = (r: Route) => r === 'checkin' || r === 'ingest';
  return isIng(a) && isIng(b);
}

interface Result {
  c: Case;
  intent: string;
  confidence: number;
  route: Route;
  err?: string;
}

async function classify(text: string): Promise<{ intent: string; confidence: number }> {
  const resp = (await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: DIALOG_CLASSIFY_SYSTEM_PROMPT },
      { role: 'user', content: buildClassifyUserPrompt({ question: text }) },
    ],
    temperature: 0,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
    choices: Array<{ message?: { content?: string | null } }>;
  };
  const raw = resp.choices[0]?.message?.content ?? '';
  const parsed = JSON.parse(raw) as { intent?: string; confidence?: number };
  return {
    intent: parsed.intent ?? 'unknown',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
  };
}

async function main(): Promise<void> {
  console.log(`=== dialog-classify РАЗНОСТОРОННИЙ (${MODEL}) — ${CASES.length} кейсов ===\n`);
  const results: Result[] = [];
  for (const c of CASES) {
    try {
      const { intent, confidence } = await classify(c.text);
      const route = intentToRoute(intent);
      results.push({ c, intent, confidence, route });
      const ok =
        route === c.expectRoute || (c.kind === 'statement' && bothIngest(route, c.expectRoute));
      const flag = ok ? '✓' : c.kind === 'action' ? '⚠' : '✗';
      console.log(
        `${flag} ${c.id} [${c.kind}/${c.scenario}] "${short(c.text)}"\n` +
          `     → ${intent} (${confidence}) ⇒ ${route} | ждали ${c.expectRoute}`,
      );
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      results.push({ c, intent: 'ERROR', confidence: 0, route: 'unknown', err });
      console.log(`✗ ${c.id} ERROR: ${err}`);
    }
  }

  const statements = results.filter((r) => r.c.kind === 'statement');
  const questions = results.filter((r) => r.c.kind === 'question');
  const actions = results.filter((r) => r.c.kind === 'action');
  const tasks = results.filter((r) => r.c.kind === 'task' || r.c.kind === 'show_tasks');

  const stmtIngested = statements.filter((r) => r.route === 'checkin' || r.route === 'ingest');
  const stmtLeaked = statements.filter((r) => r.route === 'assistant');
  const qToAssistant = questions.filter((r) => r.route === 'assistant');
  const qMissed = questions.filter((r) => r.route !== 'assistant');
  const actToAssistant = actions.filter((r) => r.route === 'assistant');
  const tasksOk = tasks.filter((r) => r.route === r.c.expectRoute);

  console.log('\n──────────────── СВОДКА (две стороны) ────────────────');
  console.log(
    `ИНВАРИАНТ A — утверждение → в граф: ${stmtIngested.length}/${statements.length} ушли в обработку; ` +
      `🔴 утечек в assistant: ${stmtLeaked.length}`,
  );
  for (const r of stmtLeaked) console.log(`   🔴 ${r.c.id} "${short(r.c.text)}" → ${r.intent}`);

  console.log(
    `ИНВАРИАНТ B — вопрос → помощник: ${qToAssistant.length}/${questions.length} ушли в assistant; ` +
      `промахов: ${qMissed.length}`,
  );
  for (const r of qMissed)
    console.log(`   ✗ ${r.c.id} "${short(r.c.text)}" → ${r.intent} (⇒${r.route})`);

  console.log(
    `ДЕЙСТВИЯ — должны идти помощнику: ${actToAssistant.length}/${actions.length} классиф. отдал в assistant.`,
  );
  for (const r of actions)
    console.log(`   • ${r.c.id} "${short(r.c.text)}" → ${r.intent} (⇒${r.route})`);

  console.log(`ЗАДАЧИ/показ — маршрут верный: ${tasksOk.length}/${tasks.length}`);

  const lowConf = results.filter(
    (r) =>
      (r.intent === 'daily_report_evening' || r.intent === 'daily_plan_morning') &&
      r.confidence < 0.7,
  );
  console.log(
    `\nОтчёты/планы с conf<0.7 (в проде упадут в note→граф, тоже ingest): ${lowConf.length}`,
  );
  for (const r of lowConf) console.log(`   • ${r.c.id} ${r.intent} conf=${r.confidence}`);
  console.log('──────────────────────────────────────────────────────');
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
