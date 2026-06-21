import OpenAI from 'openai';

import {
  PROBE_FORMULATE_SYSTEM_PROMPT,
  PROBE_FORMULATE_USER_TEMPLATE,
} from '../../src/modules/knowledge-core/prompts/probe-formulate.prompt';
import {
  PROBE_REASON_LABEL,
  PROBE_REASON_LABEL_DEFAULT,
} from '../../src/modules/probe/probe-reason-labels';

const MODEL = process.env.PROBE_TEST_MODEL ?? 'deepseek-v4-flash';
const POOL = 4;

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('DEEPSEEK_API_KEY не задан (запускай с --env-file=backend/.env)');
  process.exit(1);
}
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

type Group = 'good' | 'adversarial' | 'noise';
interface Case {
  id: string;
  group: Group;
  reason: string;
  kindRu: string;
  objectName: string;
  message: string;
  suggestedActions: string[];
  expectAsk: boolean;
  nameTokens: string[];
}

const C = (c: Omit<Case, 'nameTokens'>): Case => ({
  ...c,
  nameTokens: c.objectName
    .toLowerCase()
    .replace(/[«»".,()]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 5),
});

const CASES: Case[] = [
  C({ id: 'reg-owner', group: 'good', reason: 'regulation.missing_owner', kindRu: 'регламент', objectName: 'Фиксация договорённостей на совещаниях', message: 'У регламента «Фиксация договорённостей на совещаниях» нет ответственного — назначить владельца?', suggestedActions: ['Назначить ответственного', 'Архивировать'], expectAsk: true }),
  C({ id: 'reg-scope', group: 'good', reason: 'regulation.scope_unclear', kindRu: 'регламент', objectName: 'Упорядоченное хранение информации по торговым сетям', message: 'Не указана область действия регламента «Упорядоченное хранение информации по торговым сетям». На кого распространяется — на всех, на отдел или на роль?', suggestedActions: ['Указать область действия'], expectAsk: true }),
  C({ id: 'proc-owner', group: 'good', reason: 'process_template.step_without_owner', kindRu: 'шаг процесса', objectName: 'Настройка рабочего Telegram-аккаунта', message: 'У шага процесса «Настройка рабочего Telegram-аккаунта» нет ответственного.', suggestedActions: [], expectAsk: true }),
  C({ id: 'proc-input', group: 'good', reason: 'process_template.missing_input_artifact', kindRu: 'шаг процесса', objectName: 'Настройка рабочего Telegram-аккаунта', message: 'У шага «Настройка рабочего Telegram-аккаунта» не указан входной артефакт — что нужно иметь на входе.', suggestedActions: [], expectAsk: true }),
  C({ id: 'dec-overdue', group: 'good', reason: 'decision.overdue', kindRu: 'решение', objectName: 'Перейти на нового подрядчика по логистике', message: 'Решение «Перейти на нового подрядчика по логистике» просрочено (дедлайн был 1 мая).', suggestedActions: [], expectAsk: true }),
  C({ id: 'dec-decider', group: 'good', reason: 'decision.missing_decider', kindRu: 'решение', objectName: 'Запустить вторую смену на складе', message: 'У решения «Запустить вторую смену на складе» не назначен ответственный за принятие.', suggestedActions: [], expectAsk: true }),
  C({ id: 'idea-stuck', group: 'good', reason: 'idea.status_unclear', kindRu: 'идея', objectName: 'Реферальная программа для дистрибьюторов', message: 'Идея «Реферальная программа для дистрибьюторов» в обсуждении больше 30 дней — что решили?', suggestedActions: [], expectAsk: true }),
  C({ id: 'exp-lesson', group: 'good', reason: 'experiment.result_without_lesson', kindRu: 'эксперимент', objectName: 'A/B тест посадочной «Молочные реки»', message: 'У эксперимента «A/B тест посадочной Молочные реки» есть результат, но не зафиксирован вывод.', suggestedActions: [], expectAsk: true }),
  C({ id: 'attr-entity', group: 'good', reason: 'attribution.unresolved_at_ingest', kindRu: 'клиент или контрагент', objectName: 'Молочные реки', message: 'Новая сущность «Молочные реки» упоминается, но не привязана к отделу, проекту или клиенту.', suggestedActions: [], expectAsk: true }),
  C({ id: 'commit', group: 'good', reason: 'commitment.followup', kindRu: 'обещание', objectName: 'прислать смету по ремонту склада до пятницы', message: 'Сотрудник обещал прислать смету по ремонту склада до пятницы — статус неизвестен.', suggestedActions: [], expectAsk: true }),

  C({ id: 'adv-codes', group: 'adversarial', reason: 'knowledge.contradiction_detected', kindRu: 'профиль компании', objectName: 'миссия и стратегия компании', message: 'CompanyProfile cmpzl0mf3k2x9abcd1234 без Mission/Vision/Strategy — заполнить?', suggestedActions: [], expectAsk: true }),
  C({ id: 'adv-multi', group: 'adversarial', reason: 'decision.missing_decider', kindRu: 'решение', objectName: 'Повышение цены для клиентов Acme, Beta и Gamma', message: 'Решение о повышении цены затрагивает клиентов Acme, Beta и Gamma — кто из команды напишет каждому?', suggestedActions: [], expectAsk: true }),
  C({ id: 'adv-empty', group: 'adversarial', reason: 'process_template.missing_output_artifact', kindRu: 'шаг процесса', objectName: '', message: '', suggestedActions: [], expectAsk: false }),

  C({ id: 'noise-generic', group: 'noise', reason: 'attribution.unresolved_at_ingest', kindRu: 'клиент или контрагент', objectName: 'отчёт', message: 'Новая сущность «отчёт» не привязана к отделу или клиенту.', suggestedActions: [], expectAsk: false }),
  C({ id: 'noise-answered', group: 'noise', reason: 'regulation.missing_owner', kindRu: 'регламент', objectName: 'Приёмка товара на складе', message: 'У регламента «Приёмка товара на складе» нет ответственного. В тексте указано: куратор — Иванов Пётр.', suggestedActions: [], expectAsk: false }),
];

interface LlmOut { raw: string; ms: number; err?: string }
async function callJson(system: string, user: string, schema: Record<string, unknown>): Promise<LlmOut> {
  const tool = { type: 'function' as const, function: { name: 'submit', description: 'Верни результат строго по схеме.', parameters: schema } };
  const start = Date.now();
  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [ { role: 'system', content: system }, { role: 'user', content: user } ],
      max_tokens: 900,
      tools: [tool],
      tool_choice: 'auto',
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function: { arguments: string } }> } }>;
    };
    const msg = resp.choices[0]?.message;
    const call = msg?.tool_calls?.[0];
    const raw = call ? call.function.arguments : (msg?.content ?? '').replace(/```json\s*|```/g, '').trim();
    return { raw, ms: Date.now() - start, err: raw.length ? undefined : 'пусто' };
  } catch (e) {
    return { raw: '', ms: Date.now() - start, err: e instanceof Error ? e.message : String(e) };
  }
}

