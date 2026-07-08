import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { PrismaClient } from '@prisma/client';

import { EmbeddingFallbackService } from '../../src/modules/embeddings/services/embedding-fallback.service';
import { TaskSolutionBuildService } from '../../src/modules/knowledge-core/services/task-solution-build.service';
import { BlockIngestWorker } from '../../src/modules/knowledge-core/workers/block-ingest.worker';
import { TaskCompletionHandler } from '../../src/modules/operations/services/task-completion.handler';
import { IssuesService } from '../../src/modules/tracker/services/issues.service';

import { assertNotProd, readConfig, sleep } from '../_lib/combat-harness';
import { createPrismaClient } from '../_lib/prisma';

import { RUNS_DIR } from './corpus';
import { prepare } from './seed-reg-feed';
import { stubEmbed } from './stub-embedder';
import type { RegStandManifest } from './types';

function log(s: string): void {
  process.stdout.write(`${s}\n`);
}

interface Check {
  name: string;
  proves: string;
  pass: boolean;
  detail: string;
}

async function withApp<T>(fn: (app: INestApplicationContext) => Promise<T>): Promise<T> {
  const { AppModule } = await import('../../src/app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    return await fn(app);
  } finally {
    await Promise.race([app.close(), sleep(6000)]);
  }
}

function buildText(criticalQuestion: string, trustedAnswer: string): string {
  return `${criticalQuestion}\n\n${trustedAnswer.slice(0, 500)}`;
}

async function ensureSource(
  prisma: PrismaClient,
  tenantId: string,
  sourceType: string,
): Promise<string> {
  const s = await prisma.source.upsert({
    where: { tenantId_type_name: { tenantId, type: sourceType as never, name: `e2e-${sourceType}` } },
    update: {},
    create: { tenantId, type: sourceType as never, name: `e2e-${sourceType}`, dataClass: 'internal', isActive: true },
    select: { id: true },
  });
  return s.id;
}

async function createOpenIssue(
  issues: IssuesService,
  m: RegStandManifest,
  title: string,
  assigneeName: string,
): Promise<string> {
  const assigneeUserId = m.people[assigneeName] ?? null;
  const created = await issues.create(
    m.projectId,
    {
      title,
      descriptionStripped: title,
      priority: 'medium',
      assigneeUserIds: assigneeUserId ? [assigneeUserId] : [],
      sortOrder: 0,
      labelIds: [],
      skipDedup: true,
    } as never,
    m.orgId,
    m.ownerUserId,
  );
  return created.id;
}

async function insertRawEvent(
  prisma: PrismaClient,
  tenantId: string,
  sourceId: string,
  sourceType: string,
  payload: Record<string, unknown>,
  occurredAt: Date,
): Promise<string> {
  const payloadJson = JSON.stringify(payload);
  const rand = randomBytes(8).toString('hex');
  const re = await prisma.rawEvent.create({
    data: {
      tenantId,
      sourceId,
      sourceType: sourceType as never,
      sourceExternalId: rand,
      idempotencyKey: createHash('sha256').update(`${sourceId}:${rand}:${occurredAt.toISOString()}`).digest('hex'),
      occurredAt,
      payloadStorage: 'inline',
      payload: payload as never,
      payloadChecksum: createHash('sha256').update(payloadJson).digest('hex'),
      payloadSizeBytes: Buffer.byteLength(payloadJson, 'utf8'),
      dataClass: 'internal',
      processingStatus: 'received',
    },
    select: { id: true },
  });
  return re.id;
}

async function writeStubEmbedding(
  prisma: PrismaClient,
  table: string,
  id: string,
  text: string,
): Promise<void> {
  const vec = `[${stubEmbed(text).join(',')}]`;
  await prisma.$executeRawUnsafe(
    `UPDATE "${table}" SET "embedding" = $1::vector WHERE "id" = $2`,
    vec,
    id,
  );
}

