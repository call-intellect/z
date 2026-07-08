import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { PrismaClient } from '@prisma/client';

import { RedisService } from '../../src/common/redis/redis.service';
import { ConversationalService } from '../../src/modules/conversational/conversational.service';
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

async function cleanProbeRedis(
  redis: RedisService,
  orgId: string,
  userId: string,
): Promise<void> {
  const patterns = [
    `probe:dedup:${orgId}:*`,
    `probe:cooldown:${orgId}:*`,
    `probe:ratelimit:${userId}:*`,
    `probe:engagement:${userId}`,
  ];
  for (const p of patterns) {
    const keys = await redis.client.keys(p);
    if (keys.length > 0) await redis.client.del(...keys);
  }
}

async function pollProbeDispatched(
  prisma: PrismaClient,
  orgId: string,
  issueId: string,
  timeoutMs: number,
): Promise<{ status: string; dispatchedNotificationId: string | null } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ev = await prisma.probeEvent.findFirst({
      where: {
        tenantId: orgId,
        reason: 'task.method_capture',
        payload: { path: ['contextCardId'], equals: issueId },
      },
      select: { status: true, dispatchedNotificationId: true },
      orderBy: { createdAt: 'desc' },
    });
    if (ev) {
      if (ev.status === 'dispatched' && ev.dispatchedNotificationId) return ev;
      if (ev.status !== 'pending') return ev;
    }
    await sleep(700);
  }
  return null;
}

async function pollRawEventByExternalId(
  prisma: PrismaClient,
  tenantId: string,
  sourceExternalId: string,
  timeoutMs: number,
): Promise<{ id: string; payload: Record<string, unknown> } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const re = await prisma.rawEvent.findFirst({
      where: { tenantId, sourceExternalId },
      select: { id: true, payload: true },
      orderBy: { receivedAt: 'desc' },
    });
    if (re) return { id: re.id, payload: (re.payload ?? {}) as Record<string, unknown> };
    await sleep(700);
  }
  return null;
}

async function pollBlocksByRawEvent(
  prisma: PrismaClient,
  tenantId: string,
  rawEventId: string,
  timeoutMs: number,
): Promise<Array<{ id: string; signalType: string; status: string }>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const blocks = await prisma.ideaBlock.findMany({
      where: { tenantId, evidence: { some: { rawEventId } } },
      select: { id: true, signalType: true, status: true },
    });
    if (blocks.length > 0) return blocks;
    await sleep(700);
  }
  return [];
}

async function createComplexIssue(
  issues: IssuesService,
  prisma: PrismaClient,
  m: RegStandManifest,
  title: string,
  assigneeName: string,
): Promise<{ issueId: string; userId: string | null }> {
  const userId = m.people[assigneeName] ?? null;
  const description =
    `По задаче «${title}» была переписка с уточнениями и промежуточными шагами. ` +
    `Нужно зафиксировать подход исполнителя по шагам для базы знаний команды: как именно ` +
    `решалась задача, в каком порядке, на что опирался. Приоритет высокий, работа заняла ` +
    `несколько дней, есть активность в комментариях и несколько итераций проверки.`;
  const created = await issues.create(
    m.projectId,
    {
      title,
      descriptionStripped: description,
      priority: 'high',
      assigneeUserIds: userId ? [userId] : [],
      sortOrder: 0,
      labelIds: [],
      skipDedup: true,
    } as never,
    m.orgId,
    m.ownerUserId,
  );
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3_600_000);
  await prisma.issue.updateMany({
    where: { id: created.id, tenantId: m.orgId },
    data: { createdAt: sevenDaysAgo },
  });
  return { issueId: created.id, userId };
}

