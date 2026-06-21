/**
 * idv-ab — A/B боевого block-ingest против ПРЕДЛАГАЕМОГО варианта на границе идея/решение.
 * Реальные LLM-вызовы. Метрики: правильный класс / дубль (idea+decision на одно) / потеря.
 *
 *   bun run --env-file=c:/work/z/.env scripts/idv-ab.ts --models deepseek-v4-pro,deepseek-v4-flash --crux-repeats 3 --out scripts/eval/_out/idv-ab.json
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { buildBlockIngestPrompt } from '../src/modules/knowledge-core/prompts/block-ingest.prompt';
import {
  IDEA_EXTRACT_SYSTEM_PROMPT,
  IDEA_EXTRACT_USER_TEMPLATE,
} from '../src/modules/knowledge-core/prompts/idea-extract.prompt';

interface Args { flags: Record<string, string | boolean> }
function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else { flags[key] = next; i++; }
  }
  return { flags };
}
const sflag = (a: Args, k: string) => (typeof a.flags[k] === 'string' ? (a.flags[k] as string) : undefined);
const nflag = (a: Args, k: string) => { const v = sflag(a, k); return v === undefined ? undefined : Number(v); };

const PRICES: Record<string, { in: number; cachedIn: number; out: number }> = {
  'deepseek-v4-pro': { in: 0.435 / 1e6, cachedIn: 0.003625 / 1e6, out: 0.87 / 1e6 },
  'deepseek-v4-flash': { in: 0.0945 / 1e6, cachedIn: 0.000787 / 1e6, out: 0.189 / 1e6 },
};
function makeClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) { process.stderr.write('✗ DEEPSEEK_API_KEY\n'); process.exit(1); }
  return new OpenAI({ apiKey, baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1' });
}
async function callJson(c: OpenAI, model: string, system: string, user: string, maxTokens: number): Promise<{ parsed: unknown | null; cost: number; error: string | null }> {
  try {
    const resp = (await c.chat.completions.create({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: maxTokens,
      temperature: 0,
      response_format: { type: 'json_object' },
    } as unknown as Parameters<typeof c.chat.completions.create>[0])) as unknown as {
      choices: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };
    const raw = resp.choices[0]?.message?.content ?? '';
    const tIn = resp.usage?.prompt_tokens ?? 0, tOut = resp.usage?.completion_tokens ?? 0;
    const cached = resp.usage?.prompt_cache_hit_tokens ?? resp.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const p = PRICES[model];
    const cost = p ? Math.max(0, tIn - cached) * p.in + cached * p.cachedIn + tOut * p.out : 0;
    let parsed: unknown | null = null;
    try { parsed = JSON.parse(raw); } catch { const m = raw.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch { /* */ } } }
    return { parsed, cost, error: parsed === null ? `parse_fail(${resp.choices[0]?.finish_reason})` : null };
  } catch (e) { return { parsed: null, cost: 0, error: e instanceof Error ? e.message : String(e) }; }
}

type Bucket = 'decision' | 'idea' | 'commitment' | 'other';
const IDEA_FAMILY = new Set(['idea', 'feature_request', 'suggestion', 'client_request']);
function bucketOf(s: string): Bucket {
  if (s === 'decision' || s === 'rationale' || s === 'decision_basis') return 'decision';
  if (IDEA_FAMILY.has(s)) return 'idea';
  if (s === 'commitment') return 'commitment';
  return 'other';
}

// ── ПРЕДЛАГАЕМЫЙ вариант: к боевому SYSTEM добавляем заострённый дискриминатор границы (cache-friendly, в КОНЕЦ) ──
const BORDER_RULES = [
  '',
  '# ГРАНИЦА «идея ↔ решение» (частая ошибка — соблюдай строго)',
  'Идею от решения отличает РОВНО ОДИН признак: состоялась ли ФИКСАЦИЯ выбора в этом окне.',
  '- Предложение/намерение без фиксации («давайте», «предлагаю», «может быть», «стоит ли», «хорошо бы», «а что если») → signalType=idea (или suggestion). Это ещё НЕ решение.',
  '- ФИКСИРОВАННЫЙ выбор («решили», «договорились», «окей, делаем», «берём», «принято», «утверждаем», а также отказ «решили НЕ делать») → signalType=decision.',
  '- Гипотетика («если бы…», «можно было бы…») и отложенное («подумаем», «вернёмся позже», «пока не решаем») → idea/suggestion, НЕ decision. Не выделяй отдельный блок «решение отложить» — отсрочка не является выбором по существу.',
  '- АНТИ-ДУБЛЬ: если в окне предложение И ЕГО ПРИНЯТИЕ про ОДНО И ТО ЖЕ («а давайте X… — окей, решили, делаем X») — создай РОВНО ОДИН блок signalType=decision. НЕ создавай вдобавок отдельный блок idea про то же самое.',
  '- Запрос/просьба клиента сделать функцию → idea (это спрос, не наш выбор), даже если звучит уверенно.',
  '- Личное обязательство («я к пятнице сделаю») → commitment, не decision и не idea.',
  'Самопроверка перед выдачей: для каждого предложения, которое было ПРИНЯТО в окне, у тебя ровно один decision-блок и НЕТ дублирующего idea-блока про то же.',
].join('\n');

