import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

const MODEL = 'deepseek-v4-pro';
const PRICE_IN = 0.435 / 1_000_000;
const PRICE_CACHED_IN = 0.003625 / 1_000_000;
const PRICE_OUT = 0.87 / 1_000_000;
const MAX_TOKENS = 2000;

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]):/, '$1:');
const CHECKINS_PATH = path.resolve(
  SCRIPT_DIR,
  '../../test/eval/operations-experiment/fixtures/checkins-week.json',
);
const REPORT_PATH = path.resolve(
  SCRIPT_DIR,
  '../../test/eval/operations-experiment/reports/cache-test-checkin.json',
);

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('✗ DEEPSEEK_API_KEY не задан');
  process.exit(1);
}
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

const SYSTEM_SHORT = [
  'Ты — внимательный читатель ежедневных вечерних чек-инов сотрудников.',
  'Тебе дают короткий свободный текст (что человек сделал за день, что мешает, как ощущения).',
  'Твоя задача — определить общее настроение чек-ина одним из трёх значений:',
  '  - "green" — день прошёл нормально или хорошо: задачи закрыты, тон спокойный, блокеров нет или они мелкие.',
  '  - "yellow" — есть напряжение: часть задач не закрыта, есть блокеры или раздражение, но в целом ситуация управляемая.',
  '  - "red" — серьёзные проблемы: ничего не сделано, сильное выгорание, конфликт, явная просьба о помощи, упоминание увольнения, переработки несколько дней подряд.',
  '',
  'Ответ возвращай строго в формате JSON: {"sentiment":"green|yellow|red","rationale":"короткое обоснование на русском, до 200 символов"}.',
  'Никакого комментария вне JSON. rationale — не цитата сотрудника, а короткое объяснение твоего вывода для администратора.',
  'Если текст пустой, бессмысленный или односложный («ок», «всё хорошо») — sentiment="green", rationale="мало деталей, явных проблем нет".',
].join('\n');

const SYSTEM_LONG = `${SYSTEM_SHORT}

═══ Эталонные примеры классификации (ориентируйся на них) ═══

ПРИМЕР 1 (green):
Текст: «Понедельник, начало спринта. Утренняя планёрка прошла нормально, разделили задачи: я взял миграцию каталога услуг, Петя берёт рефакторинг dashboard. По темпу нормально, к пятнице должен закрыть точно.»
Классификация: {"sentiment":"green","rationale":"спокойное начало спринта, задачи распределены, никаких блокеров"}
Объяснение: тон ровный, упомянуты конкретные планы, нет ни одного сигнала тревоги.

ПРИМЕР 2 (yellow):
Текст: «Столкнулся с serialization-проблемой на Redis: Date-объекты теряются при сериализации в JSON. Пришлось писать adapter, проверять в 47 местах вызова. Потратил весь день. Выпадаю из плана на один день. Чувствую раздражение, такие штуки всегда вылезают там, где не ждёшь.»
Классификация: {"sentiment":"yellow","rationale":"непредвиденная проблема, выпадение из плана, явное раздражение"}
Объяснение: напряжение есть, но ситуация управляемая, человек знает что делать. Не red — нет сильного выгорания, не green — есть явный негативный сигнал.

ПРИМЕР 3 (red):
Текст: «Сегодня тяжело. Сидел над dashboard весь день, постоянно ловил себя на том что не понимаю что делаю. Спросил у Ивана пять раз, у Анны три раза — все терпеливо отвечают, но я чувствую что мешаю им работать. Может я не туда пошёл вообще?»
Классификация: {"sentiment":"red","rationale":"сомнения в выборе профессии, чувство что мешает команде, кризис уверенности"}
Объяснение: классический сигнал red — сомнение в собственной пригодности, ощущение бремени для команды. Это не «плохой день», это вопрос о принадлежности.

ПРИМЕР 4 (green):
Текст: «Норм. Закрыл два мелких тикета по pricing, написал документацию по округлению. Завтра возьмусь за баг Елены. Голова ещё не на 100%, но работаю.»
Классификация: {"sentiment":"green","rationale":"стабильный рабочий день, мелочи закрыты, упоминание восстановления здоровья"}
Объяснение: несмотря на упоминание неполной формы — день рабочий, продуктивный, тон спокойный.

ПРИМЕР 5 (yellow):
Текст: «Провела полдня с Дмитрием в паре над dashboard. Своё не двинула вообще. Знаю что это было нужно, но устала, и в голове крутится, что Redis-миграцию не успею к пятнице. Поговорю с Иваном завтра, может стоит сдвинуть deadline.»
Классификация: {"sentiment":"yellow","rationale":"потеряла день на менторство, тревога про deadline, ставит вопрос для эскалации"}
Объяснение: есть напряжение и риск срыва срока, но человек уже планирует разговор с руководителем — ситуация управляемая.

═══ Конец примеров ═══

Теперь классифицируй следующий чек-ин по этому же стандарту.`;