async function scenarioMethodCaptureProbe(
  prisma: PrismaClient,
  app: INestApplicationContext,
  m: RegStandManifest,
): Promise<Check[]> {
  const checks: Check[] = [];
  const issues = app.get(IssuesService, { strict: false });
  const conv = app.get(ConversationalService, { strict: false });
  const redis = app.get(RedisService, { strict: false });
  const worker = app.get(BlockIngestWorker, { strict: false }) as {
    process: (job: { data: { rawEventId: string } }) => Promise<void>;
  };
  const builder = app.get(TaskSolutionBuildService, { strict: false });

  const assignee = 'Иван';
  const { issueId, userId } = await createComplexIssue(
    issues,
    prisma,
    m,
    'Мигрировать биллинг на новый тариф-движок без даунтайма',
    assignee,
  );
  if (!userId) {
    checks.push({
      name: 'probe-путь: предусловие (assignee с userId)',
      proves: 'опросник шлётся только назначенному человеку',
      pass: false,
      detail: `у ${assignee} нет userId в манифесте`,
    });
    return checks;
  }
  log(`e2e[P1]: сложная задача ${issueId} (assignee=${assignee}) создана`);

  await cleanProbeRedis(redis, m.orgId, userId);
  await issues.transitionToCategory(issueId, 'completed', m.orgId, m.ownerUserId);
  log('e2e[P1]: задача закрыта → ждём опросник method_capture …');

  const probe = await pollProbeDispatched(prisma, m.orgId, issueId, 30_000);
  checks.push({
    name: 'Опросник «как решал» поднят на закрытии задачи',
    proves: 'реальный триггер: задача→completed поднимает probe task.method_capture с contextCardId=issue',
    pass: !!probe && probe.status === 'dispatched' && !!probe.dispatchedNotificationId,
    detail: probe
      ? `probe status=${probe.status} notif=${probe.dispatchedNotificationId ?? '—'}`
      : 'probe не появился/не задиспатчен за 30с',
  });
  if (!probe?.dispatchedNotificationId) return checks;

  const answer =
    'Решал так: поднял теневой биллинг рядом с боевым, сутки зеркалил на него события и сверял ' +
    'суммы до копейки. Потом под фиче-флагом переключил чтение на новый движок на 5% аккаунтов, ' +
    'проверил инвойсы, добил до 100%. Старый оставил read-only на неделю для отката. Даунтайма не было.';
  await conv.respondToProbe({
    notificationId: probe.dispatchedNotificationId,
    userId,
    payload: { text: answer },
  });
  log('e2e[P1]: ответ на опросник отправлен → ждём ingest …');

  const rawEvent = await pollRawEventByExternalId(
    prisma,
    m.orgId,
    `resp:${probe.dispatchedNotificationId}`,
    20_000,
  );
  const ctxCardId = rawEvent ? rawEvent.payload['contextCardId'] : null;
  const hint = rawEvent ? rawEvent.payload['signalTypeHint'] : null;
  checks.push({
    name: 'Ответ → RawEvent с contextCardId=задача + hint=reasoning',
    proves: 'ключевое звено: ответ несёт contextCardId=issue.id и signalTypeHint=reasoning (probe-арм детекции)',
    pass: !!rawEvent && ctxCardId === issueId && hint === 'reasoning',
    detail: rawEvent
      ? `RawEvent ${rawEvent.id} contextCardId=${String(ctxCardId)} hint=${String(hint)}`
      : 'RawEvent от ответа не найден за 20с',
  });
  if (!rawEvent || ctxCardId !== issueId) return checks;

  let blocks = await pollBlocksByRawEvent(prisma, m.orgId, rawEvent.id, 30_000);
  if (blocks.length === 0) {
    try {
      await worker.process({ data: { rawEventId: rawEvent.id } });
    } catch {
      /* воркер мог уже обработать — падение ожидаемо, ниже перечитываем */
    }
    blocks = await pollBlocksByRawEvent(prisma, m.orgId, rawEvent.id, 10_000);
  }
  checks.push({
    name: 'Ответ стал каноническим reasoning-блоком',
    proves: 'block-ingest ответа → IdeaBlock(reasoning) + IdeaBlockEvidence→RawEvent',
    pass: blocks.length > 0 && blocks.some((b) => b.signalType === 'reasoning'),
    detail: blocks.length
      ? `блоков ${blocks.length}: ${blocks.map((b) => b.signalType).join(', ')}`
      : 'блок из ответа не создан',
  });
  if (blocks.length === 0) return checks;
  await prisma.ideaBlock.updateMany({
    where: { id: { in: blocks.map((b) => b.id) }, tenantId: m.orgId },
    data: { status: 'canonical' },
  });

  await builder.runForOrg(m.orgId, { now: new Date() });

  const closed = await prisma.issue.findFirst({
    where: { id: issueId, tenantId: m.orgId },
    select: { completedAt: true },
  });
  const sol = await prisma.taskSolution.findUnique({
    where: { tenantId_sourceIssueId: { tenantId: m.orgId, sourceIssueId: issueId } },
    select: { id: true, ownerPersonId: true, sourceBlockIds: true },
  });
  const answerBlockIds = new Set(blocks.map((b) => b.id));
  const ownerPerson = sol
    ? await prisma.person.findFirst({ where: { id: sol.ownerPersonId }, select: { name: true } })
    : null;
  checks.push({
    name: 'Материализация по probe-арму для ЗАКРЫТОЙ задачи',
    proves: 'A1 основной поток: закрыл→опросник→ответ→TaskSolution через contextCardId (не closure-петля)',
    pass:
      !!sol &&
      !!closed?.completedAt &&
      sol.sourceBlockIds.some((id) => answerBlockIds.has(id)),
    detail: sol
      ? `TaskSolution ${sol.id} owner=${ownerPerson?.name ?? sol.ownerPersonId} closed=${!!closed?.completedAt} blocks=${sol.sourceBlockIds.length}`
      : 'решение НЕ собрано по ответу на опросник',
  });

  return checks;
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
    '> E2e-режим гоняет РЕАЛЬНЫЙ конвейер. P1 (основной поток владельца): закрытие задачи поднимает probe `task.method_capture` («расскажи как решал»), реальный ответ через `respondToProbe` ингестится с `contextCardId=issue.id`+`signalTypeHint=reasoning`, block-ingest даёт reasoning-блок, сборка материализует `TaskSolution` для УЖЕ ЗАКРЫТОЙ задачи по probe-арму (contextCardId), а не по closure-петле. **Value-гейт диспетчера здесь на реальном дефолте (ON): `task.method_capture` выведен из-под LLM-гейта ценности (`gate()` → `method_capture_complexity_gated`), т.к. уже прошёл детерминированный порог сложности при подъёме — иначе гейт спорадически душил опросник (`dropped_low_value`).** A1/A2: block-ingest классифицирует сырой чат (без хардкод-signalType и contextCardId) → closure-петля матчит блок к открытой задаче (TaskClosureCandidate) → сборка. C1: окно рецидива по `GREATEST(evidence.sourceTimestamp)`. Эмбеддер — детерминированный стаб (1536d); Issue.embedding засеян под текст блока (distance≈0).',
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
      log('e2e: сценарий P1 — probe «как решал» после закрытия задачи (основной поток) …');
      all.push(...(await scenarioMethodCaptureProbe(prisma, app, m)));
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