const QUESTION_SCHEMA = { type: 'object', additionalProperties: false, required: ['question'], properties: { question: { type: 'string' } } };

function parseQuestion(o: LlmOut): string {
  if (!o.raw) return '';
  try { return (JSON.parse(o.raw) as { question?: string }).question ?? ''; } catch { return ''; }
}

// ---------- Candidate A: текущий модуль (грязный title=message, базовый промпт) ----------
async function runA(c: Case): Promise<string> {
  const reasonLabel = PROBE_REASON_LABEL[c.reason] ?? PROBE_REASON_LABEL_DEFAULT;
  const pollutedTitle = c.message.slice(0, 100);
  const user = PROBE_FORMULATE_USER_TEMPLATE({
    reasonLabel,
    message: c.message,
    suggestedActions: c.suggestedActions,
    contextCard: pollutedTitle ? { kind: c.reason.split('.')[0]!, title: pollutedTitle } : null,
  });
  return parseQuestion(await callJson(PROBE_FORMULATE_SYSTEM_PROMPT, user, QUESTION_SCHEMA));
}

// ---------- Candidate B: улучшенная формулировка (чистое имя + RU kind + жёсткое «назови объект») ----------
const B_SYSTEM = [
  '# Кто ты',
  'Ты — голос «Коры», памяти компании. Наблюдатели находят пробел в знаниях и присылают служебный сигнал. Преврати его в ОДИН короткий тёплый вопрос человеку, который закроет пробел.',
  '',
  '# Железные правила (соблюдай ВСЕ)',
  '1. НАЗОВИ ОБЪЕКТ человеческими словами: название регламента, решения, клиента, шага. Запрещены «этот регламент», «это решение», «данный процесс» без имени. Если во входе есть название объекта — оно ОБЯЗАНО быть в вопросе.',
  '2. Одна мысль, ровно один «?», ≤180 символов, без приветствий и «спасибо».',
  '3. Ответ за 10–15 секунд по памяти, без похода в документы.',
  '4. Чистый русский: ни кода, ни идентификатора, ни латиницы, ни английских названий сущностей (CompanyProfile, Document) — даже если они во входе, не переноси их.',
  '5. Тёплый тон, не упрёк: «Что сейчас с …?», а не «Почему просрочили?».',
  '6. Без вариантов ответа и списков-подсказок — человек отвечает своими словами.',
  '',
  '# Если конкретного объекта во входе нет',
  'Спроси предметно о сути пробела (о конкретном шаге, факте, обещании). НИКОГДА не отправляй пустое «Можете уточнить?» — это брак.',
  '',
  '# Самопроверка перед ответом',
  'Назван ли конкретный объект своими словами? Один ли вопрос? Нет ли латиницы/кода? Если хоть одно нет — перепиши. Верни строго JSON {question}.',
].join('\n');