function buildUserMessage(kind: 'morning' | 'evening', rawText: string): string {
  const kindLabel =
    kind === 'evening' ? 'вечерний (что сделано + блокеры + ощущения)' : 'утренний (план на день)';
  return [`Тип чек-ина: ${kindLabel}.`, 'Текст сотрудника:', (rawText ?? '').slice(0, 4_000)].join(
    '\n',
  );
}

interface CheckIn {
  id: string;
  personName: string;
  date: string;
  kind: 'morning' | 'evening';
  rawText: string;
  expectedSentiment: 'green' | 'yellow' | 'red';
  expectedRationaleNote: string;
}

interface CallReport {
  checkInId: string;
  expected: 'green' | 'yellow' | 'red';
  predicted: 'green' | 'yellow' | 'red' | null;
  correct: boolean;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  cacheHitRatio: number;
  costUsd: number;
  error?: string;
}

async function callOne(systemPrompt: string, checkin: CheckIn): Promise<CallReport> {
  const start = Date.now();
  let usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    cached_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } = {};
  let predicted: 'green' | 'yellow' | 'red' | null = null;
  let error: string | undefined;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildUserMessage(checkin.kind, checkin.rawText) },
      ],
      max_tokens: MAX_TOKENS,
      response_format: { type: 'json_object' },
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{ message?: { content?: string | null } }>;
      usage?: typeof usage;
    };
    usage = resp.usage ?? {};
    const content = resp.choices[0]?.message?.content ?? '';
    const parsed = parseJson(content);
    if (parsed) predicted = parsed.sentiment;
    else error = `невалидный JSON: ${content.slice(0, 100)}`;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const ms = Date.now() - start;
  const tokensIn = usage.prompt_tokens ?? 0;
  const tokensOut = usage.completion_tokens ?? 0;
  const cached =
    usage.prompt_cache_hit_tokens ??
    usage.cached_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    0;
  const uncached = Math.max(0, tokensIn - cached);
  const cost = uncached * PRICE_IN + cached * PRICE_CACHED_IN + tokensOut * PRICE_OUT;

  return {
    checkInId: checkin.id,
    expected: checkin.expectedSentiment,
    predicted,
    correct: predicted === checkin.expectedSentiment,
    ms,
    tokensIn,
    tokensOut,
    cachedTokens: cached,
    cacheHitRatio: tokensIn > 0 ? cached / tokensIn : 0,
    costUsd: cost,
    error,
  };
}

function parseJson(text: string): { sentiment: 'green' | 'yellow' | 'red' } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (o.sentiment !== 'green' && o.sentiment !== 'yellow' && o.sentiment !== 'red') return null;
  return { sentiment: o.sentiment };
}

async function runSequential(
  label: string,
  systemPrompt: string,
  checkins: CheckIn[],
): Promise<CallReport[]> {
  console.log(
    `\n--- Проход ${label} (system ≈ ${Math.round(systemPrompt.length / 4)} токенов) ---`,
  );
  const reports: CallReport[] = [];
  for (let i = 0; i < checkins.length; i++) {
    const r = await callOne(systemPrompt, checkins[i]!);
    reports.push(r);
    const pct = r.tokensIn > 0 ? Math.round((r.cachedTokens / r.tokensIn) * 100) : 0;
    console.log(
      `  ${(i + 1).toString().padStart(2, ' ')}/${checkins.length} ${r.checkInId} | ${r.predicted ?? 'ERR'} (exp=${r.expected})${r.correct ? ' ✓' : ' ✗'} | вход=${r.tokensIn} кэш=${r.cachedTokens} (${pct}%) | $${r.costUsd.toFixed(5)}`,
    );
  }
  return reports;
}

function summarize(reports: CallReport[]): {
  totalMs: number;
  avgMs: number;
  totalIn: number;
  totalOut: number;
  totalCached: number;
  totalCost: number;
  costPerCall: number;
  avgCacheHitRatio: number;
  cacheHitAfterFirst: number;
  accuracy: number;
} {
  const totalMs = reports.reduce((s, r) => s + r.ms, 0);
  const avgMs = totalMs / reports.length;
  const totalIn = reports.reduce((s, r) => s + r.tokensIn, 0);
  const totalOut = reports.reduce((s, r) => s + r.tokensOut, 0);
  const totalCached = reports.reduce((s, r) => s + r.cachedTokens, 0);
  const totalCost = reports.reduce((s, r) => s + r.costUsd, 0);
  const avgRatio = reports.reduce((s, r) => s + r.cacheHitRatio, 0) / reports.length;
  const afterFirst = reports.slice(1);
  const afterFirstRatio =
    afterFirst.length > 0
      ? afterFirst.reduce((s, r) => s + r.cacheHitRatio, 0) / afterFirst.length
      : 0;
  const correct = reports.filter((r) => r.correct).length;
  return {
    totalMs,
    avgMs,
    totalIn,
    totalOut,
    totalCached,
    totalCost,
    costPerCall: totalCost / reports.length,
    avgCacheHitRatio: avgRatio,
    cacheHitAfterFirst: afterFirstRatio,
    accuracy: correct / reports.length,
  };
}

