const BASE = (process.env.DIAG_API_BASE ?? 'https://korateam.ru').replace(/\/+$/, '');
const EMAIL = process.env.DIAG_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.DIAG_ADMIN_PASSWORD ?? '';
const ORG_ID = process.env.DIAG_ORG_ID ?? '';

type Json = Record<string, unknown>;

function die(msg: string, code = 1): never {
  process.stderr.write(`\n✗ ${msg}\n`);
  process.exit(code);
}

function requireCreds(): void {
  if (!EMAIL || !PASSWORD) {
    die(
      'Нет доступа: DIAG_ADMIN_EMAIL/DIAG_ADMIN_PASSWORD не видны. Они в КОРНЕВОМ c:/work/z/.env — ' +
        'запускай с флагом --env-file=c:/work/z/.env (без него Bun читает backend/.env, где их нет). ' +
        'DIAG_API_BASE=' +
        BASE,
    );
  }
}

interface Args {
  _: string[];
  flags: Record<string, string | boolean>;
}
function parseArgs(argv: string[]): Args {
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}
const str = (a: Args, k: string): string | undefined =>
  typeof a.flags[k] === 'string' ? (a.flags[k] as string) : undefined;
const num = (a: Args, k: string): number | undefined => {
  const v = str(a, k);
  return v === undefined ? undefined : Number(v);
};
const has = (a: Args, k: string): boolean => k in a.flags;

let SESSION_COOKIE = '';

