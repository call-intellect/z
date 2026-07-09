const BASE = (process.env.DIAG_API_BASE ?? 'https://korateam.ru').replace(/\/+$/, '');
const EMAIL = process.env.DIAG_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.DIAG_ADMIN_PASSWORD ?? '';

function die(msg: string, code = 1): never {
  process.stderr.write(`\n✗ ${msg}\n`);
  process.exit(code);
}

let SESSION_COOKIE = '';

async function login(): Promise<void> {
  if (!EMAIL || !PASSWORD) {
    die('Нет DIAG_ADMIN_EMAIL/DIAG_ADMIN_PASSWORD — запускай с --env-file=.env из корня.');
  }
  const res = await fetch(`${BASE}/api/v1/auth/admin-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) die(`Логин не прошёл (${res.status}).`);
  const setCookies =
    typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (res.headers as { getSetCookie: () => string[] }).getSetCookie()
      : ([res.headers.get('set-cookie')].filter(Boolean) as string[]);
  for (const c of setCookies) {
    const m = /(?:^|;\s*)z_session=([^;]+)/.exec(c);
    if (m) SESSION_COOKIE = `z_session=${m[1]}`;
  }
  if (!SESSION_COOKIE) die('Логин прошёл, но cookie z_session не пришла.');
}

async function getMeeting(id: string): Promise<{ status?: string } | null> {
  const res = await fetch(`${BASE}/admin/api/v1/meetings/${encodeURIComponent(id)}`, {
    headers: { accept: 'application/json', cookie: SESSION_COOKIE },
  });
  if (!res.ok) return null;
  return (await res.json()) as { status?: string };
}

async function forceFinish(id: string): Promise<void> {
  await login();

  const before = await getMeeting(id);
  process.stdout.write(`\nВстреча ${id}\n  статус ДО: ${before?.status ?? '—'}\n`);
  if (!before) die(`Встреча ${id} не найдена (или нет прав).`);

  process.stdout.write('  → POST /admin/api/v1/meetings/:id/force-finish ...\n');
  const res = await fetch(`${BASE}/admin/api/v1/meetings/${encodeURIComponent(id)}/force-finish`, {
    method: 'POST',
    headers: { accept: 'application/json', cookie: SESSION_COOKIE },
  });
  const body = await res.text().catch(() => '');
  if (!res.ok) die(`force-finish вернул ${res.status}: ${body.slice(0, 400)}`);

  process.stdout.write(`  ответ: ${body}\n`);
  const after = await getMeeting(id);
  process.stdout.write(`  статус ПОСЛЕ: ${after?.status ?? '—'}\n`);
  process.stdout.write(
    '\nДальше запись сбросится в S3 (egress_ended) → recording_ready → транскрибация → отчёт.\n' +
      `Наблюдать: bun --env-file=.env backend/scripts/diag.ts trace --meeting ${id}\n\n`,
  );
}

const id = process.argv[2];
if (!id) die('Использование: bun --env-file=.env backend/scripts/force-finish-meeting.ts <meetingId>');
void forceFinish(id);