async function main(): Promise<void> {
  console.log('=== Гипотеза 3 — кэш-префикс на МАЛОМ источнике ===');
  const raw = JSON.parse(await fs.readFile(CHECKINS_PATH, 'utf-8'));
  const checkins: CheckIn[] = raw.checkins;
  console.log(`  чек-инов: ${checkins.length}`);
  console.log(
    `  system-короткий: ${SYSTEM_SHORT.length} знаков (≈${Math.round(SYSTEM_SHORT.length / 4)} токенов)`,
  );
  console.log(
    `  system-длинный:  ${SYSTEM_LONG.length} знаков (≈${Math.round(SYSTEM_LONG.length / 4)} токенов)`,
  );

  const passA = await runSequential('A (short)', SYSTEM_SHORT, checkins);
  const passB = await runSequential('B (long с 5 эталонными примерами)', SYSTEM_LONG, checkins);

  const sumA = summarize(passA);
  const sumB = summarize(passB);

  console.log('\n=== Итоги ===');
  console.log('Проход A (short system):');
  console.log(`  суммарное время:         ${(sumA.totalMs / 1000).toFixed(1)} с`);
  console.log(`  среднее на вызов:        ${sumA.avgMs.toFixed(0)} мс`);
  console.log(`  токены: вход=${sumA.totalIn} кэш=${sumA.totalCached} выход=${sumA.totalOut}`);
  console.log(`  средний cache hit:       ${(sumA.avgCacheHitRatio * 100).toFixed(1)}%`);
  console.log(`  cache hit после первого: ${(sumA.cacheHitAfterFirst * 100).toFixed(1)}%`);
  console.log(`  стоимость суммарно:      $${sumA.totalCost.toFixed(4)}`);
  console.log(`  стоимость за чек-ин:     $${sumA.costPerCall.toFixed(5)}`);
  console.log(`  точность:                ${(sumA.accuracy * 100).toFixed(0)}%`);
  console.log('\nПроход B (long system с примерами):');
  console.log(`  суммарное время:         ${(sumB.totalMs / 1000).toFixed(1)} с`);
  console.log(`  среднее на вызов:        ${sumB.avgMs.toFixed(0)} мс`);
  console.log(`  токены: вход=${sumB.totalIn} кэш=${sumB.totalCached} выход=${sumB.totalOut}`);
  console.log(`  средний cache hit:       ${(sumB.avgCacheHitRatio * 100).toFixed(1)}%`);
  console.log(`  cache hit после первого: ${(sumB.cacheHitAfterFirst * 100).toFixed(1)}%`);
  console.log(`  стоимость суммарно:      $${sumB.totalCost.toFixed(4)}`);
  console.log(`  стоимость за чек-ин:     $${sumB.costPerCall.toFixed(5)}`);
  console.log(`  точность:                ${(sumB.accuracy * 100).toFixed(0)}%`);
  console.log('\nДельта B vs A:');
  console.log(
    `  цена за чек-ин:    ${sumB.costPerCall > sumA.costPerCall ? '+' : ''}${(((sumB.costPerCall - sumA.costPerCall) / sumA.costPerCall) * 100).toFixed(0)}%`,
  );
  console.log(
    `  точность:          ${sumB.accuracy >= sumA.accuracy ? '+' : ''}${((sumB.accuracy - sumA.accuracy) * 100).toFixed(0)} процентных пункта`,
  );

  await fs.writeFile(
    REPORT_PATH,
    JSON.stringify(
      {
        hypothesis: 'кэш-префикс на малом источнике (чек-ин)',
        fixtureId: raw.fixtureId,
        model: MODEL,
        systemShortChars: SYSTEM_SHORT.length,
        systemLongChars: SYSTEM_LONG.length,
        passA: { summary: sumA, reports: passA },
        passB: { summary: sumB, reports: passB },
      },
      null,
      2,
    ),
    'utf-8',
  );
  console.log(`\n✓ отчёт: ${REPORT_PATH}`);
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
