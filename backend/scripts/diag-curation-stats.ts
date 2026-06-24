const BASE = (process.env.DIAG_API_BASE ?? 'https://korateam.ru').replace(/\/+$/, '');
const EMAIL = process.env.DIAG_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.DIAG_ADMIN_PASSWORD ?? '';
const ORG_ID = process.argv[2] ?? process.env.DIAG_ORG_ID ?? '';

type Json = Record<string, unknown>;
function die(m: string): never { process.stderr.write(`\n✗ ${m}\n`); process.exit(1); }
let COOKIE = '';

async function login(): Promise<void> {
  if (!EMAIL || !PASSWORD) die('Нет DIAG_ADMIN_EMAIL/PASSWORD (--env-file=c:/work/z/.env)');
  const res = await fetch(`${BASE}/api/v1/auth/admin-login`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) die(`Логин ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const cookies = typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
    ? (res.headers as { getSetCookie: () => string[] }).getSetCookie()
    : ([res.headers.get('set-cookie')].filter(Boolean) as string[]);
  for (const c of cookies) { const m = /(?:^|;\s*)z_session=([^;]+)/.exec(c); if (m) COOKIE = `z_session=${m[1]}`; }
  if (!COOKIE) die('Нет cookie');
}

async function count(path: string, status?: string): Promise<number> {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('limit', '1');
  if (status) url.searchParams.set('status', status);
  const headers: Record<string, string> = { accept: 'application/json', cookie: COOKIE };
  if (ORG_ID) headers['x-org-id'] = ORG_ID;
  const res = await fetch(url, { headers });
  if (!res.ok) return -1;
  const data = (await res.json()) as Json;
  const t = (data as { total?: number }).total;
  if (typeof t === 'number') return t;
  const items = (data as { items?: unknown[] }).items;
  return Array.isArray(items) ? items.length : -1;
}

async function main(): Promise<void> {
  if (!ORG_ID) die('Укажи orgId первым аргументом');
  await login();
  process.stdout.write(`\n=== Статусы по Org ${ORG_ID} ===\n`);

  process.stdout.write('\n● Карточки курации (/curation/queue):\n');
  for (const s of ['pending', 'decided', 'expired', 'cancelled']) {
    process.stdout.write(`  ${s}: ${await count('/api/v1/curation/queue', s)}\n`);
  }
  process.stdout.write('\n● Конфликты (/curation/conflicts):\n');
  for (const s of ['open', 'resolved', 'dismissed']) {
    process.stdout.write(`  ${s}: ${await count('/api/v1/curation/conflicts', s)}\n`);
  }
  process.stdout.write('\n● Входящие задачи (/intake):\n');
  for (const s of ['pending', 'accepted', 'rejected']) {
    process.stdout.write(`  ${s}: ${await count('/api/v1/intake', s)}\n`);
  }
}
main().catch((e: unknown) => die(e instanceof Error ? e.message : String(e)));