interface Turn { speaker: string; text: string }
interface Case {
  id: string; meetingTitle: string; turns: Turn[];
  targets: Array<{ keywords: string[]; expect: Bucket; label: string }>;
  crux?: boolean;
}
function seg(turns: Turn[]) { return turns.map((t, i) => ({ startMs: i * 12000, endMs: i * 12000 + 11000, speakers: [t.speaker], text: t.text })); }

const CASES: Case[] = [
  { id: 'I1-pure-idea', meetingTitle: 'Планёрка маркетинга', turns: [
    { speaker: 'Иван', text: 'По цифрам за месяц лиды просели процентов на пятнадцать.' },
    { speaker: 'Анна', text: 'Слушайте, а давайте попробуем запустить рассылку по спящей базе — оттуда можно вытащить заявки.' },
    { speaker: 'Иван', text: 'Идея норм, надо прикинуть. Ладно, поехали дальше.' }],
    targets: [{ keywords: ['рассылк', 'спящ'], expect: 'idea', label: 'рассылка' }] },
  { id: 'I2-pure-decision', meetingTitle: 'Выбор SMS-поставщика', turns: [
    { speaker: 'Маша', text: 'Смотрели двух: Твилио и СМС Аэро. Твилио в России дорогой.' },
    { speaker: 'Сергей', text: 'СМС Аэро на тесте дал 99% доставки. Окей, решено — переходим на СМС Аэро, договор на квартал.' },
    { speaker: 'Маша', text: 'Принято, оформляю.' }],
    targets: [{ keywords: ['аэро', 'поставщик'], expect: 'decision', label: 'SMS-поставщик' }] },
  { id: 'I3-idea-then-accepted', meetingTitle: 'Продуктовая встреча', turns: [
    { speaker: 'Олег', text: 'А давайте сделаем тёмную тему интерфейса — клиенты просили.' },
    { speaker: 'Дина', text: 'Поддерживаю, это недорого.' },
    { speaker: 'Олег', text: 'Отлично, тогда решили: делаем тёмную тему, берём в ближайший спринт.' },
    { speaker: 'Дина', text: 'Согласна, фиксируем.' }],
    targets: [{ keywords: ['тёмн', 'темн'], expect: 'decision', label: 'тёмная тема (принято)' }], crux: true },
  { id: 'I4-idea-deferred', meetingTitle: 'Стратегия', turns: [
    { speaker: 'Пётр', text: 'Может, нам стоит выйти на рынок Казахстана в следующем году?' },
    { speaker: 'Лена', text: 'Интересно, но данных мало. Давайте пока не будем решать, вернёмся через квартал.' },
    { speaker: 'Пётр', text: 'Ок, подумаем позже.' }],
    targets: [{ keywords: ['казахстан'], expect: 'idea', label: 'Казахстан (отложено)' }], crux: true },
  { id: 'I5-commitment', meetingTitle: 'Планёрка', turns: [
    { speaker: 'Марина', text: 'Хорошо, я к пятнице подготовлю смету по аренде и пришлю Сергею.' },
    { speaker: 'Сергей', text: 'Договорились, жду.' }],
    targets: [{ keywords: ['смет'], expect: 'commitment', label: 'смета' }] },
  { id: 'I6-client-request', meetingTitle: 'Встреча с клиентом Сбер', turns: [
    { speaker: 'Клиент Иван (Сбер)', text: 'Нам нужно отдавать отчёт юристам в ПДФ — Ворд не пропускает безопасник.' },
    { speaker: 'Менеджер Катя', text: 'Поняла запрос, зафиксирую.' }],
    targets: [{ keywords: ['pdf', 'пдф', 'экспорт'], expect: 'idea', label: 'экспорт PDF (клиент)' }] },
  { id: 'I7-decision-reject', meetingTitle: 'Ревью бэклога', turns: [
    { speaker: 'Глеб', text: 'Была идея сделать интеграцию с Битрикс.' },
    { speaker: 'Нина', text: 'Обсудили — решили НЕ делать интеграцию с Битрикс в этом квартале, нет ресурсов.' },
    { speaker: 'Глеб', text: 'Принято, закрываем.' }],
    targets: [{ keywords: ['битрикс'], expect: 'decision', label: 'отказ от Битрикс' }], crux: true },
  { id: 'I8-authority', meetingTitle: 'Совещание у директора', turns: [
    { speaker: 'Директор', text: 'Я считаю, нам надо перейти на четырёхдневку — все так делают.' },
    { speaker: 'HR Оля', text: 'Интересно, но надо посчитать нагрузку.' },
    { speaker: 'Директор', text: 'Ну подумайте, мне кажется это правильно.' }],
    targets: [{ keywords: ['четырёхдневк', 'четырехдневк', 'четыре дня'], expect: 'idea', label: 'четырёхдневка (мнение)' }], crux: true },
  { id: 'I9-hypothetical', meetingTitle: 'Мозговой штурм', turns: [
    { speaker: 'Костя', text: 'Если бы мы перенесли склад ближе к МКАД, доставка стала бы на день быстрее.' },
    { speaker: 'Вера', text: 'Да, в теории. Но это дорого и пока нереалистично.' }],
    targets: [{ keywords: ['склад'], expect: 'idea', label: 'склад (гипотетика)' }], crux: true },
  { id: 'I10-big-mixed', meetingTitle: 'Квартальная стратегическая сессия', turns: [
    { speaker: 'CEO Артём', text: 'Всем привет. Поехали.' },
    { speaker: 'CEO Артём', text: 'Выручка плюс 8%, но отток вырос до 5% в месяц — тревожно.' },
    { speaker: 'Маркетинг Даша', text: 'Предлагаю запустить реферальную программу — клиенты приводят клиентов.' },
    { speaker: 'CEO Артём', text: 'Реферальную обсудим отдельно, пока не решаем.' },
    { speaker: 'Финансы Игорь', text: 'Смотрели два банка по эквайрингу: Альфа и Тинькофф. Окей, решено — переходим на Тинькофф, комиссия ниже.' },
    { speaker: 'CEO Артём', text: 'Принято по эквайрингу.' },
    { speaker: 'Продукт Сева', text: 'А давайте добавим мобильное приложение — половина трафика с телефонов.' },
    { speaker: 'CEO Артём', text: 'Мобильное приложение — большая стройка, занесём в идеи, вернёмся через квартал.' },
    { speaker: 'Поддержка Рита', text: 'У нас боль: тикеты теряются, нет единой очереди.' },
    { speaker: 'CEO Артём', text: 'По поддержке решаем сейчас: внедряем единую систему тикетов до конца месяца, выделяю бюджет. Закрытый вопрос.' },
    { speaker: 'HR Лиза', text: 'Может, стоит ввести наставничество для новичков?' },
    { speaker: 'CEO Артём', text: 'Наставничество — хорошая идея, подумаем, не сейчас.' },
    { speaker: 'Финансы Игорь', text: 'И ещё: предлагаю поднять цены на 10% со следующего квартала.' },
    { speaker: 'CEO Артём', text: 'Цены — окей, решено, поднимаем на 10% с первого числа следующего квартала, это финально.' },
    { speaker: 'CEO Артём', text: 'Спасибо всем.' }],
    targets: [
      { keywords: ['реферал'], expect: 'idea', label: 'реферальная (не решено)' },
      { keywords: ['тинькофф', 'эквайринг'], expect: 'decision', label: 'эквайринг (решено)' },
      { keywords: ['приложени', 'мобильн'], expect: 'idea', label: 'приложение (в идеи)' },
      { keywords: ['тикет'], expect: 'decision', label: 'тикеты (решено)' },
      { keywords: ['наставнич'], expect: 'idea', label: 'наставничество (подумаем)' },
      { keywords: ['цен'], expect: 'decision', label: 'цены (финально)' }],
    crux: true },
];

