import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: process.env.DEEPSEEK_BASE_URL ?? '',
  apiKey: process.env.DEEPSEEK_API_KEY ?? '',
});
const MODEL = process.env.DEEPSEEK_DEFAULT_MODEL ?? 'deepseek-v4-flash';

type Stance = 'critic' | 'supporter' | 'neutral';
type Variant = 'A' | 'B' | 'C';

interface Card {
  id: string;
  type: string;
  payload: string;
  source: string;
  expect: 'accept' | 'reject';
  why: string;
}

const CARDS: Card[] = [
  { id: 'd1', type: 'решение', payload: 'Запустить ОКК (контроль качества звонков) с понедельника, 9 февраля.',
    source: '«…значит, запускаем ОКК в понедельник, девятого февраля.» — «Да, договорились, с девятого.»',
    expect: 'accept', why: 'чёткое решение, дата, обоюдное согласие' },
  { id: 'd2', type: 'регламент', payload: 'Единое приветствие клиента — без указания времени суток: «Здравствуйте».',
    source: '«давайте утвердим единое приветствие — просто „Здравствуйте", без „добрый день".» — «ок, фиксируем так».',
    expect: 'accept', why: 'утверждено явно' },
  { id: 'd3', type: 'решение', payload: 'Добавить клиенту одну неделю к сроку лицензии в качестве компенсации.',
    source: '«в качестве компенсации добавим неделю к лицензии». — «Согласовано, оформляйте».',
    expect: 'accept', why: 'согласованное решение' },
  { id: 'd4', type: 'решение', payload: 'Провести вводный Zoom-созвон по проекту завтра в 11:00.',
    source: '«давай завтра в 11 утра созвонимся в зуме по проекту». — «ок, ставлю на 11».',
    expect: 'accept', why: 'конкретная договорённость' },
  { id: 'd5', type: 'решение', payload: 'Отложить внедрение модуля ОКК до подтверждения стабильной интеграции Telegram и Max.',
    source: '«пока не убедимся, что интеграция с телегой и максом стабильна, ОКК не внедряем». — «согласен, откладываем».',
    expect: 'accept', why: 'явное решение отложить' },
  { id: 'd6', type: 'решение', payload: 'Установить тариф 50 000 рублей в месяц.',
    source: '«а давайте поднимем тариф до 50 тысяч?» — «нет, это дорого для клиентов, оставляем как есть».',
    expect: 'reject', why: 'предложение ОТКЛОНили — это не решение' },
  { id: 'd7', type: 'регламент', payload: 'Удалять лида.',
    source: '«если лид задублировался — удаляем дубль, иначе не трогаем».',
    expect: 'reject', why: 'потеряно условие „если дубль" → опасное безусловное правило' },
  { id: 'd8', type: 'решение', payload: 'Выручка компании — 1 миллион рублей в неделю.',
    source: '«да мы за неделю миллион поднимем, ха-ха». — «ну-ну, мечтай».',
    expect: 'reject', why: 'риторика/шутка, не факт' },
  { id: 'd9', type: 'решение', payload: 'Нужно что-то решить с интеграцией.',
    source: '«там с интеграцией непонятно… надо подумать как-нибудь». — «угу».',
    expect: 'reject', why: 'расплывчато, нет решения' },
  { id: 'd10', type: 'процесс', payload: 'Разделить рабочий чат в Telegram на топики: «ОКК звонки», «ОКК переписки», «Финансы».',
    source: '«предлагаю разбить рабочий чат на три топика — ОКК звонки, ОКК переписки и финансы». — «отлично, делаем так».',
    expect: 'accept', why: 'согласованное организационное решение' },
  { id: 'd11', type: 'решение', payload: 'Созвониться с клиентом по номеру 8-977-424-44-25 для совместной настройки.',
    source: '«созвонимся по номеру… восемь девятьсот семьдесят семь, четыреста двадцать четыре, сорок четыре, двадцать пять». — «ок».',
    expect: 'accept', why: 'номер совпадает с источником' },
  { id: 'd12', type: 'регламент', payload: 'Все новые менеджеры обязаны проходить недельное обучение перед допуском к звонкам.',
    source: '«а может новеньких неделю обучать перед звонками? — хорошая идея, но давай обсудим на следующей встрече, пока не утверждаем».',
    expect: 'reject', why: 'идея, явно НЕ утверждена («не утверждаем»)' },
];