function bUser(c: Case): string {
  const reasonLabel = PROBE_REASON_LABEL[c.reason] ?? PROBE_REASON_LABEL_DEFAULT;
  const lines = [
    `Ситуация: ${reasonLabel}`,
    `Тип объекта: ${c.kindRu}`,
  ];
  if (c.objectName) lines.push(`Объект: «${c.objectName}»`);
  if (c.message) lines.push(`Что не хватает: ${c.message}`);
  if (c.suggestedActions.length) lines.push(`Служебная подсказка (НЕ показывай человеку): ${c.suggestedActions.join('; ')}`);
  lines.push('', c.objectName
    ? `Сформулируй один уточняющий вопрос, обязательно с названием объекта «${c.objectName}». Верни JSON {question}.`
    : 'Сформулируй один предметный уточняющий вопрос по сути пробела. Верни JSON {question}.');
  return lines.join('\n');
}
async function runB(c: Case): Promise<string> {
  return parseQuestion(await callJson(B_SYSTEM, bUser(c), QUESTION_SCHEMA));
}

// ---------- Candidate C: B + гейт ценности (спрашивать / промолчать) ----------
const GATE_SYSTEM = [
  'Ты — Кора, память компании. Тебе дают найденный пробел в знаниях. Реши, СТОИТ ли беспокоить живого человека вопросом.',
  'Верни JSON { ask: boolean, reason: string }.',
  'ask=false, если: опереться не на что (нет ни объекта, ни внятной сути); ответ уже виден во входе; объект — общее слово без смысла («отчёт», «задача», «документ»); вопрос вышел бы настолько общим, что человек не поймёт, о чём он.',
  'ask=true, если: есть конкретный объект или конкретный пробел, и ответ человека реально достроит память компании.',
  'Принцип: лучше промолчать, чем задать пустой вопрос. Верни строго JSON.',
].join('\n');
const GATE_SCHEMA = { type: 'object', additionalProperties: false, required: ['ask', 'reason'], properties: { ask: { type: 'boolean' }, reason: { type: 'string' } } };