function matchBlocks(parsed: unknown, keywords: string[]): Bucket[] {
  const blocks = (parsed as { blocks?: Array<Record<string, unknown>> })?.blocks;
  if (!Array.isArray(blocks)) return [];
  const needles = keywords.map((k) => k.toLowerCase());
  const out: Bucket[] = [];
  for (const b of blocks) {
    const hay = [b['name'], b['criticalQuestion'], b['trustedAnswer'], b['evidenceQuote']]
      .filter((x): x is string => typeof x === 'string').join(' ').toLowerCase();
    if (needles.some((n) => hay.includes(n))) out.push(bucketOf(typeof b['signalType'] === 'string' ? (b['signalType'] as string) : 'x'));
  }
  return [...new Set(out)];
}

interface Score { correct: number; dup: number; loss: number; total: number }
function emptyScore(): Score { return { correct: 0, dup: 0, loss: 0, total: 0 }; }

async function runVariant(c: OpenAI, model: string, system: string, repeats: number, cruxRepeats: number): Promise<{ score: Score; cost: number; perTarget: Record<string, { ok: number; dup: number; loss: number; n: number }> }> {
  const score = emptyScore();
  const perTarget: Record<string, { ok: number; dup: number; loss: number; n: number }> = {};
  let cost = 0;
  for (const cs of CASES) {
    const n = cs.crux ? Math.max(repeats, cruxRepeats) : repeats;
    const user = buildBlockIngestPrompt({ meetingTitle: cs.meetingTitle, segments: seg(cs.turns) }).user;
    for (let r = 0; r < n; r++) {
      const out = await callJson(c, model, system, user, 16000);
      cost += out.cost;
      for (const t of cs.targets) {
        const key = `${cs.id}::${t.label}`;
        perTarget[key] ??= { ok: 0, dup: 0, loss: 0, n: 0 };
        perTarget[key].n++;
        score.total++;
        if (!out.parsed) { score.loss++; perTarget[key].loss++; continue; }
        const buckets = matchBlocks(out.parsed, t.keywords);
        const hasD = buckets.includes('decision'), hasI = buckets.includes('idea');
        const ok = buckets.includes(t.expect);
        if (ok) { score.correct++; perTarget[key].ok++; }
        if (hasD && hasI) { score.dup++; perTarget[key].dup++; } // одно и то же в двух реестрах
        const isIdeaOrDecExpected = t.expect === 'idea' || t.expect === 'decision';
        if (isIdeaOrDecExpected && !hasD && !hasI) { score.loss++; perTarget[key].loss++; }
      }
    }
  }
  return { score, cost, perTarget };
}

