import OpenAI from 'openai';

const BASE = (process.env.DIAG_API_BASE ?? 'https://korateam.ru').replace(/\/+$/, '');
const EMAIL = process.env.DIAG_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.DIAG_ADMIN_PASSWORD ?? '';
const ORG = process.argv[2] ?? '';
type J = Record<string, unknown>;
function die(m: string): never { process.stderr.write(`\n✗ ${m}\n`); process.exit(1); }
let COOKIE = '';

const llm = new OpenAI({ baseURL: process.env.DEEPSEEK_BASE_URL ?? '', apiKey: process.env.DEEPSEEK_API_KEY ?? '' });
const MODEL = 'deepseek-v4-pro';

async function login(): Promise<void> {
  const r = await fetch(`${BASE}/api/v1/auth/admin-login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!r.ok) die(`login ${r.status}`);
  const cs = typeof (r.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
    ? (r.headers as { getSetCookie: () => string[] }).getSetCookie()
    : ([r.headers.get('set-cookie')].filter(Boolean) as string[]);
  for (const c of cs) { const m = /z_session=([^;]+)/.exec(c); if (m) COOKIE = `z_session=${m[1]}`; }
  if (!COOKIE) die('no cookie');
}
async function get(path: string, q: Record<string, string | number> = {}): Promise<J> {
  const u = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, String(v));
  const r = await fetch(u, { headers: { accept: 'application/json', cookie: COOKIE, 'x-org-id': ORG } });
  if (!r.ok) die(`${r.status} ${path}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return (await r.json()) as J;
}
function txt(o: J, keys: string[]): string {
  for (const k of keys) { const v = o[k]; if (typeof v === 'string' && v.trim()) return v.trim(); }
  return '';
}
async function complete(system: string, user: string): Promise<string> {
  const r = await llm.chat.completions.create({
    model: MODEL, stream: false, temperature: 0.3,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  return r.choices?.[0]?.message?.content ?? '';
}

async function main(): Promise<void> {
  if (!ORG) die('orgId первым аргументом');
  if (!process.env.DEEPSEEK_API_KEY) die('нет DEEPSEEK_API_KEY');
  await login();

  const dec = await get('/api/v1/decisions', { limit: 40 });
  const decItems = ((dec as { items?: J[] }).items ?? []) as J[];
  const decisions = decItems.map((d) => txt(d, ['statement', 'title', 'summary', 'text', 'description'])).filter(Boolean);
  process.stdout.write(`Решений получено: ${decisions.length}\n`);

  process.stdout.write('\n════ ЧЕРНОВИК МИССИИ/ВИДЕНИЯ/СТРАТЕГИИ (из решений компании) ════\n\n');
  if (decisions.length < 3) {
    process.stdout.write('Мало решений для черновика.\n');
  } else {
    const sys = [
      'Ты помогаешь руководителю сформулировать ЧЕРНОВИК миссии, видения и стратегии компании, опираясь ТОЛЬКО на её зафиксированные решения и обсуждения.',
      'Не выдумывай факты, которых нет в данных. Если сигналов мало — честно отметь, чего не хватает.',
      'Это черновик для правки человеком. Пиши по-русски, кратко, без английских слов.',
    ].join('\n');
    const user = `Зафиксированные решения компании:\n${decisions.slice(0, 40).map((d, i) => `${i + 1}. ${d}`).join('\n')}\n\nСобери черновик:\n— Миссия (1–2 предложения)\n— Видение (1–2 предложения)\n— Стратегия (2–3 пункта)`;
    process.stdout.write(await complete(sys, user) + '\n');
  }

  const exp = await get('/api/v1/experiments', { limit: 40 }).catch(() => ({}) as J);
  const expItems = ((exp as { items?: J[] }).items ?? []) as J[];
  const bitrix = expItems.find((e) => /битрикс|bitrix|восстановлен/i.test(JSON.stringify(e))) ?? expItems[0];
  process.stdout.write('\n════ ЧЕРНОВИК УРОКА ЭКСПЕРИМЕНТА ════\n\n');
  if (!bitrix) {
    process.stdout.write('Экспериментов не найдено.\n');
  } else {
    const name = txt(bitrix, ['title', 'name', 'hypothesis']);
    const result = txt(bitrix, ['result', 'outcome', 'resultSummary', 'description', 'summary']);
    process.stdout.write(`Эксперимент: ${name}\nРезультат (из памяти): ${result.slice(0, 300) || '—'}\n\n— Черновик урока:\n`);
    const sys = 'Ты помогаешь сформулировать УРОК из эксперимента компании по его результату. Не выдумывай. Кратко, по-русски, без английских слов.';
    const user = `Эксперимент: ${name}\nЧто известно: ${JSON.stringify(bitrix).slice(0, 1200)}\n\nСформулируй урок: что сработало/не сработало и что вынести на будущее (2–4 предложения). Если данных мало — отметь, чего не хватает.`;
    process.stdout.write(await complete(sys, user) + '\n');
  }
}
main().catch((e: unknown) => die(e instanceof Error ? e.message : String(e)));
