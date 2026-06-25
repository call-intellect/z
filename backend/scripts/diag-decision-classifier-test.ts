import {
  DECISION_EXTRACT_SYSTEM_PROMPT,
  DECISION_EXTRACT_USER_TEMPLATE,
} from '../src/modules/knowledge-core/prompts/decision-extract.prompt';

type Fixture = {
  id: string;
  quote: string;
  statement: string;
  expected: boolean;
  note: string;
};

const NEGATIVE: Fixture[] = [
  { id: 'N1', statement: 'Айназ подтвердила задачу изучить скрипт', quote: 'задача айнас изучить скрипт подходит', expected: false, note: 'постановка задачи + согласие исполнителя' },
  { id: 'N2', statement: 'chydo_002 взял на себя задачу изучить обновление сервиса', quote: 'задача мне изучить обновление сервиса', expected: false, note: 'взятие задачи на себя' },
  { id: 'N3', statement: 'Сергею поручено настроить отправку ссылки на подключение в Telegram', quote: 'задача сергею сделать так чтобы в Telegram всегда приходила ссылка на подключение', expected: false, note: 'поручение' },
  { id: 'N4', statement: 'Айназ взяла на себя обязательство проверить все поставленные задачи', quote: 'мне тогда задача проверить все задачи те задачи', expected: false, note: 'взятие задачи' },
  { id: 'N5', statement: 'Поручить участнику chydo_002 выяснить, почему ссылка на видео-встречу не доставлена в Telegram', quote: 'задачу ставлю на тебя а ты сейчас отправила ссылку на видео встречу но в Telegram ссылка не пришла задача выяснить почему не пришла да', expected: false, note: 'поручение «ставлю задачу»' },
];

const POSITIVE: Fixture[] = [
  { id: 'P1', statement: 'Отключаем Telegram как канал коммуникации', quote: 'Telegram отключаем', expected: true, note: 'реальное решение-выбор (отказ от канала)' },
  { id: 'P2', statement: 'Создать отдельную группу по продукту, чтобы информация не смешивалась с другими', quote: 'создать отдельно группу именно по этому продукту, чтобы вся информация только здесь была', expected: true, note: 'реальное решение об организации коммуникации' },
  { id: 'P3', statement: 'Уходим к поставщику SMS Aero вместо Twilio', quote: 'смотрели Twilio и SMS Aero, Twilio дорогой в России, идём с SMS Aero, договор на квартал', expected: true, note: 'явный выбор поставщика с обоснованием' },
  { id: 'P4', statement: 'Клиент подключает стандартный тариф без ОКК минимум на полгода', quote: 'берём стандартный тариф без ОКК минимум на полгода', expected: true, note: 'выбор тарифа' },
  { id: 'P5', statement: 'Начать тестирование продукта с одной задачи (пилотный подход), затем масштабировать', quote: 'начинаем с пилота на одной задаче, потом масштабируем', expected: true, note: 'выбор подхода к внедрению' },
];

const FIXTURES = [...NEGATIVE, ...POSITIVE];

const RULE_BLOCK = [
  '# Поручение и постановка задачи — это НЕ решение (жёсткое правило)',
  'Решение фиксирует ВЫБОР между альтернативами («берём вариант Б», «решили НЕ делать X», «уходим к поставщику Y»). Назначение исполнителя на действие — это ЗАДАЧА, не решение.',
  'Верни isDecision=false, если фрагмент — это:',
  '- постановка задачи или поручение: «задача …», «поручаю / поручено», «назначаю ответственным», «возьми на себя», «ставлю задачу», «сделай / подготовь / настрой / выясни / проверь»;',
  '- взятие задачи исполнителем или согласие её выполнить («мне задача …», «беру», «подходит», «хорошо», «да») — согласие ВЗЯТЬ задачу не делает её решением.',
  'isDecision=true — только когда зафиксирован ВЫБОР с обоснованием, а НЕ указание кому что делать. Формула: решение = ЧТО выбрали; задача = КТО что делает.',
  '',
  '# Примеры задач (вернуть isDecision=false)',
  '- «задача айназ изучить скрипт подходит» → false (постановка задачи + согласие исполнителя).',
  '- «задача мне изучить обновление сервиса» → false (взятие задачи).',
  '- «задача сергею сделать так, чтобы в Telegram приходила ссылка» → false (поручение).',
  '- «мне тогда задача проверить все задачи» → false (взятие задачи).',
  '- «задачу ставлю на тебя — выяснить, почему не пришла ссылка» → false (поручение).',
  '- «подготовить план лидогенерации» → false (действие к исполнению).',
  '# Примеры решений (вернуть isDecision=true)',
  '- «решили отключить Telegram как канал коммуникации» → true (выбор-отказ).',
  '- «берём стандартный тариф без ОКК минимум на полгода» → true (выбор).',
  '- «начинаем с пилота на одной задаче, потом масштабируем» → true (выбор подхода).',
].join('\n');

