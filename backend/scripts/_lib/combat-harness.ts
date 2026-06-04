/**
 * combat-harness — общие хелперы для боевого e2e-теста knowledge-core на
 * синтетике (см. plans/tz/2026-06-04-combat-test-harness.md).
 *
 * Внешний инжектор + поллер: НЕ поднимает свой Nest-контекст (иначе второй раз
 * зарегистрирует те же BullMQ-воркеры, что и запущенный backend, и будет
 * конкурировать за jobs). Пишет RawEvent/Meeting через Prisma и кладёт jobs в
 * Redis теми же jobId/именами, что прод-код (enqueueRawReceived → core.raw-events,
 * jobId `raw_<id>`), а обработку делает уже запущенный backend-процесс.
 *
 * Безопасность:
 *   - PrismaClient ТОЛЬКО через createPrismaClient() (Prisma 7 driver adapter).
 *   - Жёсткий prod-guard: отказ бить в не-localhost без ALLOW_PROD=1.
 *   - Все сущности под одной синтетической Org → teardown каскадом.
 *
 * Исполняется Bun напрямую: `bun run scripts/smoke-pipeline-e2e.ts`.
 */

import { createHash, randomBytes } from 'node:crypto';

import { Prisma, type PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';

import { createPrismaClient } from './prisma';

// ───────────────────────── env / config ────────────────────────────

export type HarnessMode = 'direct' | 'http' | 'both';

export interface HarnessConfig {
  mode: HarnessMode;
  baseUrl: string | null;
  xOrgIdOverride: string | null;
  ingestToken: string | null;
  sessionCookie: string | null;
  databaseUrl: string;
  redisUrl: string;
  verifyTimeoutMs: number;
  voxLive: boolean;
  keepTenant: boolean;
  allowProd: boolean;
  /** 'audit' — known-bug FAIL не роняет exit; 'gate' — любой FAIL роняет. */
  runMode: 'audit' | 'gate';
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === '' ? undefined : v;
}

function bool(name: string): boolean {
  const v = env(name);
  return v === '1' || v?.toLowerCase() === 'true';
}

export function readConfig(argv: string[] = process.argv.slice(2)): HarnessConfig {
  const databaseUrl = env('DATABASE_URL');
  if (!databaseUrl) {
    throw new Error('[combat-harness] DATABASE_URL не задан в env.');
  }
  const redisUrl = env('REDIS_URL');
  if (!redisUrl) {
    throw new Error('[combat-harness] REDIS_URL не задан в env (нужен для BullMQ).');
  }
  const mode = (env('MODE') ?? 'direct') as HarnessMode;
  if (!['direct', 'http', 'both'].includes(mode)) {
    throw new Error(`[combat-harness] MODE='${mode}' невалиден (direct|http|both).`);
  }
  return {
    mode,
    baseUrl: env('BASE_URL') ?? null,
    xOrgIdOverride: env('X_ORG_ID') ?? null,
    ingestToken: env('INGEST_TOKEN') ?? null,
    sessionCookie: env('SESSION_COOKIE') ?? null,
    databaseUrl,
    redisUrl,
    verifyTimeoutMs: Number(env('VERIFY_TIMEOUT_MS') ?? '90000'),
    voxLive: bool('VOX_LIVE'),
    keepTenant: bool('KEEP_TENANT'),
    allowProd: bool('ALLOW_PROD'),
    runMode: argv.includes('--gate') ? 'gate' : 'audit',
  };
}

// ───────────────────────── prod guard ──────────────────────────────────

const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'postgres',
  'redis',
  'host.docker.internal',
]);