const SYS_A: Record<Stance, string> = {
  critic: [
    'Ты — строгий критик-аудитор знаний компании. Решаешь, должна ли карточка быть канонизирована в постоянную память компании.',
    'Default — reject при любом сомнении. Голосуй reject, если формулировка расплывчата, не обоснована фактами, противоречит здравому смыслу, дублирует существующее знание или источник вызывает сомнение.',
    'Verdict строго: accept | reject. Reasoning — до 200 слов. Верни JSON: {"verdict":"accept|reject","reasoning":"...","confidence":0..1}.',
  ].join('\n'),
  supporter: [
    'Ты — поддерживающий арбитр-куратор знаний компании. Решаешь, должна ли карточка быть канонизирована в постоянную память компании.',
    'Default — accept при наличии осмысленного, обоснованного содержания. Сомнения трактуй в пользу карточки, если нет явных противоречий или вреда.',
    'Verdict строго: accept | reject. Reasoning — до 200 слов. Верни JSON: {"verdict":"accept|reject","reasoning":"...","confidence":0..1}.',
  ].join('\n'),
  neutral: [
    'Ты — нейтральный арбитр качества знаний компании. Взвесь pro и contra канонизации карточки одинаково: ни критик, ни сторонник.',
    'Оцени: корректна ли карточка, обоснована ли фактами, достаточно ли ясна формулировка, чтобы стать каноническим знанием компании.',
    'Verdict строго: accept | reject. Reasoning — до 200 слов. Верни JSON: {"verdict":"accept|reject","reasoning":"...","confidence":0..1}.',
  ].join('\n'),
};

const STANCE_C: Record<Stance, string> = {
  critic: 'Твоя роль в разборе — СТРОГИЙ КРИТИК: ищи причины НЕ канонизировать. Но отвергай только по фактам из первоисточника, а не из-за их отсутствия.',
  supporter: 'Твоя роль в разборе — ЗАЩИТНИК: ищи причины канонизировать, если первоисточник реально подтверждает карточку.',
  neutral: 'Твоя роль в разборе — НЕЙТРАЛЬНЫЙ АРБИТР: взвесь за и против по первоисточнику одинаково.',
};
const SYS_C_BASE = [
  'Ты — арбитр качества памяти компании Кора. Твоя задача — решить, можно ли занести карточку знания в постоянную память компании, на основании ПЕРВОИСТОЧНИКА (фрагмента встречи), из которого карточка извлечена.',
  'Зачем это важно: память компании кормит ответы сотрудникам, отчёты руководителю и цифровых двойников. Ложный «факт» хуже его отсутствия — ему будут доверять. Поэтому в память идёт только то, что первоисточник реально подтверждает как СОСТОЯВШЕЕСЯ решение/факт/правило.',
  'Канонизируй (accept), если в первоисточнике это: (1) принято/утверждено/согласовано (а не предложено и отвергнуто, не обсуждается, не шутка); (2) сформулировано в карточке без потери условий и оговорок из источника; (3) реквизиты (числа, даты, имена) в карточке совпадают с источником.',
  'Отклоняй (reject), если в первоисточнике: предложение отвергли или отложили; это гипотеза/риторика/шутка; карточка потеряла условие («если…») и стала опасно-безусловной; формулировка расплывчата; реквизит расходится с источником.',
  'ОБЯЗАТЕЛЬНО: обоснуй вердикт короткой ЦИТАТОЙ из первоисточника (поле quote). Если в источнике нет опоры для карточки — это само по себе повод reject.',
  'Self-check перед ответом: подтверждает ли цитата именно то, что написано в карточке? Не отвергаешь ли ты из-за нехватки контекста, которого на деле достаточно? Не принимаешь ли отклонённое/обсуждаемое за решённое?',
  'Verdict строго: accept | reject. Верни JSON: {"verdict":"accept|reject","quote":"цитата из источника","reasoning":"до 60 слов","confidence":0..1}.',
].join('\n');