async function runC(c: Case): Promise<{ skipped: boolean; question: string; gateReason: string }> {
  const reasonLabel = PROBE_REASON_LABEL[c.reason] ?? PROBE_REASON_LABEL_DEFAULT;
  const gateUser = [
    `Ситуация: ${reasonLabel}`,
    `Тип объекта: ${c.kindRu}`,
    c.objectName ? `Объект: «${c.objectName}»` : 'Объект: (не определён)',
    `Что не хватает: ${c.message || '(пусто)'}`,
    '', 'Стоит ли спрашивать человека? Верни JSON {ask, reason}.',
  ].join('\n');
  const g = await callJson(GATE_SYSTEM, gateUser, GATE_SCHEMA);
  let ask = true; let gateReason = '';
  try { const v = JSON.parse(g.raw) as { ask?: boolean; reason?: string }; ask = v.ask !== false; gateReason = v.reason ?? ''; } catch { /* default ask */ }
  if (!ask) return { skipped: true, question: '', gateReason };
  return { skipped: false, question: await runB(c), gateReason };
}

// ---------- Скоринг ----------
function deterministicScore(c: Case, q: string): { namesObject: boolean; oneQ: boolean; noCodes: boolean; lenOk: boolean } {
  const ql = q.toLowerCase();
  const namesObject = c.nameTokens.length === 0 ? !/\b(это|этот|этого|данн\w+)\b/.test(ql) : c.nameTokens.some((t) => ql.includes(t));
  const oneQ = (q.match(/\?/g) ?? []).length === 1;
  const noCodes = !/[a-z]{4,}/i.test(q) && !/[a-z0-9]{16,}/i.test(q);
  const lenOk = q.length > 0 && q.length <= 220;
  return { namesObject, oneQ, noCodes, lenOk };
}

const SCORER_SYSTEM = [
  'Ты — строгий редактор. Оцени уточняющий вопрос, который Кора собирается задать сотруднику.',
  'Тебе дают: вопрос и какой объект имелся в виду.',
  'Верни JSON { names_object: boolean, answerable: integer, clean: boolean }.',
  'names_object — назван ли в вопросе конкретный объект (а не «этот/это/данный» без имени).',
  'answerable — целое 1..5: может ли человек ответить за 15 секунд по памяти, без документов (5 — легко и понятно, 1 — непонятно/невозможно).',
  'clean — нет латиницы/кодов и ровно один вопрос.',
  'Только JSON.',
].join('\n');
const SCORER_SCHEMA = { type: 'object', additionalProperties: false, required: ['names_object', 'answerable', 'clean'], properties: { names_object: { type: 'boolean' }, answerable: { type: 'integer' }, clean: { type: 'boolean' } } };

async function llmScore(c: Case, q: string): Promise<{ names: boolean; answerable: number; clean: boolean }> {
  if (!q) return { names: false, answerable: 0, clean: false };
  const u = `Имелся в виду объект: «${c.objectName || '(не определён)'}» (${c.kindRu}).\nВопрос: ${q}`;
  const o = await callJson(SCORER_SYSTEM, u, SCORER_SCHEMA);
  try { const v = JSON.parse(o.raw) as { names_object?: boolean; answerable?: number; clean?: boolean }; return { names: !!v.names_object, answerable: Number(v.answerable) || 0, clean: !!v.clean }; } catch { return { names: false, answerable: 0, clean: false }; }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) { const i = idx++; if (i >= items.length) break; out[i] = await fn(items[i]!, i); }
  }));
  return out;
}

interface Row { c: Case; qA: string; qB: string; qC: string; cSkipped: boolean; gateReason: string; sA: Awaited<ReturnType<typeof llmScore>>; sB: Awaited<ReturnType<typeof llmScore>>; sC: Awaited<ReturnType<typeof llmScore>>; dA: ReturnType<typeof deterministicScore>; dB: ReturnType<typeof deterministicScore>; dC: ReturnType<typeof deterministicScore> }