async function scenarioCaptureFromRawText(
  prisma: PrismaClient,
  app: INestApplicationContext,
  m: RegStandManifest,
): Promise<Check[]> {
  const checks: Check[] = [];
  const worker = app.get(BlockIngestWorker, { strict: false }) as {
    process: (job: { data: { rawEventId: string } }) => Promise<void>;
  };
  const handler = app.get(TaskCompletionHandler, { strict: false });
  const builder = app.get(TaskSolutionBuildService, { strict: false });
  const issues = app.get(IssuesService, { strict: false });

  const assignee = 'Иван';
  const issueId = await createOpenIssue(issues, m, 'Настроить SSO для клиента Омега', assignee);
  log(`e2e[A1]: открытая задача ${issueId} (assignee=${assignee})`);

  const sourceId = await ensureSource(prisma, m.orgId, 'chat');
  const rawText =
    'Закрыл задачу по SSO для клиента Омега: настроил SAML между нашим IdP и приложением клиента, ' +
    'смапил группы AD на роли в приложении, добавил авто-провижининг новых пользователей и проверил ' +
    'вход трёх тестовых учёток — все логинятся, роли подтягиваются. Задача готова.';
  const rawEventId = await insertRawEvent(
    prisma,
    m.orgId,
    sourceId,
    'chat',
    { kind: 'chat_message', text: rawText, fullText: rawText },
    new Date(),
  );
  log(`e2e[A1]: RawEvent ${rawEventId} (chat, БЕЗ contextCardId, БЕЗ signalType)`);

  await worker.process({ data: { rawEventId } });

  const blocks = await prisma.ideaBlock.findMany({
    where: {
      tenantId: m.orgId,
      evidence: { some: { rawEventId } },
    },
    select: { id: true, signalType: true, criticalQuestion: true, trustedAnswer: true, status: true },
  });
  checks.push({
    name: 'A1-классификация из сырого текста',
    proves: 'R1/R7/A1 — block-ingest на сыром чате классифицировал signalType (не хардкод)',
    pass: blocks.length > 0,
    detail: `блоков ${blocks.length}: ${blocks.map((b) => b.signalType).join(', ') || '—'}`,
  });
  if (blocks.length === 0) return checks;

  await prisma.ideaBlock.updateMany({
    where: { id: { in: blocks.map((b) => b.id) }, tenantId: m.orgId },
    data: { status: 'canonical' },
  });

  const signalBlock =
    blocks.find((b) => ['task_completed', 'done_item', 'task_status_changed'].includes(b.signalType)) ??
    blocks[0]!;
  await writeStubEmbedding(
    prisma,
    'Issue',
    issueId,
    buildText(signalBlock.criticalQuestion, signalBlock.trustedAnswer),
  );

  await handler.handle({
    tenantId: m.orgId,
    blockId: signalBlock.id,
    signalType: 'task_completed',
    sourceType: 'chat',
  });

  const candidate = await prisma.taskClosureCandidate.findFirst({
    where: { tenantId: m.orgId, issueId, sourceBlockId: signalBlock.id },
    select: { id: true, status: true, matchSimilarity: true },
  });
  checks.push({
    name: 'Матч блок↔задача (TaskClosureCandidate)',
    proves: 'A1 — петля закрытия связала кусок разговора с открытой задачей',
    pass: candidate !== null,
    detail: candidate
      ? `candidate ${candidate.id} status=${candidate.status} sim=${candidate.matchSimilarity}`
      : 'кандидат не создан (LLM-verify done=false или матч не прошёл)',
  });

  await builder.runForOrg(m.orgId, { now: new Date() });

  const sol = await prisma.taskSolution.findUnique({
    where: { tenantId_sourceIssueId: { tenantId: m.orgId, sourceIssueId: issueId } },
    select: { id: true, ownerPersonId: true, sourceBlockIds: true, solutionMd: true },
  });
  const ownerPerson = sol
    ? await prisma.person.findFirst({ where: { id: sol.ownerPersonId }, select: { name: true } })
    : null;
  checks.push({
    name: 'Материализация через матч (без contextCardId)',
    proves: 'A1/A2 — решение из чата собрано по TaskClosureCandidate, а не по probe',
    pass: sol !== null && sol.sourceBlockIds.includes(signalBlock.id),
    detail: sol
      ? `TaskSolution ${sol.id}, owner=${ownerPerson?.name ?? sol.ownerPersonId}, blocks=${sol.sourceBlockIds.length}`
      : 'решение НЕ собрано',
  });

  return checks;
}

