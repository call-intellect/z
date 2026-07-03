import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../_lib/prisma';
import { catalogByReason, PROBE_CATALOG } from './registry';
import { judgeProbe, type JudgeVerdict } from './judge';

const STRELA = process.env['STRELA_ORG'] ?? 'cmr1qbvpx0001pwbwxbgmh1jl';
const REPORT_MD = resolve(process.cwd(), '../docs/testing/probe-stand-report.md');
const REPORT_JSON = resolve(process.cwd(), '../docs/testing/probe-stand-report.json');

interface ProbeRow {
  reason: string;
  service: string;
  status: string;
  message: string;
  recipient: string;
  createdAt: Date;
}

interface ReasonAgg {
  reason: string;
  service: string;
  count: number;
  statuses: Record<string, number>;
  sample: string;
  recipient: string;
}

function payloadMessage(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const m = (payload as Record<string, unknown>)['message'];
    if (typeof m === 'string') return m;
  }
  return '';
}

function payloadField(payload: unknown, key: string): string | null {
  if (payload && typeof payload === 'object') {
    const v = (payload as Record<string, unknown>)[key];
    if (typeof v === 'string') return v;
  }
  return null;
}

async function readProbes(
  prisma: PrismaClient,
  orgId: string,
  sinceDays: number,
): Promise<ProbeRow[]> {
  const since = new Date(Date.now() - sinceDays * 86400_000);
  const rows = await prisma.probeEvent.findMany({
    where: { tenantId: orgId, createdAt: { gt: since } },
    orderBy: { createdAt: 'desc' },
    take: 3000,
  });
  return rows.map((r) => ({
    reason: r.reason,
    service: r.emittedByService,
    status: r.status,
    message: payloadMessage(r.payload),
    recipient: r.selectedRecipientId ?? r.recipientCandidates[0] ?? '?',
    createdAt: r.createdAt,
  }));
}