async function main(): Promise<void> {
  console.log(`=== probe module bench | модель=${MODEL} | кейсов=${CASES.length} ===\n`);
  const rows = await pool(CASES, POOL, async (c): Promise<Row> => {
    const [qA, qB, cRes] = await Promise.all([runA(c), runB(c), runC(c)]);
    const qC = cRes.skipped ? '' : cRes.question;
    const [sA, sB, sC] = await Promise.all([llmScore(c, qA), llmScore(c, qB), cRes.skipped ? Promise.resolve({ names: false, answerable: 0, clean: false }) : llmScore(c, qC)]);
    return { c, qA, qB, qC, cSkipped: cRes.skipped, gateReason: cRes.gateReason, sA, sB, sC, dA: deterministicScore(c, qA), dB: deterministicScore(c, qB), dC: deterministicScore(c, qC) };
  });

  for (const r of rows) {
    console.log(`### [${r.c.group}] ${r.c.id} — ${r.c.reason}`);
    console.log(`  A: "${r.qA}"  {назв:${r.dA.namesObject ? '✓' : '✗'} отв:${r.sA.answerable} чист:${r.dA.noCodes ? '✓' : '✗'}}`);
    console.log(`  B: "${r.qB}"  {назв:${r.dB.namesObject ? '✓' : '✗'} отв:${r.sB.answerable} чист:${r.dB.noCodes ? '✓' : '✗'}}`);
    console.log(`  C: ${r.cSkipped ? `[ПРОМОЛЧАЛ: ${r.gateReason}]` : `"${r.qC}"  {назв:${r.dC.namesObject ? '✓' : '✗'} отв:${r.sC.answerable} чист:${r.dC.noCodes ? '✓' : '✗'}}`}`);
    console.log('');
  }

  const askable = rows.filter((r) => r.c.expectAsk);
  const agg = (sel: (r: Row) => { names: boolean; answerable: number; det: ReturnType<typeof deterministicScore> }) => {
    const xs = askable.map(sel);
    const names = xs.filter((x) => x.names && x.det.namesObject).length;
    const ans = xs.reduce((s, x) => s + x.answerable, 0) / xs.length;
    const clean = xs.filter((x) => x.det.noCodes && x.det.oneQ && x.det.lenOk).length;
    return { namesPct: Math.round((100 * names) / xs.length), avgAns: ans.toFixed(2), cleanPct: Math.round((100 * clean) / xs.length) };
  };
  const aA = agg((r) => ({ names: r.sA.names, answerable: r.sA.answerable, det: r.dA }));
  const aB = agg((r) => ({ names: r.sB.names, answerable: r.sB.answerable, det: r.dB }));
  const aC = agg((r) => ({ names: r.sC.names, answerable: r.sC.answerable, det: r.dC }));

  const noise = rows.filter((r) => !r.c.expectAsk);
  const gateCorrect = noise.filter((r) => r.cSkipped).length;
  const gateFalseSkip = askable.filter((r) => r.cSkipped).length;

  console.log('=== ИТОГ (только кейсы, где НАДО спрашивать; n=' + askable.length + ') ===');
  console.log('Кандидат | назвал объект % | отвечаемость(1-5) | чистота %');
  console.log(`A (текущий)      | ${aA.namesPct}% | ${aA.avgAns} | ${aA.cleanPct}%`);
  console.log(`B (формулировка) | ${aB.namesPct}% | ${aB.avgAns} | ${aB.cleanPct}%`);
  console.log(`C (B + гейт)     | ${aC.namesPct}% | ${aC.avgAns} | ${aC.cleanPct}%`);
  console.log('');
  console.log('=== ГЕЙТ ЦЕННОСТИ (C) ===');
  console.log(`Шум корректно промолчал: ${gateCorrect}/${noise.length} (кейсы: ${noise.map((r) => r.c.id).join(', ')})`);
  console.log(`Ложно промолчал на нужном: ${gateFalseSkip}/${askable.length}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