/** Грубая эвристика приватного диапазона (для docker/LAN dev). */
function isPrivateHost(host: string): boolean {
  if (LOCAL_HOSTS.has(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  // короткое docker-service-имя без точек — считаем внутренним.
  if (!host.includes('.')) return true;
  return false;
}

function hostOf(urlLike: string): string | null {
  try {
    // postgres://user:pass@host:port/db — URL парсит.
    return new URL(urlLike).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Бросает, если цель похожа на прод и нет ALLOW_PROD=1. */
export function assertNotProd(cfg: HarnessConfig): void {
  if (cfg.allowProd) {
    // eslint-disable-next-line no-console
    console.warn('⚠ ALLOW_PROD=1 — prod-guard отключён осознанно.');
    return;
  }
  const targets = [cfg.databaseUrl, cfg.redisUrl, cfg.baseUrl].filter(
    (x): x is string => !!x,
  );
  for (const t of targets) {
    const host = hostOf(t);
    if (!host) continue;
    if (!isPrivateHost(host)) {
      throw new Error(
        `[combat-harness] PROD-GUARD: цель '${host}' не похожа на локальный/dev хост.\n` +
          `Харнесс пишет синтетику и НЕ должен бить в прод. Если это осознанно —\n` +
          `перезапустите с ALLOW_PROD=1. Цели: ${targets.join(', ')}`,
      );
    }
  }
}

// ───────────────────────── infra factories ─────────────────────────

export interface HarnessInfra {
  prisma: PrismaClient;
  redis: Redis;
  rawEventsQueue: Queue;
  close: () => Promise<void>;
}

const RAW_EVENTS_QUEUE = 'core.raw-events';

export function makeInfra(cfg: HarnessConfig): HarnessInfra {
  const prisma = createPrismaClient();
  const redis = new IORedis(cfg.redisUrl, { maxRetriesPerRequest: null });
  const rawEventsQueue = new Queue(RAW_EVENTS_QUEUE, { connection: redis });
  return {
    prisma,
    redis,
    rawEventsQueue,
    close: async () => {
      await rawEventsQueue.close().catch(() => undefined);
      await redis.quit().catch(() => undefined);
      await prisma.$disconnect().catch(() => undefined);
    },
  };
}

// ───────────────────────── synthetic tenant ────────────────────────

export interface SyntheticTenant {
  tag: string;
  userId: string;
  orgId: string;
  personId: string;
}

/**
 * Создаёт User + Org + Membership(owner) + Person(linked userId).
 * Person с заполненным userId — чтобы проверять и no_person-симптом (#7).
 */
export async function bootstrapTenant(
  prisma: PrismaClient,
): Promise<SyntheticTenant> {
  const tag = `cmbt-${randomBytes(3).toString('hex')}`;
  const user = await prisma.user.create({
    data: {
      email: `${tag}@combat.test`,
      name: 'Combat Harness Owner',
      role: 'user',
      signupSource: 'standalone',
    },
  });
  const org = await prisma.org.create({
    data: {
      name: `Combat Harness Org ${tag}`,
      slug: `${tag}-org`,
      ownerId: user.id,
      visibilityMode: 'open',
      tier: 'basic',
    },
  });
  await prisma.membership.create({
    data: { orgId: org.id, userId: user.id, role: 'owner' },
  });
  const person = await prisma.person.create({
    data: {
      tenantId: org.id,
      userId: user.id,
      name: 'Combat Harness Owner',
      email: `${tag}@combat.test`,
      relationship: 'employee',
    },
  });
  return { tag, userId: user.id, orgId: org.id, personId: person.id };
}

/**
 * Teardown в FK-порядке (дети → Org → User). Идемпотентно: deleteMany не падает
 * на пустых таблицах. CASCADE Org покрывает большинство knowledge-core моделей,
 * но явно чистим то, что может ссылаться извне или каскадиться по rawEvent.
 */
export async function teardownTenant(
  prisma: PrismaClient,
  t: SyntheticTenant,
): Promise<void> {
  const tenantId = t.orgId;
  // Связи блоков/сущностей.
  await prisma.ideaBlockEntity
    .deleteMany({ where: { block: { tenantId } } })
    .catch(() => undefined);
  await prisma.ideaBlockEvidence
    .deleteMany({ where: { block: { tenantId } } })
    .catch(() => undefined);
  await prisma.ideaBlockLink.deleteMany({ where: { tenantId } }).catch(() => undefined);
  await prisma.entityLink.deleteMany({ where: { tenantId } }).catch(() => undefined);
  // Проекции/типизированные сущности (CASCADE Org обычно покрывает, но явно — надёжнее).
  for (const del of [
    () => prisma.decision.deleteMany({ where: { tenantId } }),
    () => prisma.insight.deleteMany({ where: { tenantId } }),
    () => prisma.idea.deleteMany({ where: { tenantId } }),
    () => prisma.process.deleteMany({ where: { tenantId } }),
    () => prisma.regulation.deleteMany({ where: { tenantId } }),
    () => prisma.policy.deleteMany({ where: { tenantId } }),
    () => prisma.tool.deleteMany({ where: { tenantId } }),
    () => prisma.metric.deleteMany({ where: { tenantId } }),
    () => prisma.experiment.deleteMany({ where: { tenantId } }),
    () => prisma.theme.deleteMany({ where: { tenantId } }),
    () => prisma.card.deleteMany({ where: { tenantId } }),
    () => prisma.goal.deleteMany({ where: { tenantId } }),
    () => prisma.intakeIssue.deleteMany({ where: { tenantId } }),
    () => prisma.ideaBlock.deleteMany({ where: { tenantId } }),
    () => prisma.entity.deleteMany({ where: { tenantId } }),
    () => prisma.rawEvent.deleteMany({ where: { tenantId } }),
    () => prisma.source.deleteMany({ where: { tenantId } }),
    () => prisma.document.deleteMany({ where: { tenantId } }),
    () => prisma.transcript.deleteMany({ where: { meeting: { tenantId } } }),
    () => prisma.meeting.deleteMany({ where: { tenantId } }),
    () => prisma.person.deleteMany({ where: { tenantId } }),
    () => prisma.membership.deleteMany({ where: { orgId: tenantId } }),
  ]) {
    await del().catch(() => undefined);
  }
  await prisma.org.delete({ where: { id: tenantId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: t.userId } }).catch(() => undefined);
}

// ───────────────────────── ingest primitives ───────────────────────

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Псевдо-ULID для Meeting.id (Meeting.id назначается сервисом, не @default). */
export function pseudoUlid(): string {
  return `cmbt${Date.now().toString(36)}${randomBytes(6).toString('hex')}`.toUpperCase();
}

/** lazy-upsert Source по @@unique([tenantId,type,name]). */
export async function upsertSource(
  prisma: PrismaClient,
  args: { tenantId: string; type: string; name: string },
): Promise<{ id: string; dataClass: string }> {
  const s = await prisma.source.upsert({
    where: {
      tenantId_type_name: {
        tenantId: args.tenantId,
        // Source.type — enum SourceType; строковые литералы валидны для известных значений.
        type: args.type as never,
        name: args.name,
      },
    },
    update: {},
    create: {
      tenantId: args.tenantId,
      type: args.type as never,
      name: args.name,
      dataClass: 'internal',
      isActive: true,
    },
    select: { id: true, dataClass: true },
  });
  return s;
}

/**
 * Прямой вброс RawEvent + enqueue в core.raw-events ровно как IngestService:
 *   idempotencyKey = sha256(sourceId : (externalId ?? checksum) : occurredAtIso)
 *   jobId = `raw_<rawEventId>` ('_' вместо ':', BullMQ 5.x запрет на ':').
 */
export async function injectRawEventDirect(
  infra: HarnessInfra,
  args: {
    tenantId: string;
    sourceId: string;
    sourceType: string;
    sourceExternalId: string | null;
    occurredAt: Date;
    payload: unknown;
    dataClass?: string;
  },
): Promise<{ rawEventId: string; idempotent: boolean }> {
  const { prisma, rawEventsQueue } = infra;
  const payloadJson = JSON.stringify(args.payload);
  const payloadChecksum = sha256Hex(payloadJson);
  const payloadSizeBytes = Buffer.byteLength(payloadJson, 'utf8');
  const occurredAtIso = args.occurredAt.toISOString();
  const dedupBasis = args.sourceExternalId ?? payloadChecksum;
  const idempotencyKey = sha256Hex(`${args.sourceId}:${dedupBasis}:${occurredAtIso}`);

  const existing = await prisma.rawEvent.findUnique({ where: { idempotencyKey } });
  if (existing) {
    return { rawEventId: existing.id, idempotent: true };
  }
  try {
    const created = await prisma.rawEvent.create({
      data: {
        tenantId: args.tenantId,
        sourceId: args.sourceId,
        sourceType: args.sourceType as never,
        sourceExternalId: args.sourceExternalId ?? null,
        idempotencyKey,
        occurredAt: args.occurredAt,
        payloadStorage: 'inline',
        payload: args.payload as Prisma.InputJsonValue,
        payloadS3Key: null,
        payloadChecksum,
        payloadSizeBytes,
        dataClass: (args.dataClass ?? 'internal') as never,
        processingStatus: 'received',
      },
    });
    await rawEventsQueue.add(
      'raw-received',
      { rawEventId: created.id },
      { jobId: `raw_${created.id}` },
    );
    return { rawEventId: created.id, idempotent: false };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const ex = await prisma.rawEvent.findUnique({ where: { idempotencyKey } });
      if (ex) return { rawEventId: ex.id, idempotent: true };
    }
    throw err;
  }
}

// ───────────────────────── http client ──────────────────────────────

export interface HttpResult {
  ok: boolean;
  status: number;
  body: unknown;
  error?: string;
}

/** Тонкий fetch-обёртка. Возвращает {ok,status,body} без throw на не-2xx. */
export async function httpPost(
  cfg: HarnessConfig,
  path: string,
  body: unknown,
  opts?: { tenantId?: string; useCookie?: boolean; useIngestToken?: boolean },
): Promise<HttpResult> {
  if (!cfg.baseUrl) {
    return { ok: false, status: 0, body: null, error: 'BASE_URL не задан' };
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const tenantId = cfg.xOrgIdOverride ?? opts?.tenantId;
  if (tenantId) headers['X-Org-Id'] = tenantId;
  if (opts?.useCookie && cfg.sessionCookie) headers['cookie'] = cfg.sessionCookie;
  if (opts?.useIngestToken && cfg.ingestToken) {
    headers['authorization'] = `Bearer ${cfg.ingestToken}`;
    headers['x-ingest-token'] = cfg.ingestToken;
  }
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    let parsed: unknown = null;
    const text = await res.text();
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { ok: res.ok, status: res.status, body: parsed };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ───────────────────────── verification ───────────────────────────

export interface TenantCounts {
  rawEvent: number;
  rawEventProcessed: number;
  ideaBlock: number;
  canonicalBlock: number;
  entity: number;
  ideaBlockEntity: number;
  entityLink: number;
  ideaBlockLink: number;
  theme: number;
  decision: number;
  insight: number;
  idea: number;
  process: number;
  regulation: number;
  policy: number;
  tool: number;
  metric: number;
  experiment: number;
  commitmentBlock: number;
  card: number;
  goal: number;
  intakeIssue: number;
}

export async function loadCounts(
  prisma: PrismaClient,
  tenantId: string,
): Promise<TenantCounts> {
  const [
    rawEvent,
    rawEventProcessed,
    ideaBlock,
    canonicalBlock,
    entity,
    ideaBlockEntity,
    entityLink,
    ideaBlockLink,
    theme,
    decision,
    insight,
    idea,
    process,
    regulation,
    policy,
    tool,
    metric,
    experiment,
    commitmentBlock,
    card,
    goal,
    intakeIssue,
  ] = await Promise.all([
    prisma.rawEvent.count({ where: { tenantId } }),
    prisma.rawEvent.count({
      where: { tenantId, processingStatus: { not: 'received' } },
    }),
    prisma.ideaBlock.count({ where: { tenantId } }),
    prisma.ideaBlock.count({ where: { tenantId, status: 'canonical' } }),
    prisma.entity.count({ where: { tenantId } }),
    prisma.ideaBlockEntity.count({ where: { block: { tenantId } } }),
    prisma.entityLink.count({ where: { tenantId } }),
    prisma.ideaBlockLink.count({ where: { tenantId } }),
    prisma.theme.count({ where: { tenantId } }),
    prisma.decision.count({ where: { tenantId } }),
    prisma.insight.count({ where: { tenantId } }),
    prisma.idea.count({ where: { tenantId } }),
    prisma.process.count({ where: { tenantId } }),
    prisma.regulation.count({ where: { tenantId } }),
    prisma.policy.count({ where: { tenantId } }),
    prisma.tool.count({ where: { tenantId } }),
    prisma.metric.count({ where: { tenantId } }),
    prisma.experiment.count({ where: { tenantId } }),
    prisma.ideaBlock.count({ where: { tenantId, signalType: 'commitment' } }),
    prisma.card.count({ where: { tenantId } }),
    prisma.goal.count({ where: { tenantId } }),
    prisma.intakeIssue.count({ where: { tenantId } }),
  ]);
  return {
    rawEvent,
    rawEventProcessed,
    ideaBlock,
    canonicalBlock,
    entity,
    ideaBlockEntity,
    entityLink,
    ideaBlockLink,
    theme,
    decision,
    insight,
    idea,
    process,
    regulation,
    policy,
    tool,
    metric,
    experiment,
    commitmentBlock,
    card,
    goal,
    intakeIssue,
  };
}

export function typedGroupBTotal(c: TenantCounts): number {
  return (
    c.decision + c.process + c.regulation + c.policy + c.tool + c.metric
  );
}

export function terminalProjectionTotal(c: TenantCounts): number {
  return c.decision + c.insight + c.idea + c.experiment;
}

/**
 * Поллинг до выполнения предиката или таймаута. Возвращает финальные счётчики.
 */
export async function pollUntil(
  prisma: PrismaClient,
  tenantId: string,
  predicate: (c: TenantCounts) => boolean,
  timeoutMs: number,
  intervalMs = 1000,
): Promise<TenantCounts> {
  const deadline = Date.now() + timeoutMs;
  let last = await loadCounts(prisma, tenantId);
  while (Date.now() < deadline) {
    if (predicate(last)) return last;
    await sleep(intervalMs);
    last = await loadCounts(prisma, tenantId);
  }
  return last;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ───────────────────────── AGE probe ─────────────────────────────────

export interface AgeProbe {
  available: boolean;
  nodeCount: number | null;
  error: string | null;
}

/**
 * Проба AGE: считает узлы графа для тенанта. Ловит баг cypher/AGE (#3/#11/#12):
 * 42883 'function cypher does not exist' / отсутствие search_path → available=false.
 * Пробуем сначала квалифицированный ag_catalog.cypher (надёжнее), затем голый.
 */
export async function probeAge(
  prisma: PrismaClient,
  tenantId: string,
): Promise<AgeProbe> {
  const variants = [
    `SELECT count(*)::text AS c FROM ag_catalog.cypher('z_graph', $$ MATCH (n) WHERE n.tenant_id = '${tenantId}' RETURN n $$) AS (n agtype)`,
    `SELECT count(*)::text AS c FROM cypher('z_graph', $$ MATCH (n) WHERE n.tenant_id = '${tenantId}' RETURN n $$) AS (n agtype)`,
  ];
  let lastErr = '';
  for (const sql of variants) {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ c: string }>>(sql);
      const n = Number(rows[0]?.c ?? '0');
      return { available: true, nodeCount: Number.isFinite(n) ? n : null, error: null };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  return { available: false, nodeCount: null, error: lastErr };
}

// ───────────────────────── matrix render ───────────────────────────

export type CellStatus = 'PASS' | 'FAIL' | 'SKIP' | 'N/A';

export interface MatrixCell {
  status: CellStatus;
  note?: string;
}

export interface ChannelRow {
  channel: string;
  cells: Record<string, MatrixCell>;
}

export const NODE_COLUMNS = [
  'raw_event',
  'idea_block',
  'canonical',
  'entity',
  'typed_group_b',
  'entity_link',
  'block_link',
  'theme',
  'terminal_projection',
  'commitment',
  'card',
  'goal',
  'tracker',
  'age_node',
] as const;

export type NodeColumn = (typeof NODE_COLUMNS)[number];

const STATUS_GLYPH: Record<CellStatus, string> = {
  PASS: '✓ PASS',
  FAIL: '✗ FAIL',
  SKIP: '· SKIP',
  'N/A': '— N/A',
};

export function renderMatrix(rows: ChannelRow[]): string {
  const lines: string[] = [];
  lines.push('=== Combat-test matrix (канал × узел) ===');
  for (const row of rows) {
    lines.push(`\n[${row.channel}]`);
    for (const col of NODE_COLUMNS) {
      const cell = row.cells[col];
      if (!cell) continue;
      const note = cell.note ? `  (${cell.note})` : '';
      lines.push(`  ${col.padEnd(22)} ${STATUS_GLYPH[cell.status]}${note}`);
    }
  }
  return lines.join('\n');
}

/** В gate-режиме любой FAIL роняет exit; в audit — только не-known FAIL. */
export function computeExitCode(
  rows: ChannelRow[],
  runMode: 'audit' | 'gate',
): number {
  for (const row of rows) {
    for (const col of NODE_COLUMNS) {
      const cell = row.cells[col];
      if (!cell) continue;
      if (cell.status !== 'FAIL') continue;
      if (runMode === 'gate') return 1;
      // audit: known-bug FAIL не роняет (помечается note 'known bug …').
      if (!cell.note?.toLowerCase().includes('known')) return 1;
    }
  }
  return 0;
}
