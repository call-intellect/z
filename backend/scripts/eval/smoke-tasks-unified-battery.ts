/**
 * Полевой тест калибровки интента извлечения задач (Ф7) на РЕАЛЬНОЙ модели
 * (deepseek-v4-flash — как в проде).
 *
 * Берёт ПРОДАКШЕН-промпты извлечения задач (как есть в коде) и гоняет батарею
 * реплик. Проверяем ОБА направления (по образцу smoke-dialog-classify-battery):
 *
 *   ИНВАРИАНТ A (вопрос / команда / запрос статуса) → 0 кандидатов в задачи.
 *               «какие у меня задачи?», «/actions», «покажи мои задачи», «что
 *               я сегодня сделал?», «открой отчёт» и т.п. — это НЕ обещания,
 *               извлекатель должен вернуть пустой список.
 *   ИНВАРИАНТ B (настоящее обещание) → ≥1 кандидат.
 *               «Сделаю КП Заречному к пятнице», «Беру на себя созвон…».
 *
 * Гоняем через три продакшен-билдера:
 *   - telegram  — `TelegramTaskParserService.buildTaskExtractPrompt` (own).
 *                 Метод приватный, поэтому SYSTEM реконструирован 1-в-1 из
 *                 кода + общий `NOT_A_TASK_DISCRIMINATOR` (Ф7). Ответ —
 *                 json_object (как в проде telegram-create-task).
 *   - meeting   — `buildMeetingExtractActionsPrompt` (enriched+confidence+quote).
 *   - structured— `buildTasksStructuredPrompt` (модель Task / chatbox-путь).
 *                 Оба — tool-use (`extract_tasks`), как в проде.
 *
 * Это поле (ship-and-observe), НЕ golden-гейт. В apply-prod-deploy НЕ входит.
 *
 * Запуск: bun run --env-file=c:/work/z/backend/.env \
 *           c:/work/z/backend/scripts/eval/smoke-tasks-unified-battery.ts
 */
import OpenAI from 'openai';

import {
  NOT_A_TASK_DISCRIMINATOR,
  type PromptInput,
} from '../../src/modules/ai/services/prompts/common';
import { buildMeetingExtractActionsPrompt } from '../../src/modules/ai/services/prompts/tasks';
import {
  buildTasksStructuredPrompt,
  TASKS_STRUCTURED_OPTIONS,
} from '../../src/modules/ai/services/prompts/tasks-structured';
import { buildTasksToolUnified } from '../../src/modules/ai/services/prompts/tasks-unified';

const API_KEY = process.env.DEEPSEEK_API_KEY;
const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
const MODEL =
  process.env.DEEPSEEK_DEFAULT_MODEL ?? 'deepseek-v4-flash';

if (!API_KEY) {
  console.error('✗ DEEPSEEK_API_KEY не задан (backend/.env или --env-file).');
  process.exit(1);
}

const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });

type Builder = 'telegram' | 'meeting' | 'structured';

interface Case {
  id: string;
  text: string;
  /** 'none' — ждём 0 задач (инвариант A); 'task' — ждём ≥1 (инвариант B). */
  expect: 'none' | 'task';
  scenario: string;
}

const CASES: Case[] = [
  // ── ИНВАРИАНТ A: вопросы / команды / статусы → 0 кандидатов ──
  { id: 'A1', text: 'какие у меня задачи?', expect: 'none', scenario: 'вопрос-мои задачи' },
  { id: 'A2', text: 'какие у меня есть задачи?', expect: 'none', scenario: 'вопрос-мои задачи (вариант)' },
  { id: 'A3', text: '/actions', expect: 'none', scenario: 'команда интерфейса' },
  { id: 'A4', text: 'покажи мои задачи', expect: 'none', scenario: 'команда показать' },
  { id: 'A5', text: 'что я сегодня сделал?', expect: 'none', scenario: 'запрос статуса (ловушка)' },
  { id: 'A6', text: 'открой отчёт', expect: 'none', scenario: 'навигация' },
  { id: 'A7', text: 'список задач', expect: 'none', scenario: 'команда показать список' },
  { id: 'A8', text: 'какой статус по Заречному?', expect: 'none', scenario: 'запрос статуса' },

  // ── ИНВАРИАНТ B: настоящие обещания → кандидат ──
  { id: 'B1', text: 'Сделаю КП Заречному к пятнице', expect: 'task', scenario: 'обещание со сроком' },
  { id: 'B2', text: 'Беру на себя созвон с поставщиком', expect: 'task', scenario: 'беру на себя' },
  { id: 'B3', text: 'Подготовлю отчёт за апрель до вторника', expect: 'task', scenario: 'обещание со сроком' },
];

