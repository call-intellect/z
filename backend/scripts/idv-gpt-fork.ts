/**
 * idv-gpt-fork — добивает развилку Р-1: gpt-5.4 (openai-proxy) на ПРЕДЛАГАЕМОМ block-ingest,
 * crux+big кейсы, чтобы сравнить с deepseek-v4-pro (у того: дубли 0, потери 4, верно 33/37).
 *   bun run --env-file=c:/work/z/.env scripts/idv-gpt-fork.ts
 */
import OpenAI from 'openai';
import { buildBlockIngestPrompt } from '../src/modules/knowledge-core/prompts/block-ingest.prompt';

const BORDER = [
  '',
  '# ГРАНИЦА «идея ↔ решение» (частая ошибка — соблюдай строго)',
  'Идею от решения отличает РОВНО ОДИН признак: состоялась ли ФИКСАЦИЯ выбора в этом окне.',
  '- Предложение/намерение без фиксации («давайте», «предлагаю», «может быть», «стоит ли», «хорошо бы», «а что если») → signalType=idea/suggestion. Это ещё НЕ решение.',
  '- ФИКСИРОВАННЫЙ выбор («решили», «договорились», «окей, делаем», «берём», «принято», «утверждаем», отказ «решили НЕ делать») → signalType=decision.',
  '- Гипотетика и отложенное («подумаем», «вернёмся позже», «пока не решаем») → idea/suggestion, НЕ decision. Спорное/мягкое всё равно ИЗВЛЕКАЙ как idea, не роняй блок.',
  '- АНТИ-ДУБЛЬ: если в окне предложение И ЕГО ПРИНЯТИЕ про одно и то же — создай РОВНО ОДИН блок signalType=decision, без дубля idea.',
].join('\n');

type Bucket = 'decision' | 'idea' | 'commitment' | 'other';
const IDEA_FAMILY = new Set(['idea', 'feature_request', 'suggestion', 'client_request']);
const bucketOf = (s: string): Bucket => (s === 'decision' || s === 'rationale' || s === 'decision_basis' ? 'decision' : IDEA_FAMILY.has(s) ? 'idea' : s === 'commitment' ? 'commitment' : 'other');

interface Turn { speaker: string; text: string }
interface Case { id: string; meetingTitle: string; turns: Turn[]; targets: Array<{ keywords: string[]; expect: Bucket; label: string }> }
const seg = (t: Turn[]) => t.map((x, i) => ({ startMs: i * 12000, endMs: i * 12000 + 11000, speakers: [x.speaker], text: x.text }));

const CASES: Case[] = [
  { id: 'I3-accepted', meetingTitle: 'Продуктовая встреча', turns: [
    { speaker: 'Олег', text: 'А давайте сделаем тёмную тему интерфейса — клиенты просили.' },
    { speaker: 'Дина', text: 'Поддерживаю, это недорого.' },
    { speaker: 'Олег', text: 'Отлично, тогда решили: делаем тёмную тему, берём в ближайший спринт.' }],
    targets: [{ keywords: ['тёмн', 'темн'], expect: 'decision', label: 'тёмная тема' }] },
  { id: 'I4-deferred', meetingTitle: 'Стратегия', turns: [
    { speaker: 'Пётр', text: 'Может, нам стоит выйти на рынок Казахстана в следующем году?' },
    { speaker: 'Лена', text: 'Интересно, но данных мало. Давайте пока не будем решать, вернёмся через квартал.' }],
    targets: [{ keywords: ['казахстан'], expect: 'idea', label: 'Казахстан' }] },
  { id: 'I7-reject', meetingTitle: 'Ревью', turns: [
    { speaker: 'Глеб', text: 'Была идея сделать интеграцию с Битрикс.' },
    { speaker: 'Нина', text: 'Обсудили — решили НЕ делать интеграцию с Битрикс в этом квартале, нет ресурсов.' }],
    targets: [{ keywords: ['битрикс'], expect: 'decision', label: 'отказ Битрикс' }] },
  { id: 'I8-authority', meetingTitle: 'У директора', turns: [
    { speaker: 'Директор', text: 'Я считаю, нам надо перейти на четырёхдневку — все так делают.' },
    { speaker: 'HR Оля', text: 'Интересно, но надо посчитать нагрузку.' },
    { speaker: 'Директор', text: 'Ну подумайте, мне кажется это правильно.' }],
    targets: [{ keywords: ['четырёхдневк', 'четырехдневк', 'четыре дня'], expect: 'idea', label: 'четырёхдневка' }] },
  { id: 'I9-hypo', meetingTitle: 'Штурм', turns: [
    { speaker: 'Костя', text: 'Если бы мы перенесли склад ближе к МКАД, доставка стала бы на день быстрее.' },
    { speaker: 'Вера', text: 'Да, в теории. Но это дорого и пока нереалистично.' }],
    targets: [{ keywords: ['склад'], expect: 'idea', label: 'склад' }] },
  { id: 'I10-big', meetingTitle: 'Квартальная сессия', turns: [
    { speaker: 'CEO Артём', text: 'Выручка плюс 8%, отток вырос до 5% — тревожно.' },
    { speaker: 'Маркетинг Даша', text: 'Предлагаю запустить реферальную программу.' },
    { speaker: 'CEO Артём', text: 'Реферальную обсудим отдельно, пока не решаем.' },
    { speaker: 'Финансы Игорь', text: 'Смотрели Альфа и Тинькофф по эквайрингу. Окей, решено — переходим на Тинькофф, комиссия ниже.' },
    { speaker: 'Продукт Сева', text: 'А давайте добавим мобильное приложение.' },
    { speaker: 'CEO Артём', text: 'Мобильное приложение — занесём в идеи, вернёмся через квартал.' },
    { speaker: 'Поддержка Рита', text: 'Боль: тикеты теряются, нет единой очереди.' },
    { speaker: 'CEO Артём', text: 'По поддержке решаем сейчас: внедряем единую систему тикетов до конца месяца. Закрытый вопрос.' },
    { speaker: 'HR Лиза', text: 'Может, стоит ввести наставничество?' },
    { speaker: 'CEO Артём', text: 'Наставничество — хорошая идея, подумаем, не сейчас.' },
    { speaker: 'Финансы Игорь', text: 'Предлагаю поднять цены на 10% со следующего квартала.' },
    { speaker: 'CEO Артём', text: 'Цены — окей, решено, поднимаем на 10% с первого числа, финально.' }],
    targets: [
      { keywords: ['реферал'], expect: 'idea', label: 'реферальная' },
      { keywords: ['тинькофф', 'эквайринг'], expect: 'decision', label: 'эквайринг' },
      { keywords: ['приложени', 'мобильн'], expect: 'idea', label: 'приложение' },
      { keywords: ['тикет'], expect: 'decision', label: 'тикеты' },
      { keywords: ['наставнич'], expect: 'idea', label: 'наставничество' },
      { keywords: ['цен'], expect: 'decision', label: 'цены' }] },
];

