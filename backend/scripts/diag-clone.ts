const BASE = (process.env.DIAG_API_BASE ?? 'https://korateam.ru').replace(/\/+$/, '');
const EMAIL = process.env.DIAG_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.DIAG_ADMIN_PASSWORD ?? '';

function die(msg: string): never {
  process.stderr.write(`\n[diag-clone] ${msg}\n`);
  process.exit(1);
}

let cookie = '';

async function login(): Promise<void> {
  if (!EMAIL || !PASSWORD) die('DIAG_ADMIN_EMAIL/DIAG_ADMIN_PASSWORD не видны — запускай с --env-file=c:/work/z/.env');
  const res = await fetch(`${BASE}/api/v1/auth/admin-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) die(`Логин не прошёл (${res.status}): ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const raw =
    typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (res.headers as { getSetCookie: () => string[] }).getSetCookie()
      : ([res.headers.get('set-cookie')].filter(Boolean) as string[]);
  for (const c of raw) {
    const m = /(?:^|;\s*)z_session=([^;]+)/.exec(c);
    if (m) cookie = `z_session=${m[1]}`;
  }
  if (!cookie) die('Логин ок, но z_session не пришла');
}

function headers(orgId?: string): Record<string, string> {
  const h: Record<string, string> = { accept: 'application/json', cookie };
  if (orgId) h['x-org-id'] = orgId;
  return h;
}

async function runCron(name: string): Promise<void> {
  await login();
  const res = await fetch(`${BASE}/api/v1/admin/crons/${encodeURIComponent(name)}/run`, {
    method: 'POST',
    headers: { ...headers(), 'content-type': 'application/json' },
    body: '{}',
  });
  const text = await res.text().catch(() => '');
  process.stdout.write(`[run-cron ${name}] HTTP ${res.status}\n${text}\n`);
  if (!res.ok) process.exit(1);
}

async function listCrons(): Promise<void> {
  await login();
  const res = await fetch(`${BASE}/api/v1/admin/crons`, { headers: headers() });
  const txt = await res.text();
  try {
    const arr = JSON.parse(txt) as Array<{ name: string; expression: string; lastRunAt: string | null }>;
    for (const c of arr) process.stdout.write(`${c.name}\t${c.expression}\tlast=${c.lastRunAt ?? '—'}\n`);
  } catch {
    process.stdout.write(txt.slice(0, 8000) + '\n');
  }
}

async function getJson(path: string, orgId?: string): Promise<void> {
  await login();
  const res = await fetch(`${BASE}${path}`, { headers: headers(orgId) });
  const text = await res.text().catch(() => '');
  process.stdout.write(`[GET ${path}] HTTP ${res.status}\n`);
  try {
    process.stdout.write(JSON.stringify(JSON.parse(text), null, 2) + '\n');
  } catch {
    process.stdout.write(text.slice(0, 4000) + '\n');
  }
}

const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = argv[1];
const org = process.env.DIAG_ORG_ID || argv[2];

(async () => {
  if (cmd === 'run-cron') await runCron(arg ?? die('нужно имя cron'));
  else if (cmd === 'list-crons') await listCrons();
  else if (cmd === 'skill-role') await getJson(`/api/v1/clones/roles/${arg}/skill-profile`, org);
  else if (cmd === 'skill-person') await getJson(`/api/v1/clones/persons/${arg}/skill-profile`, org);
  else if (cmd === 'list-clones') await getJson(`/api/v1/clones`, org);
  else if (cmd === 'get') await getJson(arg ?? die('нужен путь'), org);
  else die('Команды: run-cron <name> | list-crons | skill-role <roleId> | skill-person <personId> | list-clones | get <path>  (org: DIAG_ORG_ID или 3-й арг)');
})();
