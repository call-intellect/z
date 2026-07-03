import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../_lib/prisma';
import { catalogByReason, PROBE_CATALOG } from './registry';
import { judgeGaps, judgeProbe, type GapCandidate, type JudgeVerdict } from './judge';

const STRELA = process.env['STRELA_ORG'] ?? 'cmr1qbvpx0001pwbwxbgmh1jl';
const REPORT_MD = resolve(process.cwd(), '../docs/testing/probe-stand-report.md');
const REPORT_JSON = resolve(process.cwd(), '../docs/testing/probe-stand-report.json');
const RUNS_DIR = resolve(process.cwd(), '../docs/testing/probe-stand-runs');

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
          trigger: cat?.trigger ?? 'неизвестен',
          volumePerWeek: a.count,
        });
        judged.push({ ...a, verdict });
        log(`judged ${a.reason} → ${verdict.verdict}`);
      } catch (err) {
        log(`judge FAIL ${a.reason}: ${err instanceof Error ? err.message : String(err)}`);
        judged.push(a);
      }
    }
    let gaps: GapCandidate[] = [];
    if (doJudge) {
      try {
        gaps = await judgeGaps(buildGapsInventory(judged));
        log(`gaps: судья предложил кандидатов — ${gaps.length}`);
      } catch (err) {
        log(`gaps FAIL: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    writeReport(judged, gaps, sinceDays);
    log(`\nОтчёт: ${REPORT_MD}`);
  } finally {
    await prisma.$disconnect();
  }
}

function buildGapsInventory(items: Array<ReasonAgg & { verdict?: JudgeVerdict }>): string {
  const active = PROBE_CATALOG.filter((e) => e.status === 'active');
  const seen = new Map(items.map((i) => [i.reason, i]));
  const lines = active.map((e) => {
    const hit = seen.get(e.reason);
    const observed = hit ? `наблюдался ×${hit.count}` : 'в окне не наблюдался';
    return `- ${e.reason} [${e.family}] → ${e.recipient}: «${e.asks}» (${observed})`;
  });
  return ['Инвентарь существующих вопросов Коры:', ...lines].join('\n');
}

function rankVerdict(v?: JudgeVerdict): number {
  if (!v) return 4;
  switch (v.verdict) {
    case 'drop':
      return 0;
    case 'automate':
      return 1;
    case 'rework':
      return 2;
    case 'keep':
      return 3;
    default:
      return 4;
  }
}

function verdictRu(v?: JudgeVerdict): string {
  if (!v) return '—';
  switch (v.verdict) {
    case 'keep':
      return 'keep (нужен)';
    case 'rework':
      return 'rework (переделать)';
    case 'automate':
      return 'automate (автоматизировать)';
    case 'drop':
      return 'drop (убрать)';
    default:
      return v.verdict;
  }
}

function writeReport(
  items: Array<ReasonAgg & { verdict?: JudgeVerdict }>,
  gaps: GapCandidate[],
  sinceDays: number,
): void {
  const sorted = [...items].sort(
    (a, b) => rankVerdict(a.verdict) - rankVerdict(b.verdict) || b.count - a.count,
  );
  const lines: string[] = [];
  lines.push(`# Probe-стенд: отчёт (Стрела ${STRELA})`);
  lines.push('');
  lines.push(
    `Окно: ${sinceDays} дн. Типов: ${items.length}. Событий: ${items.reduce((s, a) => s + a.count, 0)}. Рубрика судьи: [поле правильности](probe-field-rules.md) (смыслы P1–P8, не белый список).`,
  );
  lines.push('');
  lines.push('| Вердикт | reason | агент | ×/окно | адресат | нарушено | рекомендация |');
  lines.push('|---|---|---|---:|---|---|---|');
  for (const a of sorted) {
    const v = a.verdict;
    const cat = catalogByReason(a.reason);
    lines.push(
      `| ${verdictRu(v)} | ${a.reason} | ${a.service} | ${a.count} | ${cat?.recipient ?? a.recipient} | ${v?.violatedPrinciples.join(' ') || '—'} | ${v?.suggestedFix ?? ''} |`,
    );
  }
  lines.push('');
  lines.push('## Пробелы: где вопросов не хватает (обратная проверка по P1/P3)');
  if (gaps.length === 0) {
    lines.push('');
    lines.push('Судья кандидатов не предложил (или проверка не запускалась — режим без LLM).');
  }
  for (const g of gaps) {
    lines.push('');
    lines.push(`- **Момент:** ${g.moment}`);
    lines.push(`  **Вопрос:** «${g.question}» → ${g.recipient}`);
    lines.push(`  **Почему человек:** ${g.whyHuman}`);
  }
  lines.push('');
  lines.push('## Детали');
  for (const a of sorted) {
    lines.push('');
    lines.push(`### ${a.reason} (×${a.count}) — ${verdictRu(a.verdict)}`);
    if (a.sample) lines.push(`- пример: «${a.sample}»`);
    if (a.verdict) {
      lines.push(
        `- humanOnly=${a.verdict.humanOnly} recipientRight=${a.verdict.recipientRight} нарушения=[${a.verdict.violatedPrinciples.join(', ')}]`,
      );
      if (a.verdict.machinePath) lines.push(`- как закрыть без вопроса: ${a.verdict.machinePath}`);
      lines.push(`- почему: ${a.verdict.rationale}`);
      lines.push(`- фикс: ${a.verdict.suggestedFix}`);
    }
  }
  const body = lines.join('\n');
  writeFileSync(REPORT_MD, body, 'utf8');
  writeFileSync(REPORT_JSON, JSON.stringify({ items, gaps }, null, 2), 'utf8');
  const stamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace('T', '-')
    .replace(':', '');
  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(resolve(RUNS_DIR, `${stamp}.md`), body, 'utf8');
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
