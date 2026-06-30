const BASE = (process.env.DIAG_API_BASE ?? 'https://korateam.ru').replace(/\/+$/, '');
const EMAIL = process.env.DIAG_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.DIAG_ADMIN_PASSWORD ?? '';

if (!EMAIL || !PASSWORD) {
  process.stderr.write('Нет DIAG_ADMIN_EMAIL/DIAG_ADMIN_PASSWORD. Запускай с --env-file=<корневой .env>\n');
  process.exit(1);
}

let SESSION_COOKIE = '';

async function login(): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/auth/admin-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    process.stderr.write(`Логин не прошёл (${res.status}): ${body.slice(0, 300)}\n`);
    process.exit(1);
  }
  const setCookies =
    typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (res.headers as { getSetCookie: () => string[] }).getSetCookie()
      : ([res.headers.get('set-cookie')].filter(Boolean) as string[]);
  for (const c of setCookies) {
    const m = /(?:^|;\s*)z_session=([^;]+)/.exec(c);
    if (m) SESSION_COOKIE = `z_session=${m[1]}`;
  }
  if (!SESSION_COOKIE) {
    process.stderr.write('Логин прошёл, но z_session cookie не пришла\n');
    process.exit(1);
  }
}

async function api(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie: SESSION_COOKIE, accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) {
    process.stderr.write(`${path} → ${res.status}: ${text.slice(0, 300)}\n`);
    return null;
  }
  return JSON.parse(text);
}

await login();

console.log('\n=== OVERVIEW (Bitrix + ChatBox по всем org) ===');
const overview = await api('/api/v1/admin/integrations/sources/overview');
console.log(JSON.stringify(overview, null, 2));

console.log('\n=== RUNS (последние 100 прогонов) ===');
const runs = await api('/api/v1/admin/integrations/sources/runs?limit=100');
console.log(JSON.stringify(runs, null, 2));