function matchBuckets(parsed: unknown, keywords: string[]): Bucket[] {
  const blocks = (parsed as { blocks?: Array<Record<string, unknown>> })?.blocks;
  if (!Array.isArray(blocks)) return [];
  const needles = keywords.map((k) => k.toLowerCase());
  const out: Bucket[] = [];
  for (const b of blocks) {
    const hay = [b['name'], b['criticalQuestion'], b['trustedAnswer'], b['evidenceQuote']].filter((x): x is string => typeof x === 'string').join(' ').toLowerCase();
    if (needles.some((n) => hay.includes(n))) out.push(bucketOf(typeof b['signalType'] === 'string' ? (b['signalType'] as string) : 'x'));
  }
  return [...new Set(out)];
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { process.stderr.write('✗ OPENAI_API_KEY\n'); process.exit(1); }
  const prefix = process.env.PROXY_PREFIX ?? 'myFeedproxy3128';
  const baseURL = process.env.PROXY_BASE_URL ?? 'https://proxy.agent-lia.ru/v1';
  const client = new OpenAI({ apiKey: `${prefix}:${apiKey}`, baseURL });
  const model = 'gpt-5.4';
  const reps = 2;

  let correct = 0, dup = 0, loss = 0, total = 0, errors = 0;
  for (const cs of CASES) {
    const { system, user } = buildBlockIngestPrompt({ meetingTitle: cs.meetingTitle, segments: seg(cs.turns) });
    for (let r = 0; r < reps; r++) {
      let parsed: unknown | null = null;
      try {
        const resp = (await (client as unknown as { responses: { create: (p: Record<string, unknown>) => Promise<{ output_text?: string }> } }).responses.create({
          model, stream: false, instructions: system + '\n' + BORDER,
          input: [{ role: 'user', content: user }], max_output_tokens: 16000, reasoning: { effort: 'medium' },
        }));
        const txt = resp.output_text ?? '';
        try { parsed = JSON.parse(txt); } catch { const m = txt.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch { /* */ } } }
      } catch (e) { process.stdout.write(`  ✗ ${cs.id} r${r}: ${e instanceof Error ? e.message : String(e)}\n`); errors++; }
      for (const t of cs.targets) {
        total++;
        if (!parsed) { loss++; continue; }
        const b = matchBuckets(parsed, t.keywords);
        const hasD = b.includes('decision'), hasI = b.includes('idea');
        if (b.includes(t.expect)) correct++;
        if (hasD && hasI) dup++;
        if ((t.expect === 'idea' || t.expect === 'decision') && !hasD && !hasI) loss++;
      }
    }
  }
  process.stdout.write(`\n=== gpt-5.4 (proxy), ПРЕДЛАГАЕМЫЙ, crux+big ×${reps} ===\n`);
  process.stdout.write(`верно ${correct}/${total} | дублей ${dup} | потерь ${loss} | ошибок-вызова ${errors}\n`);
  process.stdout.write(`(сравнение: deepseek-v4-pro на ТЕХ ЖЕ crux+big — дубли 0, потери малы)\n`);
}
main().catch((e: unknown) => { process.stderr.write(`✗ ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exit(1); });