async function login(): Promise<void> {
  requireCreds();
  const res = await fetch(`${BASE}/api/v1/auth/admin-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    die(
      `Логин не прошёл (${res.status}). Проверь email/пароль и что аккаунт role=admin. ${body.slice(0, 300)}`,
    );
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
    die('Логин прошёл, но cookie z_session не пришла — изменился формат сессии?');
  }
}

async function apiGet<T = Json>(
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  if (!SESSION_COOKIE) await login();
  const url = new URL(`${BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = { accept: 'application/json', cookie: SESSION_COOKIE };
  if (ORG_ID) headers['x-org-id'] = ORG_ID;
  const res = await fetch(url, { headers });
  if (res.status === 401) die('401 — сессия не принята (cookie протухла?). Перезапусти команду.');
  if (res.status === 403)
    die('403 — у аккаунта нет нужных прав (для логов/usage нужен isSuperAdmin=true).');
  if (res.status === 404) die(`404 — не найдено: ${url.pathname}${url.search}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    die(`Ошибка ${res.status} на ${url.pathname}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

function out(label: string, value: unknown): void {
  process.stdout.write(
    `${label}: ${value === null || value === undefined ? '—' : String(value)}\n`,
  );
}
function head(title: string): void {
  process.stdout.write(`\n=== ${title} ===\n`);
}
function trunc(v: unknown, n = 300): string {
  if (v === null || v === undefined) return '—';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}… (+${s.length - n})` : s;
}
function printJson(v: unknown): void {
  process.stdout.write(JSON.stringify(v, null, 2) + '\n');
}

async function cmdMeetings(a: Args): Promise<void> {
  const data = await apiGet(`/admin/api/v1/meetings`, {
    status: str(a, 'status'),
    type: str(a, 'type'),
    owner_id: str(a, 'owner'),
    limit: num(a, 'limit') ?? 20,
  });
  if (has(a, 'json')) return printJson(data);
  const items = (data as { items?: Array<Json> }).items ?? [];
  out('Всего', (data as { total?: number }).total ?? items.length);
  for (const m of items) {
    process.stdout.write(
      `  ${m['id']}  [${m['status']}/${m['type']}]  ${trunc(m['title'], 60)}  — ${m['ownerEmail']}  (${m['createdAt']})\n`,
    );
  }
}

async function cmdReport(a: Args): Promise<void> {
  const id = str(a, 'meeting') ?? a._[1];
  if (!id) die('Укажи --meeting <id>');
  const data = await apiGet<Json>(`/admin/api/v1/meetings/${id}`);
  if (has(a, 'json')) return printJson(data);
  const ai = (data as { aiResult?: Json | null }).aiResult ?? null;
  const m = (data as { meeting?: Json }).meeting ?? {};
  head(`Отчёт встречи ${id}`);
  out('Статус встречи', m['status']);
  out('Причина сбоя', m['failureReason']);
  if (!ai) return out('aiResult', 'отсутствует (отчёт не сгенерирован)');
  out('Модель', ai['modelUsed']);
  head('summary');
  process.stdout.write(`${trunc(ai['summary'], 4000)}\n`);
  head('customOutputMd');
  process.stdout.write(`${trunc(ai['customOutputMd'], 4000)}\n`);
  head('structuredData');
  process.stdout.write(`${trunc(ai['structuredData'], 4000)}\n`);
  head('followUpEmail');
  process.stdout.write(`${trunc(ai['followUpEmail'], 2000)}\n`);
  head('summaryFast');
  process.stdout.write(`${trunc(ai['summaryFast'], 2000)}\n`);
}

async function cmdLogs(a: Args): Promise<void> {
  const data = await apiGet(`/api/v1/platform/logs`, {
    level: str(a, 'level'),
    levelAtLeast: str(a, 'at-least'),
    pipeline: str(a, 'pipeline'),
    module: str(a, 'module'),
    traceId: str(a, 'trace'),
    search: str(a, 'search'),
    dateFrom: str(a, 'from'),
    dateTo: str(a, 'to'),
    limit: num(a, 'limit') ?? 50,
    offset: num(a, 'offset') ?? 0,
  });
  if (has(a, 'json')) return printJson(data);
  const items =
    (data as { items?: Array<Json> }).items ?? (Array.isArray(data) ? (data as Json[]) : []);
  out('Записей', items.length);
  for (const l of items) {
    process.stdout.write(
      `  ${l['createdAt']}  [${l['level']}] ${l['pipeline'] ?? l['category']}/${l['module'] ?? '-'}  ${trunc(
        l['message'],
        160,
      )}${l['errorMessage'] ? `  ⟂ ${trunc(l['errorMessage'], 120)}` : ''}\n`,
    );
  }
}

async function cmdChain(a: Args): Promise<void> {
  const trace = str(a, 'trace') ?? a._[1];
  if (!trace) die('Укажи --trace <traceId> (для встречи: mtg_<id встречи>)');
  const data = await apiGet(`/api/v1/platform/logs/chain`, {
    traceId: trace,
    limit: num(a, 'limit') ?? 500,
  });
  if (has(a, 'json')) return printJson(data);
  const items =
    (data as { items?: Array<Json> }).items ?? (Array.isArray(data) ? (data as Json[]) : []);
  head(`Цепочка ${trace} (${items.length} записей)`);
  for (const l of items) {
    process.stdout.write(
      `  ${l['createdAt']}  [${l['level']}] ${l['pipeline'] ?? l['category']}/${l['module'] ?? '-'}/${l['action'] ?? '-'}` +
        `${l['durationMs'] ? ` ${l['durationMs']}ms` : ''}  ${trunc(l['message'], 160)}` +
        `${l['errorMessage'] ? `  ⟂ ${trunc(l['errorMessage'], 160)}` : ''}\n`,
    );
  }
}

async function scanCallsByMeeting(meetingId: string, scan: number): Promise<Json[]> {
  const server = await apiGet<{ items?: Json[]; nextCursor?: string | null }>(
    `/api/v1/admin/usage/calls`,
    { meetingId, limit: Math.min(scan, 200) },
  ).catch((): { items?: Json[] } => ({ items: [] }));
  const serverItems = (server.items ?? []).filter((it) => it['meetingId'] === meetingId);
  if (serverItems.length > 0) return serverItems;

  const out: Json[] = [];
  let cursor: string | undefined;
  let fetched = 0;
  const pageSize = 100;
  while (fetched < scan) {
    const data = await apiGet<{ items?: Json[]; nextCursor?: string | null }>(
      `/api/v1/admin/usage/calls`,
      {
        limit: pageSize,
        cursor,
      },
    );
    const items = data.items ?? [];
    for (const it of items) if (it['meetingId'] === meetingId) out.push(it);
    fetched += items.length;
    cursor = data.nextCursor ?? undefined;
    if (!cursor || items.length === 0) break;
  }
  return out;
}

async function cmdLlmCalls(a: Args): Promise<void> {
  const id = str(a, 'meeting') ?? a._[1];
  if (!id) die('Укажи --meeting <id>');
  const scan = num(a, 'scan') ?? 300;
  const calls = await scanCallsByMeeting(id, scan);
  if (has(a, 'json')) return printJson(calls);
  head(`LLM/ASR-вызовы встречи ${id} (найдено ${calls.length} среди последних ~${scan})`);
  for (const c of calls) {
    process.stdout.write(
      `  ${c['createdAt']}  ${c['agentType'] ?? '-'}/${c['taskType'] ?? '-'}  ${c['provider']}:${c['model']}` +
        `  ${c['success'] ? 'ok' : 'FAIL'}  tier=${c['tier'] ?? '-'}${c['fallbackReason'] ? `(${c['fallbackReason']})` : ''}` +
        `  ${c['durationMs']}ms  $${c['costUsd']}  id=${c['id']}` +
        `${c['success'] ? '' : `  ⟂ ${trunc(c['errorText'], 160)}`}\n`,
    );
  }
  if (calls.length > 0) {
    process.stdout.write(
      `\nПодробно один вызов (промпт+ответ модели): bun run scripts/diag.ts call <id>\n`,
    );
  }
}

async function cmdCall(a: Args): Promise<void> {
  const id = str(a, 'id') ?? a._[1];
  if (!id) die('Укажи id вызова: diag.ts call <aiUsageLogId>');
  const data = await apiGet<Json>(`/api/v1/admin/usage/calls/${id}`);
  if (has(a, 'json')) return printJson(data);
  head(`Вызов ${id}`);
  out('provider:model', `${data['provider']}:${data['model']}`);
  out('agentType/taskType', `${data['agentType']}/${data['taskType']}`);
  out(
    'успех / tier / fallback',
    `${data['success']} / ${data['tier']} / ${data['fallbackReason'] ?? '—'}`,
  );
  out(
    'токены in/out/cached',
    `${data['inputTokens']}/${data['outputTokens']}/${data['cachedTokens']}`,
  );
  out('cost / latency', `$${data['costUsd']} / ${data['durationMs']}ms`);
  out('ошибка', data['errorText']);
  head('requestPreview (промпт)');
  process.stdout.write(`${trunc(data['requestPreview'], 8000)}\n`);
  head('responsePreview (ответ модели)');
  process.stdout.write(`${trunc(data['responsePreview'], 8000)}\n`);
}

async function cmdUsage(a: Args): Promise<void> {
  const data = await apiGet<{ items?: Json[]; nextCursor?: string | null }>(
    `/api/v1/admin/usage/calls`,
    {
      taskType: str(a, 'task'),
      userId: str(a, 'user'),
      meetingId: str(a, 'meeting'),
      limit: num(a, 'limit') ?? 30,
      cursor: str(a, 'cursor'),
    },
  );
  if (has(a, 'json')) return printJson(data);
  const items = data.items ?? [];
  head(`usage/calls (${items.length})${str(a, 'task') ? ` task=${str(a, 'task')}` : ''}`);
  const previewLen = num(a, 'preview') ?? 500;
  for (const c of items) {
    const user =
      (c['userEmail'] as string | undefined) ??
      ((c['user'] as { email?: string } | undefined)?.email ?? (c['userId'] as string | undefined));
    process.stdout.write(
      `  ${c['createdAt']}  ${c['taskType'] ?? '-'}  ${c['provider']}:${c['model']}  ${c['success'] ? 'ok' : 'FAIL'}  ${c['durationMs']}ms  user=${user ?? '-'}  id=${c['id']}\n`,
    );
    if (previewLen > 0) {
      const reqp = typeof c['requestPreview'] === 'string' ? c['requestPreview'] : '';
      const resp = typeof c['responsePreview'] === 'string' ? c['responsePreview'] : '';
      if (reqp) process.stdout.write(`      <- ${trunc(reqp, previewLen)}\n`);
      if (resp) process.stdout.write(`      -> ${trunc(resp, previewLen)}\n`);
    }
  }
  if (data.nextCursor) process.stdout.write(`\nЕщё есть: --cursor ${data.nextCursor}\n`);
}

async function cmdTrace(a: Args): Promise<void> {
  const id = str(a, 'meeting') ?? a._[1];
  if (!id) die('Укажи --meeting <id>');
  await login();
  const [meeting, chain, calls] = await Promise.all([
    apiGet<Json>(`/admin/api/v1/meetings/${id}`).catch((): null => null),
    apiGet<{ items?: Json[] }>(`/api/v1/platform/logs/chain`, {
      traceId: `mtg_${id}`,
      limit: num(a, 'logs-limit') ?? 500,
    }).catch((): { items?: Json[] } => ({ items: [] })),
    scanCallsByMeeting(id, num(a, 'calls-scan') ?? 300).catch((): Json[] => []),
  ]);

  if (has(a, 'json')) return printJson({ meeting, chain, calls });

  if (!meeting) die(`Встреча ${id} не найдена (или нет прав).`);
  const m = (meeting as { meeting?: Json }).meeting ?? {};
  const rs = (meeting as { reportStatuses?: Json }).reportStatuses ?? {};
  const ai = (meeting as { aiResult?: Json | null }).aiResult ?? null;
  const tr = (meeting as { transcript?: Json | null }).transcript ?? null;
  const chainItems = chain.items ?? [];
  const firstError =
    chainItems.find((l) => l['level'] === 'ERROR') ?? chainItems.find((l) => l['level'] === 'WARN');

  head(`Цепочка встречи ${id}`);
  out('Заголовок / тип', `${trunc(m['title'], 60)} / ${m['type']}`);
  out('Статус', m['status']);
  out('Причина сбоя', m['failureReason']);
  out('Транскрипт', tr ? `turns=${tr['hasTurns']} слов=${tr['totalWords']}` : 'нет');
  const av = (rs as { analyzeV2?: Json }).analyzeV2 ?? {};
  const rf = (rs as { reportFast?: Json }).reportFast ?? {};
  out('reportFast', `${rf['status'] ?? '—'}${rf['error'] ? ` ⟂ ${trunc(rf['error'], 120)}` : ''}`);
  out('analyzeV2', `${av['status'] ?? '—'}${av['error'] ? ` ⟂ ${trunc(av['error'], 120)}` : ''}`);
  out(
    'Отчёт (aiResult)',
    ai
      ? `есть — summary:${ai['summary'] ? 'да' : 'НЕТ'} structured:${ai['structuredData'] ? 'да' : 'нет'} ` +
          `custom:${ai['customOutputMd'] ? 'да' : 'нет'} fast:${ai['summaryFast'] ? 'да' : 'нет'} (модель ${ai['modelUsed']})`
      : 'ОТСУТСТВУЕТ',
  );

  head(`AI/ASR-вызовы (${calls.length})`);
  for (const c of calls) {
    process.stdout.write(
      `  ${c['agentType'] ?? '-'}/${c['taskType'] ?? '-'}  ${c['provider']}:${c['model']}  ${c['success'] ? 'ok' : 'FAIL'}` +
        `  tier=${c['tier'] ?? '-'}${c['fallbackReason'] ? `(${c['fallbackReason']})` : ''}  ${c['durationMs']}ms  $${c['costUsd']}  id=${c['id']}` +
        `${c['success'] ? '' : `  ⟂ ${trunc(c['errorText'], 140)}`}\n`,
    );
  }

  head(`Технический след: ${chainItems.length} записей`);
  if (firstError) {
    out(
      'Первая ошибка/предупреждение',
      `[${firstError['level']}] ${firstError['pipeline'] ?? firstError['category']}/${firstError['module'] ?? '-'}/${firstError['action'] ?? '-'} — ` +
        `${trunc(firstError['message'], 200)}${firstError['errorMessage'] ? ` ⟂ ${trunc(firstError['errorMessage'], 200)}` : ''}`,
    );
  } else {
    out('Ошибок в логах', 'не найдено (см. полный список ниже)');
  }
  const errors = chainItems.filter((l) => l['level'] === 'ERROR' || l['level'] === 'WARN');
  for (const l of errors.slice(0, 20)) {
    process.stdout.write(
      `  ${l['createdAt']}  [${l['level']}] ${l['pipeline'] ?? l['category']}/${l['module'] ?? '-'}/${l['action'] ?? '-'}  ` +
        `${trunc(l['message'], 160)}${l['errorMessage'] ? ` ⟂ ${trunc(l['errorMessage'], 160)}` : ''}\n`,
    );
  }
  process.stdout.write(`\nПолный след: bun run scripts/diag.ts chain --trace mtg_${id} --json\n`);
}

async function cmdGraph(a: Args): Promise<void> {
  const meeting = str(a, 'meeting') ?? a._[1];
  if (!meeting) die('Укажи --meeting <id встречи>');
  const data = await apiGet<Json>('/api/v1/platform/graph/materialization', {
    meetingId: meeting,
    ...(str(a, 'org') ? { orgId: str(a, 'org') } : {}),
  });
  if (has(a, 'json')) return printJson(data);

  const blockCount = (data as { blockCount?: number }).blockCount ?? 0;
  const sig = ((data as { signalTypeDistribution?: Record<string, number> })
    .signalTypeDistribution ?? {}) as Record<string, number>;
  const status = ((data as { statusDistribution?: Record<string, number> }).statusDistribution ??
    {}) as Record<string, number>;
  const mat = ((data as { materialized?: Record<string, number> }).materialized ?? {}) as Record<
    string,
    number
  >;
  const gaps = ((data as { gaps?: Array<Json> }).gaps ?? []) as Array<Json>;

  head(`Материализация графа из встречи ${meeting}`);
  out('Блоков (из встречи)', blockCount);
  head('Распределение signalType');
  const sigKeys = Object.keys(sig).sort((x, y) => (sig[y] ?? 0) - (sig[x] ?? 0));
  if (sigKeys.length === 0) {
    process.stdout.write('  — (нет блоков)\n');
  } else {
    for (const k of sigKeys) process.stdout.write(`  ${k}: ${sig[k]}\n`);
  }
  head('Распределение status');
  const stKeys = Object.keys(status).sort((x, y) => (status[y] ?? 0) - (status[x] ?? 0));
  if (stKeys.length === 0) {
    process.stdout.write('  — (нет блоков)\n');
  } else {
    for (const k of stKeys) process.stdout.write(`  ${k}: ${status[k]}\n`);
  }
  head('Материализовано');
  out('Decision', mat['decisions'] ?? 0);
  out('Idea', mat['ideas'] ?? 0);
  out('Goal', mat['goals'] ?? 0);
  if (gaps.length > 0) {
    head('⚠ РАСХОЖДЕНИЕ (сигнал есть, записи нет)');
    for (const g of gaps) {
      process.stdout.write(
        `  ⚠ ${g['type']}: блоков с сигналом ${g['blocksWithSignal']}, материализовано ${g['materialized']}\n`,
      );
    }
  } else {
    out('Расхождения', 'нет');
  }
}

async function cmdOrgs(a: Args): Promise<void> {
  const data = await apiGet(`/api/v1/admin/orgs`, {
    search: str(a, 'search'),
    period: str(a, 'period') ?? 'month',
    limit: num(a, 'limit') ?? 50,
  });
  if (has(a, 'json')) return printJson(data);
  const items =
    (data as { items?: Array<Json> }).items ?? (Array.isArray(data) ? (data as Json[]) : []);
  out('Всего', (data as { total?: number }).total ?? items.length);
  for (const o of items) {
    process.stdout.write(
      `  ${o['id']}  ${trunc(o['name'], 40)}  владелец: ${o['ownerEmail'] ?? o['ownerName'] ?? '—'}` +
        `  тариф: ${o['tier'] ?? '-'}  участников: ${o['memberCount'] ?? o['membersCount'] ?? '-'}\n`,
    );
  }
}

const HELP = `diag — read-only разбор прод-данных Коры. Команды:
  trace     --meeting <id>                 вся цепочка встречи (статус→отчёт→AI-вызовы→логи), где сломалось
  report    --meeting <id>                 контент отчёта (summary/structured/custom/followUp/fast)
  meetings  [--status --type --owner --limit]  список встреч
  orgs      [--search <текст> --limit]      список Org (id=tenantId → название + владелец)
  logs      [--level|--at-least --pipeline --module --search --from --to --limit --offset]
  chain     --trace <traceId|mtg_<id>>     полный технический след одной цепочки
  llm-calls --meeting <id> [--scan N]      AI/ASR-вызовы встречи (провайдер/модель/tier/успех)
  call      <aiUsageLogId>                 один вызов: промпт + ответ модели
  graph     --meeting <id> [--org <id>]   распределение signalType блоков встречи + счётчики Decision/Idea/Goal + расхождения
Любая команда + --json → сырой JSON. ENV: DIAG_API_BASE, DIAG_ADMIN_EMAIL, DIAG_ADMIN_PASSWORD, DIAG_ORG_ID.`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const a = parseArgs(argv);
  const cmd = a._[0];
  switch (cmd) {
    case 'trace':
      return cmdTrace(a);
    case 'report':
      return cmdReport(a);
    case 'meetings':
      return cmdMeetings(a);
    case 'orgs':
      return cmdOrgs(a);
    case 'logs':
      return cmdLogs(a);
    case 'chain':
      return cmdChain(a);
    case 'llm-calls':
      return cmdLlmCalls(a);
    case 'call':
      return cmdCall(a);
    case 'usage':
      return cmdUsage(a);
    case 'graph':
      return cmdGraph(a);
    case undefined:
    case 'help':
    case '--help':
      process.stdout.write(HELP + '\n');
      return;
    default:
      die(`Неизвестная команда: ${cmd}\n\n${HELP}`);
  }
}

main().catch((err: unknown) => die(err instanceof Error ? err.message : String(err)));
