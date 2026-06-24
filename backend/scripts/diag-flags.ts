const BASE = (process.env.DIAG_API_BASE ?? 'https://korateam.ru').replace(/\/+$/, '');
const EMAIL = process.env.DIAG_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.DIAG_ADMIN_PASSWORD ?? '';
const ORG = process.argv[2] ?? '';
type J = Record<string, unknown>;
function die(m: string): never { process.stderr.write(`\n✗ ${m}\n`); process.exit(1); }
let COOKIE = '';

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
async function getKey(key: string): Promise<string> {
  const u = new URL(`${BASE}/api/v1/admin/settings/${encodeURIComponent(key)}`);
  const h: Record<string, string> = { accept: 'application/json', cookie: COOKIE };
  if (ORG) h['x-org-id'] = ORG;
  const r = await fetch(u, { headers: h });
  if (!r.ok) return `(${r.status})`;
  const d = (await r.json()) as J;
  const val = (d as { value?: unknown; effectiveValue?: unknown; resolved?: unknown }).value
    ?? (d as { effectiveValue?: unknown }).effectiveValue ?? (d as { resolved?: unknown }).resolved ?? d;
  const src = (d as { source?: unknown }).source;
  return `${JSON.stringify(val)}${src ? `  [источник: ${String(src)}]` : ''}`;
}

async function main(): Promise<void> {
  await login();
  process.stdout.write(`\n=== Флаги (Org ${ORG || 'global'}) ===\n`);
  const keys = [
    'subjectMemory.enabled',
    'subjectMemory.retrieveBeforeAskEnabled',
    'subjectMemory.shadowToCanaryMinConfirm',
    'subjectMemory.matchMinSimilarity',
    'subjectMemory.suppressMinConfidence',
    'probe.existenceConfirmEnabled',
    'taskRouting.enabled',
    'tracker.assigneeClarifyEnabled',
  ];
  for (const k of keys) process.stdout.write(`  ${k.padEnd(42)} = ${await getKey(k)}\n`);

  process.stdout.write('\n=== Метрики subject_memory / probe (из /metrics) ===\n');
  const mr = await fetch(`${BASE}/metrics`, { headers: { cookie: COOKIE } }).catch(() => null);
  if (!mr || !mr.ok) { process.stdout.write(`  /metrics недоступен (${mr ? mr.status : 'err'})\n`); return; }
  const text = await mr.text();
  const lines = text.split('\n').filter((l) =>
    /subject_memory|probe_/.test(l) && !l.startsWith('#') && !/\s0$/.test(l));
  if (lines.length === 0) process.stdout.write('  нет ненулевых subject_memory_* / probe_* метрик\n');
  for (const l of lines.slice(0, 40)) process.stdout.write(`  ${l}\n`);
}
main().catch((e: unknown) => die(e instanceof Error ? e.message : String(e)));