function aggregate(rows: ProbeRow[]): ReasonAgg[] {
  const map = new Map<string, ReasonAgg>();
  for (const row of rows) {
    const agg = map.get(row.reason) ?? {
      reason: row.reason,
      service: row.service,
      count: 0,
      statuses: {},
      sample: row.message,
      recipient: row.recipient,
    };
    agg.count += 1;
    agg.statuses[row.status] = (agg.statuses[row.status] ?? 0) + 1;
    if (!agg.sample && row.message) agg.sample = row.message;
    map.set(row.reason, agg);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

async function withApp<T>(fn: (app: INestApplicationContext) => Promise<T>): Promise<T> {
  const { AppModule } = await import('../../src/app.module');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    return await fn(app);
  } finally {
    await app.close();
  }
}

async function pollProbe(
  prisma: PrismaClient,
  orgId: string,
  reason: string,
  contextCardId: string,
  startedAt: Date,
  timeoutMs: number,
): Promise<ProbeRow | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const evs = await prisma.probeEvent.findMany({
      where: { tenantId: orgId, reason, createdAt: { gte: startedAt } },
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
    const hit = evs.find((e) => payloadField(e.payload, 'contextCardId') === contextCardId);
    if (hit) {
      return {
        reason: hit.reason,
        service: hit.emittedByService,
        status: hit.status,
        message: payloadMessage(hit.payload),
        recipient: hit.selectedRecipientId ?? hit.recipientCandidates[0] ?? '?',
        createdAt: hit.createdAt,
      };
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return null;
}

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function modeCatalog(): Promise<void> {
  log('# Реестр типов уточняющих вопросов (probe)\n');
  const active = PROBE_CATALOG.filter((e) => e.status === 'active');
  const removed = PROBE_CATALOG.filter((e) => e.status === 'removed');
  log(`Активных reason: ${active.length}, удалённых overhaul'ом: ${removed.length}\n`);
  for (const e of active) {
    log(`- [${e.family}] ${e.reason} — агент ${e.service} — «${e.asks}» → ${e.recipient}`);
    log(`    триггер: ${e.trigger}`);
  }
  log('\nУдалены переработкой (в проде больше не шлются):');
  for (const e of removed) log(`- ${e.reason} (${e.service})`);
}

async function harvest(prisma: PrismaClient, sinceDays: number): Promise<ReasonAgg[]> {
  const rows = await readProbes(prisma, STRELA, sinceDays);
  return aggregate(rows);
}

async function modeHarvest(sinceDays: number): Promise<ReasonAgg[]> {
  const prisma = createPrismaClient();
  try {
    const aggs = await harvest(prisma, sinceDays);
    log(`# Probe в Стреле (${STRELA}) за ${sinceDays} дн.\n`);
    log(`Всего типов: ${aggs.length}, событий: ${aggs.reduce((s, a) => s + a.count, 0)}\n`);
    for (const a of aggs) {
      const st = Object.entries(a.statuses)
        .map(([k, v]) => `${k}:${v}`)
        .join(' ');
      log(`- ${a.reason} ×${a.count} [${a.service}] (${st})`);
      if (a.sample) log(`    «${a.sample.slice(0, 90)}»`);
    }
    return aggs;
  } finally {
    await prisma.$disconnect();
  }
}

async function modeReport(sinceDays: number, doJudge: boolean): Promise<void> {
  const prisma = createPrismaClient();
  try {
    const aggs = await harvest(prisma, sinceDays);
    const judged: Array<ReasonAgg & { verdict?: JudgeVerdict }> = [];
    for (const a of aggs) {
      if (!doJudge) {
        judged.push(a);
        continue;
      }
      const cat = catalogByReason(a.reason);
      try {
        const verdict = await judgeProbe({
          reason: a.reason,
          service: a.service,
          message: a.sample || (cat?.asks ?? a.reason),
          recipient: cat?.recipient ?? a.recipient,
          asks: cat?.asks ?? '',
          volumePerWeek: a.count,
        });
        judged.push({ ...a, verdict });
        log(`judged ${a.reason} → ${verdict.verdict}`);
      } catch (err) {
        log(`judge FAIL ${a.reason}: ${err instanceof Error ? err.message : String(err)}`);
        judged.push(a);
      }
    }
    writeReport(judged, sinceDays);
    log(`\nОтчёт: ${REPORT_MD}`);
  } finally {
    await prisma.$disconnect();
  }
}

function rankVerdict(v?: JudgeVerdict): number {
  if (!v) return 3;
  return v.verdict === 'noise' ? 0 : v.verdict === 'borderline' ? 1 : 2;
}

function writeReport(
  items: Array<ReasonAgg & { verdict?: JudgeVerdict }>,
  sinceDays: number,
): void {
  const sorted = [...items].sort(
    (a, b) => rankVerdict(a.verdict) - rankVerdict(b.verdict) || b.count - a.count,
  );
  const lines: string[] = [];
  lines.push(`# Probe-стенд: отчёт (Стрела ${STRELA})`);
  lines.push('');
  lines.push(`Окно: ${sinceDays} дн. Типов: ${items.length}. Событий: ${items.reduce((s, a) => s + a.count, 0)}.`);
  lines.push('');
  lines.push('| Вердикт | reason | агент | ×/окно | адресат | рекомендация |');
  lines.push('|---|---|---|---:|---|---|');
  for (const a of sorted) {
    const v = a.verdict;
    const cat = catalogByReason(a.reason);
    lines.push(
      `| ${v?.verdict ?? '—'} | ${a.reason} | ${a.service} | ${a.count} | ${cat?.recipient ?? a.recipient} | ${v?.suggestedFix ?? ''} |`,
    );
  }
  lines.push('');
  lines.push('## Детали');
  for (const a of sorted) {
    lines.push('');
    lines.push(`### ${a.reason} (×${a.count})`);
    if (a.sample) lines.push(`- пример: «${a.sample}»`);
    if (a.verdict) {
      lines.push(
        `- relevance=${a.verdict.relevance} actionClear=${a.verdict.actionClear} recipientRight=${a.verdict.recipientRight} notDuplicate=${a.verdict.notDuplicate} notOnUnconfirmed=${a.verdict.notOnUnconfirmed}`,
      );
      lines.push(`- почему: ${a.verdict.rationale}`);
      lines.push(`- фикс: ${a.verdict.suggestedFix}`);
    }
  }
  writeFileSync(REPORT_MD, lines.join('\n'), 'utf8');
  writeFileSync(REPORT_JSON, JSON.stringify(items, null, 2), 'utf8');
}

async function modeTrigger(): Promise<void> {
  await withApp(async (app) => {
    const { RedisService } = await import('../../src/common/redis/redis.service');
    const { ConsistencyCheckerService } = await import(
      '../../src/modules/curation/workers/consistency-checker.cron'
    );
    const { Specialist315TasksService } = await import(
      '../../src/modules/knowledge-core/services/specialist-3-15-tasks.service'
    );
    const redis = app.get(RedisService);
    const pattern = `consistency:dedup:${STRELA}:*`;
    const keys = await redis.client.keys(pattern);
    if (keys.length > 0) await redis.client.del(...keys);
    log(`trigger: очищено dedup-ключей ${keys.length}`);
    const cc = app.get(ConsistencyCheckerService);
    const ccRes = await cc.runForAllOrgs();
    log(`trigger: consistency-checker → violations=${ccRes.violationsTotal} orgs=${ccRes.scannedOrgs}`);
    const sweep = app.get(Specialist315TasksService);
    const swRes = await sweep.runClarifySweep();
    log(`trigger: task-clarify-sweep → probed=${swRes.probed} orgs=${swRes.orgsScanned}`);
  });
}

async function modeScenarioMethodCapture(): Promise<void> {
  await withApp(async (app) => {
    const { PrismaService } = await import('../../src/common/prisma/prisma.service');
    const { IssuesService } = await import('../../src/modules/tracker/services/issues.service');
    const prisma = app.get(PrismaService) as unknown as PrismaClient;
    const issues = app.get(IssuesService);

    const candidate = await prisma.issue.findFirst({
      where: {
        tenantId: STRELA,
        deletedAt: null,
        completedAt: null,
        state: { category: { notIn: ['completed', 'cancelled'] } },
        assignees: { some: {} },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, projectId: true, stateId: true, title: true },
    });
    if (!candidate) {
      log('scenario method-capture: НЕТ открытой задачи с исполнителем в Стреле — засей задачу.');
      return;
    }
    const completedState = await prisma.issueState.findFirst({
      where: { projectId: candidate.projectId, category: 'completed' },
      select: { id: true },
    });
    if (!completedState) {
      log('scenario method-capture: у проекта нет состояния категории completed.');
      return;
    }
    const owner = await prisma.membership.findFirst({
      where: { orgId: STRELA, role: { in: ['owner', 'admin'] } },
      select: { userId: true },
    });
    if (!owner) {
      log('scenario method-capture: нет owner/admin в Стреле.');
      return;
    }
    const startedAt = new Date();
    log(`scenario method-capture: перевожу «${candidate.title}» в completed...`);
    await issues.transitionState(
      candidate.id,
      { stateId: completedState.id },
      STRELA,
      owner.userId,
    );
    const hit = await pollProbe(
      prisma,
      STRELA,
      'task.method_capture',
      candidate.id,
      startedAt,
      10_000,
    );
    if (hit) {
      log(`scenario method-capture: PASS — probe создан, адресат=${hit.recipient}`);
      log(`  текст: «${hit.message}»`);
    } else {
      log('scenario method-capture: probe НЕ создан за 10с.');
      log('  вероятно complexity < tracker.methodCaptureMinComplexity (0.5) — задача сочтена простой.');
    }
  });
}

async function modeScenarioTaskClarify(): Promise<void> {
  await withApp(async (app) => {
    const { PrismaService } = await import('../../src/common/prisma/prisma.service');
    const { Specialist315TasksService } = await import(
      '../../src/modules/knowledge-core/services/specialist-3-15-tasks.service'
    );
    const prisma = app.get(PrismaService) as unknown as PrismaClient;
    const sweep = app.get(Specialist315TasksService);

    const eligible = await prisma.intakeIssue.count({
      where: {
        tenantId: STRELA,
        status: 'pending',
        OR: [{ suggestedAssigneeId: null }, { suggestedDueDate: null }],
      },
    });
    log(`scenario task-clarify: pending-intake без исполнителя/срока в Стреле: ${eligible}`);
    const startedAt = new Date();
    const res = await sweep.runClarifySweep();
    log(`scenario task-clarify: runClarifySweep → probed=${res.probed} orgs=${res.orgsScanned}`);
    const evs = await prisma.probeEvent.findMany({
      where: {
        tenantId: STRELA,
        reason: { in: ['task.assignee_unresolved', 'task.due_date_missing'] },
        createdAt: { gte: startedAt },
      },
      take: 20,
    });
    if (evs.length > 0) {
      log(`scenario task-clarify: PASS — создано probe: ${evs.length}`);
      for (const e of evs) log(`  ${e.reason}: «${payloadMessage(e.payload)}»`);
    } else if (eligible === 0) {
      log('scenario task-clarify: нет подходящих intake (нужен pending IntakeIssue старше 20ч без исполнителя/срока) — засей.');
    } else {
      log('scenario task-clarify: probe не создан — проверь возраст intake (minAgeHours=20) и адресата.');
    }
  });
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'report';
  const sinceDays = Number(process.env['PROBE_STAND_SINCE_DAYS'] ?? '14');
  switch (mode) {
    case 'catalog':
      await modeCatalog();
      break;
    case 'harvest':
      await modeHarvest(sinceDays);
      break;
    case 'judge':
    case 'report':
      await modeReport(sinceDays, true);
      break;
    case 'report:nolllm':
    case 'report:nollm':
      await modeReport(sinceDays, false);
      break;
    case 'trigger':
      await modeTrigger();
      await modeHarvest(sinceDays);
      break;
    case 'scenario:method-capture':
      await modeScenarioMethodCapture();
      break;
    case 'scenario:task-clarify':
      await modeScenarioTaskClarify();
      break;
    case 'all':
      await modeTrigger();
      await modeScenarioMethodCapture();
      await modeScenarioTaskClarify();
      await modeReport(sinceDays, true);
      break;
    default:
      log(
        'Режимы: catalog | harvest | report | report:nollm | trigger | scenario:method-capture | scenario:task-clarify | all',
      );
      process.exitCode = 1;
  }
}

void main().then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(`probe-stand FAIL: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  },
);