// ── L2: idea-extract gate — текущий vs предлагаемый (отказной гейт) ──
const IDEA_GATE_APPEND = [
  '',
  '# Отказной гейт (важно)',
  'Если фрагмент описывает уже ПРИНЯТЫЙ/зафиксированный выбор («решили», «договорились», «окей делаем», «берём», «принято»), это РЕШЕНИЕ, а не идея → верни isIdea=false. Идея — это ещё НЕ принятое предложение.',
].join('\n');
const GATE_BLOCKS = [
  { id: 'B3-accepted-asIdea', truth: 'decision', blockName: 'Тёмная тема', criticalQuestion: 'Что решили?', trustedAnswer: 'Предложили тёмную тему и тут же приняли: берём в спринт.', signalType: 'idea', evidence: ['Олег: решили — делаем тёмную тему.'] },
  { id: 'B5-decision-asIdea', truth: 'decision', blockName: 'Эквайринг Тинькофф', criticalQuestion: 'Что решили?', trustedAnswer: 'Решили перейти на эквайринг Тинькофф: комиссия ниже.', signalType: 'idea', evidence: ['Игорь: окей, решено — переходим на Тинькофф.'] },
  { id: 'B2-true-idea', truth: 'idea', blockName: 'Рассылка по спящей базе', criticalQuestion: 'Что предложили?', trustedAnswer: 'Предложили рассылку по спящей базе. Не приняли.', signalType: 'idea', evidence: ['Анна: давайте попробуем рассылку.'] },
];
async function runGate(c: OpenAI, model: string, append: string, reps: number): Promise<{ rows: Array<{ id: string; truth: string; claimedTrue: number; n: number }>; cost: number }> {
  const rows: Array<{ id: string; truth: string; claimedTrue: number; n: number }> = [];
  let cost = 0;
  for (const b of GATE_BLOCKS) {
    let t = 0;
    for (let r = 0; r < reps; r++) {
      const user = IDEA_EXTRACT_USER_TEMPLATE({ blockName: b.blockName, criticalQuestion: b.criticalQuestion, trustedAnswer: b.trustedAnswer, signalType: b.signalType, tags: [], evidenceQuotes: b.evidence });
      const out = await callJson(c, model, IDEA_EXTRACT_SYSTEM_PROMPT + append, user, 2000);
      cost += out.cost;
      const ip = out.parsed as { isIdea?: boolean } | null;
      if (ip?.isIdea === true) t++;
    }
    rows.push({ id: b.id, truth: b.truth, claimedTrue: t, n: reps });
  }
  return { rows, cost };
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const models = (sflag(a, 'models') ?? 'deepseek-v4-pro').split(',').map((s) => s.trim()).filter(Boolean);
  const repeats = nflag(a, 'repeats') ?? 1;
  const cruxRepeats = nflag(a, 'crux-repeats') ?? 3;
  const c = makeClient();
  const baseSystem = buildBlockIngestPrompt({ meetingTitle: 'x', segments: [{ startMs: 0, endMs: 1, speakers: ['a'], text: 'привет' }] }).system;
  const proposedSystem = baseSystem + '\n' + BORDER_RULES;
  const report: Record<string, unknown> = { ts: new Date().toISOString(), models, perModel: {} };
  let grand = 0;

  for (const model of models) {
    process.stdout.write(`\n══════ ${model} ══════\n`);
    process.stdout.write('L1 ТЕКУЩИЙ block-ingest…\n');
    const cur = await runVariant(c, model, baseSystem, repeats, cruxRepeats);
    process.stdout.write('L1 ПРЕДЛАГАЕМЫЙ block-ingest…\n');
    const prop = await runVariant(c, model, proposedSystem, repeats, cruxRepeats);
    const f = (s: Score) => `верно ${s.correct}/${s.total} (${Math.round(100 * s.correct / s.total)}%) | дублей ${s.dup} | потерь ${s.loss}`;
    process.stdout.write(`  ТЕКУЩИЙ:     ${f(cur.score)}\n`);
    process.stdout.write(`  ПРЕДЛАГАЕМ:  ${f(prop.score)}\n`);
    // целевые, где варианты разошлись
    process.stdout.write('  расхождения по целям (ok/dup/loss):\n');
    for (const key of Object.keys(cur.perTarget)) {
      const a1 = cur.perTarget[key]!, b1 = prop.perTarget[key]!;
      if (a1.ok !== b1.ok || a1.dup !== b1.dup || a1.loss !== b1.loss) {
        process.stdout.write(`    [${key}] тек ok${a1.ok}/d${a1.dup}/l${a1.loss}  →  предл ok${b1.ok}/d${b1.dup}/l${b1.loss}  (n=${a1.n})\n`);
      }
    }
    process.stdout.write('L2 idea-extract gate (текущий vs предлагаемый), reps=3…\n');
    const gCur = await runGate(c, model, '', 3);
    const gProp = await runGate(c, model, IDEA_GATE_APPEND, 3);
    for (let i = 0; i < gCur.rows.length; i++) {
      const a1 = gCur.rows[i]!, b1 = gProp.rows[i]!;
      process.stdout.write(`    [${a1.id}] truth=${a1.truth} | isIdea=true: текущий ${a1.claimedTrue}/${a1.n} → предлагаемый ${b1.claimedTrue}/${b1.n}\n`);
    }
    const cost = cur.cost + prop.cost + gCur.cost + gProp.cost;
    grand += cost;
    process.stdout.write(`стоимость ${model}: $${cost.toFixed(4)}\n`);
    (report.perModel as Record<string, unknown>)[model] = { current: cur.score, proposed: prop.score, curPerTarget: cur.perTarget, propPerTarget: prop.perTarget, gateCurrent: gCur.rows, gateProposed: gProp.rows, costUsd: cost };
  }
  report.grandCostUsd = grand;
  process.stdout.write(`\n════ ИТОГО: $${grand.toFixed(4)} ════\n`);
  const outPath = sflag(a, 'out');
  if (outPath) { await fs.mkdir(path.dirname(path.resolve(outPath)), { recursive: true }); await fs.writeFile(path.resolve(outPath), JSON.stringify(report, null, 2) + '\n', 'utf8'); process.stdout.write(`✓ ${outPath}\n`); }
}
main().catch((e: unknown) => { process.stderr.write(`\n✗ ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exit(1); });