const SELF_CHECK_MARKER = '# Перед тем как вернуть ответ — самопроверка';

const NEW_SYSTEM_PROMPT = DECISION_EXTRACT_SYSTEM_PROMPT.replace(
  SELF_CHECK_MARKER,
  `${RULE_BLOCK}\n\n${SELF_CHECK_MARKER}\n0. Это не постановка задачи / поручение / взятие задачи (в т.ч. со словом «задача»)? Если кому-то поручают сделать действие — isDecision=false.`,
);

function buildUser(f: Fixture): string {
  return DECISION_EXTRACT_USER_TEMPLATE({
    blockName: f.statement,
    criticalQuestion: 'Какое решение принято на встрече?',
    trustedAnswer: f.statement,
    signalType: 'decision',
    tags: [],
    evidenceQuotes: [f.quote],
    contextQuotes: [],
  });
}

const API_KEY = process.env.DEEPSEEK_API_KEY ?? '';
const BASE_URL = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '');
const MODEL = process.env.DEEPSEEK_DEFAULT_MODEL ?? 'deepseek-chat';
const ENDPOINT = /\/chat\/completions$/.test(BASE_URL) ? BASE_URL : `${BASE_URL}/chat/completions`;

async function classify(system: string, user: string): Promise<{ isDecision: boolean | null; raw: string }> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? '';
  let isDecision: boolean | null = null;
  try {
    const parsed = JSON.parse(content);
    isDecision = typeof parsed.isDecision === 'boolean' ? parsed.isDecision : null;
  } catch {
    isDecision = null;
  }
  return { isDecision, raw: content };
}

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error('Нет DEEPSEEK_API_KEY. Запусти: bun run --env-file=<путь к .env> scripts/diag-decision-classifier-test.ts');
    process.exit(1);
  }
  console.log(`Модель: ${MODEL} · endpoint: ${ENDPOINT}`);
  console.log(`Фикстур: ${FIXTURES.length} (negative=${NEGATIVE.length}, positive=${POSITIVE.length})\n`);

  let oldNegPass = 0;
  let newNegPass = 0;
  let oldPosPass = 0;
  let newPosPass = 0;

  for (const f of FIXTURES) {
    const user = buildUser(f);
    const [oldR, newR] = await Promise.all([
      classify(DECISION_EXTRACT_SYSTEM_PROMPT, user),
      classify(NEW_SYSTEM_PROMPT, user),
    ]);
    const oldOk = oldR.isDecision === f.expected;
    const newOk = newR.isDecision === f.expected;
    if (!f.expected) {
      if (oldOk) oldNegPass++;
      if (newOk) newNegPass++;
    } else {
      if (oldOk) oldPosPass++;
      if (newOk) newPosPass++;
    }
    const mark = (ok: boolean) => (ok ? 'OK ' : 'FAIL');
    console.log(
      `${f.id} ожид=${String(f.expected).padEnd(5)} | старый: isDecision=${String(oldR.isDecision).padEnd(5)} ${mark(oldOk)} | новый: isDecision=${String(newR.isDecision).padEnd(5)} ${mark(newOk)} | «${f.quote.slice(0, 60)}»`,
    );
  }

  console.log('\n=== СВОДКА ===');
  console.log(`NEGATIVE (псевдо-решения, должны отсечься → false):  старый ${oldNegPass}/${NEGATIVE.length} · новый ${newNegPass}/${NEGATIVE.length}`);
  console.log(`POSITIVE (настоящие решения, должны остаться → true): старый ${oldPosPass}/${POSITIVE.length} · новый ${newPosPass}/${POSITIVE.length}`);
  console.log(`\nУлучшение по мусору: +${newNegPass - oldNegPass} отсечённых псевдо-решений. Регресс по настоящим: ${newPosPass - oldPosPass}.`);
}

void main();