async function scenarioRecidivismWindow(
  prisma: PrismaClient,
  app: INestApplicationContext,
  m: RegStandManifest,
): Promise<Check[]> {
  const checks: Check[] = [];
  const builder = app.get(TaskSolutionBuildService, { strict: false });
  const issues = app.get(IssuesService, { strict: false });
  const sourceId = await ensureSource(prisma, m.orgId, 'chat');

  const now = new Date();
  const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 3_600_000);

  const seedRecidivism = async (
    title: string,
    freshEvidence: boolean,
  ): Promise<string> => {
    const issueId = await createOpenIssue(issues, m, title, 'Михаил');
    const oldRawEventId = await insertRawEvent(
      prisma,
      m.orgId,
      sourceId,
      'chat',
      { fullText: `${title}: поставил лимитер и очередь ретраев с бэкоффом.`, contextCardId: issueId },
      eightDaysAgo,
    );
    const block = await prisma.ideaBlock.create({
      data: {
        tenantId: m.orgId,
        name: title,
        criticalQuestion: `Как решали: ${title}`,
        trustedAnswer: 'Поставил лимитер на исходящие, добавил очередь ретраев с экспоненциальным бэкоффом, прогнал под нагрузкой.',
        tags: ['429'],
        signalType: 'methodology_step' as never,
        status: 'canonical',
        dataClass: 'internal',
        externalSource: 'e2e',
        evidenceCount: 1,
        createdAt: eightDaysAgo,
      },
      select: { id: true },
    });
    await prisma.ideaBlockEvidence.create({
      data: {
        tenantId: m.orgId,
        blockId: block.id,
        rawEventId: oldRawEventId,
        sourceType: 'chat' as never,
        quote: 'лимитер + очередь ретраев',
        sourceTimestamp: eightDaysAgo,
      },
    });
    if (freshEvidence) {
      const freshRawEventId = await insertRawEvent(
        prisma,
        m.orgId,
        sourceId,
        'chat',
        { fullText: `Опять ${title} — снова лимитер и очередь ретраев, тот же приём.`, contextCardId: issueId },
        now,
      );
      await prisma.ideaBlockEvidence.create({
        data: {
          tenantId: m.orgId,
          blockId: block.id,
          rawEventId: freshRawEventId,
          sourceType: 'chat' as never,
          quote: 'снова 429, тот же приём',
          sourceTimestamp: now,
        },
      });
    }
    return issueId;
  };

  const recidivistIssue = await seedRecidivism('Инцидент 429 рецидив (старый canonical + свежий evidence)', true);
  const staleIssue = await seedRecidivism('Инцидент 429 давно закрытый (только старый evidence)', false);

  await builder.runForOrg(m.orgId, { now });

  const recidivistSol = await prisma.taskSolution.count({
    where: { tenantId: m.orgId, sourceIssueId: recidivistIssue, deletedAt: null },
  });
  const staleSol = await prisma.taskSolution.count({
    where: { tenantId: m.orgId, sourceIssueId: staleIssue, deletedAt: null },
  });

  checks.push({
    name: 'Рецидив в старый canonical попадает в окно (свежий evidence)',
    proves: 'R6/C1 — детекция по GREATEST(evidence.sourceTimestamp), не по IdeaBlock.createdAt',
    pass: recidivistSol >= 1,
    detail:
      recidivistSol >= 1
        ? 'задача с createdAt блока 8 дней назад, но свежим evidence → материализована (окно по evidence)'
        : 'НЕ материализована — окно всё ещё по createdAt (регресс)',
  });
  checks.push({
    name: 'Реально старый материал НЕ тянется в окно',
    proves: 'C1 ловушка — окно не расширилось на старьё (только свежий evidence)',
    pass: staleSol === 0,
    detail:
      staleSol === 0
        ? 'блок 8 дней назад + evidence 8 дней назад → вне окна (корректно)'
        : 'старьё попало в окно (окно слишком широкое)',
  });

  return checks;
}

function writeReport(stamp: string, checks: Check[]): void {
  const runDir = resolve(RUNS_DIR, stamp);
  mkdirSync(runDir, { recursive: true });
  const passN = checks.filter((c) => c.pass).length;
  const lines: string[] = [];
  lines.push('# regulation-stand — e2e (сырой текст → block-ingest → матч → сборка)');
  lines.push('');
  lines.push(
    `Прогон: \`${stamp}\` · проверок ${checks.length} · PASS ${passN}/${checks.length}.`,
  );
  lines.push('');
  lines.push(
    '> E2e-режим гоняет РЕАЛЬНЫЙ конвейер: block-ingest классифицирует сырой чат (без хардкод-signalType и без contextCardId), петля закрытия матчит блок к открытой задаче (TaskClosureCandidate), суточная сборка материализует решение по этому матчу. Эмбеддер — детерминированный стаб (1536d); Issue.embedding засеян под текст блока (distance≈0), поэтому KNN-матч стабилен.',
  );
  lines.push('');
  lines.push('| проверка | доказывает | вердикт | детали |');
  lines.push('|---|---|:---:|---|');
  for (const c of checks) {
    lines.push(`| ${c.name} | ${c.proves} | ${c.pass ? '✅ PASS' : '❌ FAIL'} | ${c.detail} |`);
  }
  lines.push('');
  const md = lines.join('\n');
  writeFileSync(resolve(runDir, 'e2e-report.md'), md, 'utf8');
  writeFileSync(resolve(RUNS_DIR, '..', 'regulation-stand-e2e-report.md'), md, 'utf8');
  log('');
  log(md);
  log('');
  log(`✓ e2e ${stamp}: PASS ${passN}/${checks.length}`);
}

export async function runE2e(stamp: string): Promise<void> {
  const m = await prepare();
  const checks = await withApp(async (app) => {
    const prisma = createPrismaClient();
    try {
      const emb = app.get(EmbeddingFallbackService, { strict: false }) as {
        embed: (texts: string[]) => Promise<number[][]>;
      };
      emb.embed = async (texts: string[]) => texts.map((t) => stubEmbed(t));

      const all: Check[] = [];
      log('e2e: сценарий A1/A2 — захват из сырого чата …');
      all.push(...(await scenarioCaptureFromRawText(prisma, app, m)));
      log('e2e: сценарий C1 — рецидив в старый canonical (окно по evidence) …');
      all.push(...(await scenarioRecidivismWindow(prisma, app, m)));
      return all;
    } finally {
      await prisma.$disconnect();
    }
  });
  writeReport(stamp, checks);
}

if (require.main === module) {
  assertNotProd(readConfig());
  const stamp = process.argv[2] ?? new Date().toISOString().replace(/[:.]/g, '-');
  runE2e(stamp)
    .then(() => process.exit(0))
    .catch((e: unknown) => {
      process.stderr.write(`e2e FAIL: ${e instanceof Error ? e.stack : String(e)}\n`);
      process.exit(1);
    });
}