/**
 * Реконструкция telegram-SYSTEM (own-mode) 1-в-1 из
 * `telegram-task-parser.service.ts::buildTaskExtractPrompt`. Метод приватный —
 * импортировать нельзя; собираем тот же текст и приклеиваем общий Ф7-блок,
 * чтобы тест бил по реальной формулировке. Если код билдера изменится —
 * этот тест надо синхронизировать (он намеренно жёсткий).
 */
function buildTelegramOwnSystem(): string {
  const sourceLine =
    'Пользователь пишет в личке короткое поручение (себе или коллеге). Извлеки из текста:';
  const titleLine =
    '- "title": короткая формулировка задачи (5-10 слов, императив или infinitive).';
  const assigneeLine =
    '- "suggestedAssigneeHint": ФИО исполнителя как написано в тексте, или null если про себя / не указано.';
  const confidenceLine =
    '- "confidence": 0..1, насколько ты уверен. ≥ 0.85 ставь только если формулировка чёткая и атрибуция явная.';
  const quoteLine =
    '- "sourceQuote": фрагмент исходного текста, на котором ты основал title (для аудита).';
  const base = `Ты — AI-парсер задач из Telegram-бота. ${sourceLine}
${titleLine}
${assigneeLine}
- "suggestedDueDate": дата в формате YYYY-MM-DD, если упомянуто (сегодня / завтра / 24 мая / в пятницу). Дата «сегодня» передана в сообщении пользователя ниже. Если не упомянуто — null.
- "suggestedProjectHint": если упомянут проект/объект — короткое название или identifier; иначе null.
- "suggestedPriority": "urgent" | "high" | "medium" | "low" | null.
${confidenceLine}
${quoteLine}

Не выдумывай. Что не указано в тексте — null.`;
  return `${base}\n\n${NOT_A_TASK_DISCRIMINATOR}`;
}

const TELEGRAM_OWN_SYSTEM = buildTelegramOwnSystem();

/** Превращает одну реплику в единичный «диалог» для meeting-билдеров. */
function asPromptInput(text: string): PromptInput {
  return {
    meeting: { id: 'm-smoke', title: 'Планёрка', type: 'team', customPrompt: null },
    dialog: [{ speaker: 'Сотрудник', text, startSec: 0, endSec: 3 }],
  };
}

interface Outcome {
  tasksCount: number;
  err?: string;
}

/** telegram-путь: один JSON-объект задачи (или пусто). */
async function runTelegram(text: string): Promise<Outcome> {
  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: TELEGRAM_OWN_SYSTEM },
        { role: 'user', content: `Сегодня: 2026-06-15\n\nСообщение пользователя:\n"""\n${text}\n"""` },
      ],
      temperature: 0,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{ message?: { content?: string | null } }>;
    };
    const raw = resp.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as { title?: unknown; tasks?: unknown[] };
    // Telegram-промпт просит единичный объект задачи. «Пусто» = нет осмысленного
    // title (пустая строка / null / отсутствует). Некоторые модели заворачивают
    // в { tasks: [] } — учтём оба варианта.
    if (Array.isArray(parsed.tasks)) {
      return { tasksCount: parsed.tasks.length };
    }
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
    return { tasksCount: title.length > 0 ? 1 : 0 };
  } catch (e) {
    return { tasksCount: -1, err: e instanceof Error ? e.message : String(e) };
  }
}

// Маркер system'а structured-билдера — чтобы runMeetingTool знал, какой набор
// опций tool'а взять (structured использует assigneeRaw/fragmentBounds).
// Объявлен ДО runMeetingTool (no-use-before-define).
const STRUCTURED_SYSTEM_MARKER = buildTasksStructuredPrompt({
  meeting: { id: 'm-smoke', type: 'team', title: 'Планёрка' },
  dialog: [{ speaker: 'Сотрудник', text: '__marker__', startSec: 0, endSec: 1 }],
}).system;