function userA(c: Card): string {
  return `Карточка (${c.type}): «${c.payload}»\nКорректна, обоснована и должна быть канонизирована в память компании? Ответь JSON.`;
}
function userBC(c: Card): string {
  return `Первоисточник (фрагмент встречи, откуда извлечена карточка):\n${c.source}\n\nКарточка (${c.type}): «${c.payload}»\nДолжна ли эта карточка быть канонизирована в память компании? Ответь JSON.`;
}

async function vote(system: string, user: string): Promise<{ verdict: string; confidence: number } | null> {
  try {
    const r = await client.chat.completions.create({
      model: MODEL, stream: false, temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user + '\nВерни строго JSON.' }],
    });
    const txt = r.choices?.[0]?.message?.content ?? '';
    const j = JSON.parse(txt) as { verdict?: string; confidence?: number };
    const v = String(j.verdict ?? '').toLowerCase().includes('accept') ? 'accept' : 'reject';
    return { verdict: v, confidence: typeof j.confidence === 'number' ? j.confidence : 0.5 };
  } catch (e) {
    process.stderr.write(`  vote err: ${e instanceof Error ? e.message : String(e)}\n`);
    return null;
  }
}

async function judge(c: Card, variant: Variant): Promise<'accept' | 'reject' | 'error'> {
  const stances: Stance[] = ['critic', 'supporter', 'neutral'];
  const votes = await Promise.all(stances.map((s) => {
    if (variant === 'A') return vote(SYS_A[s], userA(c));
    if (variant === 'B') return vote(SYS_A[s], userBC(c));
    return vote(`${SYS_C_BASE}\n${STANCE_C[s]}`, userBC(c));
  }));
  const ok = votes.filter((v): v is { verdict: string; confidence: number } => v !== null);
  if (ok.length === 0) return 'error';
  const acc = ok.filter((v) => v.verdict === 'accept').length;
  return acc > ok.length / 2 ? 'accept' : 'reject';
}

async function main(): Promise<void> {
  if (!process.env.DEEPSEEK_API_KEY) { process.stderr.write('Нет DEEPSEEK_API_KEY (--env-file)\n'); process.exit(1); }
  process.stdout.write(`Модель: ${MODEL}\nКарточек: ${CARDS.length}, варианты A/B/C, 3 голоса\n\n`);
  const variants: Variant[] = ['A', 'B', 'C'];
  const score: Record<Variant, { right: number; falseAccept: number; falseReject: number }> =
    { A: { right: 0, falseAccept: 0, falseReject: 0 }, B: { right: 0, falseAccept: 0, falseReject: 0 }, C: { right: 0, falseAccept: 0, falseReject: 0 } };

  const head = 'карточка'.padEnd(38) + 'ждём'.padEnd(8) + 'A'.padEnd(9) + 'B'.padEnd(9) + 'C';
  process.stdout.write(head + '\n' + '─'.repeat(head.length) + '\n');

  for (const c of CARDS) {
    const res: Record<Variant, string> = { A: '', B: '', C: '' };
    for (const v of variants) {
      const r = await judge(c, v);
      res[v] = r;
      if (r !== 'error') {
        if (r === c.expect) score[v].right++;
        else if (r === 'accept') score[v].falseAccept++;
        else score[v].falseReject++;
      }
    }
    const mark = (r: string) => (r === c.expect ? `${r} ✓` : `${r} ✗`);
    process.stdout.write(
      `${c.payload.slice(0, 36).padEnd(38)}${c.expect.padEnd(8)}${mark(res.A).padEnd(9)}${mark(res.B).padEnd(9)}${mark(res.C)}\n`,
    );
  }

  process.stdout.write('\n=== ИТОГ (из ' + CARDS.length + ') ===\n');
  for (const v of variants) {
    const s = score[v];
    process.stdout.write(
      `Вариант ${v}: верно ${s.right}/${CARDS.length}  | ложно ПРИНЯТО (мусор в память): ${s.falseAccept}  | ложно ОТКЛОНЕНО (хорошее к людям): ${s.falseReject}\n`,
    );
  }
}
main().catch((e: unknown) => { process.stderr.write(String(e) + '\n'); process.exit(1); });
