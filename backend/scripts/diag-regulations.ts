const BASE = (process.env.DIAG_API_BASE ?? 'https://korateam.ru').replace(/\/+$/, '');
const EMAIL = process.env.DIAG_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.DIAG_ADMIN_PASSWORD ?? '';

type Json = Record<string, unknown>;

function die(msg: string): never {
  process.stderr.write(`\n✗ ${msg}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
let ORG = '';
let OUT = '';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--org') ORG = argv[++i] ?? '';
  else if (argv[i] === '--out') OUT = argv[++i] ?? '';
}
if (!ORG) die('Укажи --org <tenantId>');

let COOKIE = '';

async function login(): Promise<void> {
  if (!EMAIL || !PASSWORD) die('Нет DIAG_ADMIN_EMAIL/PASSWORD (запускай с --env-file=c:/work/z/.env)');
  const res = await fetch(`${BASE}/api/v1/auth/admin-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) die(`Логин не прошёл (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const setCookies =
    typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (res.headers as { getSetCookie: () => string[] }).getSetCookie()
      : ([res.headers.get('set-cookie')].filter(Boolean) as string[]);
  for (const c of setCookies) {
    const m = /(?:^|;\s*)z_session=([^;]+)/.exec(c);
    if (m) COOKIE = `z_session=${m[1]}`;
  }
  if (!COOKIE) die('cookie z_session не пришла');
}

async function get<T = Json>(path: string): Promise<T> {
  if (!COOKIE) await login();
  const res = await fetch(`${BASE}${path}`, {
    headers: { accept: 'application/json', cookie: COOKIE, 'x-org-id': ORG },
  });
  if (!res.ok) die(`Ошибка ${res.status} на ${path}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

async function listAll(kind: string): Promise<Json[]> {
  const out: Json[] = [];
  let page = 1;
  for (;;) {
    const data = await get<{ items?: Json[]; totalPages?: number }>(
      `/api/v1/regulations?kind=${kind}&limit=100&page=${page}`,
    );
    const items = data.items ?? [];
    out.push(...items);
    if (page >= (data.totalPages ?? 1) || items.length === 0) break;
    page++;
  }
  return out;
}

async function listTemplates(): Promise<Json[]> {
  try {
    const data = await get<{ items?: Json[] } | Json[]>(`/api/v1/processes/templates?limit=200`);
    return (data as { items?: Json[] }).items ?? (Array.isArray(data) ? (data as Json[]) : []);
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  await login();
  const summary = await get(`/api/v1/regulations/summary`).catch(() => ({}));
  const regulations = await listAll('regulation');
  const processes = await listAll('process');
  const policies = await listAll('policy');
  const instructions = await listAll('instruction');
  const standards = await listAll('standard');
  const templates = await listTemplates();

  const bundle = {
    org: ORG,
    fetchedAtNote: 'read-only export via admin-login',
    summary,
    counts: {
      regulation: regulations.length,
      process: processes.length,
      policy: policies.length,
      instruction: instructions.length,
      standard: standards.length,
      processTemplate: templates.length,
    },
    regulations,
    processes,
    policies,
    instructions,
    standards,
    templates,
  };

  if (OUT) {
    await Bun.write(OUT, JSON.stringify(bundle, null, 2));
    process.stderr.write(`Записано в ${OUT}\n`);
  }

  process.stdout.write('=== СВОДКА ===\n');
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  process.stdout.write('=== СЧЁТЧИКИ ===\n');
  process.stdout.write(JSON.stringify(bundle.counts, null, 2) + '\n');

  const line = (k: string, arr: Json[]): void => {
    process.stdout.write(`\n=== ${k} (${arr.length}) ===\n`);
    for (const r of arr) {
      const name = (r['name'] ?? r['title'] ?? '—') as string;
      const st = (r['statement'] ?? r['summary'] ?? '') as string;
      process.stdout.write(
        `  • [${r['kind'] ?? k}] ${name}  | status=${r['status'] ?? '-'} conf=${r['confidence'] ?? '-'} trust=${r['trustTier'] ?? '-'} | ${String(st).slice(0, 90)}\n`,
      );
    }
  };
  line('regulation', regulations);
  line('process', processes);
  line('policy', policies);
  line('instruction', instructions);
  line('standard', standards);
  line('processTemplate', templates);
}

main().catch((err: unknown) => die(err instanceof Error ? err.message : String(err)));