/** meeting/structured-путь: tool-use `extract_tasks` → { tasks: [...] }. */
async function runMeetingTool(
  system: string,
  user: string,
): Promise<Outcome> {
  try {
    const tool =
      system === STRUCTURED_SYSTEM_MARKER
        ? buildTasksToolUnified(TASKS_STRUCTURED_OPTIONS)
        : buildTasksToolUnified({
            enriched: true,
            withConfidence: true,
            withSourceQuote: true,
          });
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0,
      max_tokens: 1500,
      tools: [
        {
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
          },
        },
      ],
      tool_choice: 'auto',
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ function?: { arguments?: string } }>;
        };
      }>;
    };
    const msg = resp.choices[0]?.message;
    const argsStr = msg?.tool_calls?.[0]?.function?.arguments;
    if (argsStr) {
      const parsed = JSON.parse(argsStr) as { tasks?: unknown[] };
      return { tasksCount: Array.isArray(parsed.tasks) ? parsed.tasks.length : 0 };
    }
    // Модель не вызвала tool → считаем 0 задач (нет поручения).
    return { tasksCount: 0 };
  } catch (e) {
    return { tasksCount: -1, err: e instanceof Error ? e.message : String(e) };
  }
}

interface Row {
  c: Case;
  byBuilder: Record<Builder, Outcome>;
}

function short(s: string): string {
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}

async function main(): Promise<void> {
  console.log(
    `=== smoke tasks-unified (Ф7 интент) — модель ${MODEL}, ${CASES.length} кейсов ×3 билдера ===\n`,
  );
  // Sanity: оба meeting-билдера должны содержать Ф7-блок (если нет — правка не доехала).
  const me = buildMeetingExtractActionsPrompt(asPromptInput('x')).system;
  const st = STRUCTURED_SYSTEM_MARKER;
  for (const [name, sys] of [['meeting', me], ['structured', st]] as const) {
    if (!sys.includes('Не задача (НЕ извлекай')) {
      console.error(`✗ SYSTEM билдера ${name} НЕ содержит Ф7-блок — правка не применена!`);
      process.exit(1);
    }
  }
  if (!TELEGRAM_OWN_SYSTEM.includes('Не задача (НЕ извлекай')) {
    console.error('✗ telegram SYSTEM НЕ содержит Ф7-блок.');
    process.exit(1);
  }
  console.log('✓ sanity: все три SYSTEM содержат негативный класс Ф7\n');

  const rows: Row[] = [];
  for (const c of CASES) {
    const pi = asPromptInput(c.text);
    const me2 = buildMeetingExtractActionsPrompt(pi);
    const st2 = buildTasksStructuredPrompt({
      meeting: { id: 'm-smoke', type: 'team', title: 'Планёрка' },
      dialog: pi.dialog,
    });

    const [tg, meet, struct] = await Promise.all([
      runTelegram(c.text),
      runMeetingTool(me2.system, me2.user),
      runMeetingTool(st2.system, st2.user),
    ]);

    const row: Row = {
      c,
      byBuilder: { telegram: tg, meeting: meet, structured: struct },
    };
    rows.push(row);

    const cell = (o: Outcome): string =>
      o.err ? 'ERR' : o.tasksCount === 0 ? '0' : `${o.tasksCount}`;
    const okFor = (o: Outcome): boolean =>
      c.expect === 'none' ? o.tasksCount === 0 : o.tasksCount >= 1;
    const flag =
      [tg, meet, struct].every(okFor) ? '✓' :
      [tg, meet, struct].some((o) => o.err) ? '⚠' : '✗';
    console.log(
      `${flag} ${c.id} [${c.scenario}] "${short(c.text)}" ждём=${c.expect}\n` +
        `     tg=${cell(tg)} meeting=${cell(meet)} structured=${cell(struct)}`,
    );
  }

  console.log('\n──────────────── СВОДКА ────────────────');
  const builders: Builder[] = ['telegram', 'meeting', 'structured'];
  for (const b of builders) {
    const noneCases = rows.filter((r) => r.c.expect === 'none');
    const taskCases = rows.filter((r) => r.c.expect === 'task');
    const leaks = noneCases.filter((r) => r.byBuilder[b].tasksCount > 0);
    const missed = taskCases.filter(
      (r) => r.byBuilder[b].tasksCount === 0,
    );
    const errs = rows.filter((r) => r.byBuilder[b].err);
    console.log(
      `[${b}] ИНВАРИАНТ A (0 задач): 🔴 утечек ${leaks.length}/${noneCases.length}; ` +
        `ИНВАРИАНТ B (есть задача): промахов ${missed.length}/${taskCases.length}; ошибок ${errs.length}`,
    );
    for (const r of leaks)
      console.log(`   🔴 ${r.c.id} "${short(r.c.text)}" → ${r.byBuilder[b].tasksCount} задач`);
    for (const r of missed)
      console.log(`   ✗ ${r.c.id} "${short(r.c.text)}" → 0 задач (ждали ≥1)`);
    for (const r of errs)
      console.log(`   ⚠ ${r.c.id} "${short(r.c.text)}": ${r.byBuilder[b].err}`);
  }
  console.log('────────────────────────────────────────');
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
