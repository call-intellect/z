const BASE = (process.env.DIAG_API_BASE ?? 'https://korateam.ru').replace(/\/+$/, '');
const EMAIL = process.env.DIAG_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.DIAG_ADMIN_PASSWORD ?? '';

if (!EMAIL || !PASSWORD) {
  process.stderr.write(
    '\n✗ Нет DIAG_ADMIN_EMAIL/DIAG_ADMIN_PASSWORD (запускай с --env-file=c:/work/z/.env)\n',
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const loginRes = await fetch(`${BASE}/api/v1/auth/admin-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginRes.ok) {
    process.stderr.write(`\n✗ Логин не прошёл (${loginRes.status})\n`);
    process.exit(1);
  }
  const setCookies =
    typeof (loginRes.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (loginRes.headers as { getSetCookie: () => string[] }).getSetCookie()
      : ([loginRes.headers.get('set-cookie')].filter(Boolean) as string[]);
  let cookie = '';
  for (const c of setCookies) {
    const m = /(?:^|;\s*)z_session=([^;]+)/.exec(c);
    if (m) cookie = `z_session=${m[1]}`;
  }
  if (!cookie) {
    process.stderr.write('\n✗ Нет cookie z_session\n');
    process.exit(1);
  }

  const res = await fetch(`${BASE}/api/v1/admin/ai-models`, {
    headers: { accept: 'application/json', cookie },
  });
  if (!res.ok) {
    process.stderr.write(
      `\n✗ ${res.status} на /admin/ai-models: ${(await res.text()).slice(0, 300)}\n`,
    );
    process.exit(1);
  }
  const data = (await res.json()) as { items?: Array<Record<string, any>> };
  const items = data.items ?? [];

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(items, null, 2) + '\n');
    return;
  }

  const fmt = (t: any): string =>
    t && t.providerName ? `${t.providerName}:${t.model ?? '—'}` : '—';
  process.stdout.write(`Всего taskType-маршрутов: ${items.length}\n\n`);
  process.stdout.write(`taskType | primary | secondary | tertiary\n`);
  for (const it of items
    .slice()
    .sort((a, b) => String(a.taskType).localeCompare(String(b.taskType)))) {
    process.stdout.write(
      `${it.taskType} | ${fmt(it.primary)} | ${fmt(it.secondary)} | ${fmt(it.tertiary)}\n`,
    );
  }
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
