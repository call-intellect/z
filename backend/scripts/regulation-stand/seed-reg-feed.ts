import { execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { PrismaClient } from '@prisma/client';

import { KnowledgeEmbeddingService } from '../../src/modules/knowledge-core/services/embedding.service';
import { TaskSolutionBuildService } from '../../src/modules/knowledge-core/services/task-solution-build.service';
import { IssuesService } from '../../src/modules/tracker/services/issues.service';

import { assertNotProd, readConfig, sleep } from '../_lib/combat-harness';
import { createPrismaClient } from '../_lib/prisma';

import { stubEmbed } from './stub-embedder';

import { MANIFEST, RUNS_DIR, allRequiredPersons, loadA5Cases } from './corpus';
import type {
  A5Block,
  A5Case,
  A5RequiresIssue,
  BuildPassStats,
  ObservedTaskSolution,
  RawRun,
  RegStandManifest,
  ScenarioObservation,
} from './types';

const KNOBS: Record<string, unknown> = {
  'taskSolution.lookbackHours': 48,
  'taskSolution.minSignalChars': 15,
  'taskSolution.repeatThreshold': 3,
  'taskSolution.repeatSimilarity': 0.25,
  'taskSolution.refineEnabled': true,
  'taskSolution.howSolvedSignalTypes': ['reasoning', 'rationale', 'decision_basis', 'methodology_step'],
  'taskSolution.ownerInferenceEnabled': true,
  'taskSolution.maxPlaceholderRatio': 0.2,
  'aiFeatures.docCompilerEnabled': true,
};

const OWNER_NAME = 'Сергей';

function log(s: string): void {
  process.stdout.write(`${s}\n`);
}

function headCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function channelToSourceType(channel: string): string {
  if (channel === 'chat') return 'chat';
  if (channel === 'planerka') return 'meeting';
  return 'conversational';
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

export async function prepare(): Promise<RegStandManifest> {
  const prisma = createPrismaClient();
  try {
    const cases = loadA5Cases();
    const persons = allRequiredPersons(cases);
    if (!persons.includes(OWNER_NAME)) persons.push(OWNER_NAME);
    const tag = `regstand-a5-${randomBytes(3).toString('hex')}`;
    log(`prepare: тенант ${tag}, персон ${persons.length} (${persons.join(', ')})`);

    const ownerUser = await prisma.user.create({
      data: {
        email: `sergey.${tag}@reg-stand.test`,
        name: OWNER_NAME,
        role: 'user',
        signupSource: 'standalone',
      },
    });
    const org = await prisma.org.create({
      data: {
        name: `Reg-Stand A5 [${tag}]`,
        slug: `${tag}-org`,
        ownerId: ownerUser.id,
        visibilityMode: 'open',
        tier: 'basic',
      },
    });
    await prisma.membership.create({ data: { orgId: org.id, userId: ownerUser.id, role: 'owner' } });
    const ownerPerson = await prisma.person.create({
      data: {
        tenantId: org.id,
        userId: ownerUser.id,
        name: OWNER_NAME,
        email: `sergey.${tag}@reg-stand.test`,
        relationship: 'employee',
        externalSource: 'reg-stand',
      },
    });

    const people: Record<string, string> = { [OWNER_NAME]: ownerUser.id };
    const personIds: Record<string, string> = { [OWNER_NAME]: ownerPerson.id };
    for (const name of persons) {
      if (name === OWNER_NAME) continue;
      const slug = createHash('sha1').update(name).digest('hex').slice(0, 8);
      const user = await prisma.user.create({
        data: {
          email: `${slug}.${tag}@reg-stand.test`,
          name,
          role: 'user',
          signupSource: 'standalone',
        },
      });
      await prisma.membership.create({ data: { orgId: org.id, userId: user.id, role: 'manager' } });
      const person = await prisma.person.create({
        data: {
          tenantId: org.id,
          userId: user.id,
          name,
          email: `${slug}.${tag}@reg-stand.test`,
          relationship: 'employee',
          externalSource: 'reg-stand',
        },
      });
      people[name] = user.id;
      personIds[name] = person.id;
    }

    const project = await prisma.project.create({
      data: {
        tenantId: org.id,
        slug: `${tag}-proj`,
        identifier: 'A5',
        name: 'A5 Задачи',
        ownerId: ownerUser.id,
        network: 0,
        externalSource: 'reg-stand',
      },
    });
    const states = await prisma.issueState.createManyAndReturn({
      data: [
        { tenantId: org.id, projectId: project.id, name: 'Бэклог', category: 'backlog', sequence: 0, isDefault: true, externalSource: 'reg-stand' },
        { tenantId: org.id, projectId: project.id, name: 'В работе', category: 'started', sequence: 1, isDefault: false, externalSource: 'reg-stand' },
        { tenantId: org.id, projectId: project.id, name: 'Готово', category: 'completed', sequence: 2, isDefault: false, externalSource: 'reg-stand' },
      ],
      select: { id: true, isDefault: true },
    });
    const defaultStateId = states.find((s) => s.isDefault)?.id ?? null;
    if (defaultStateId) {
      await prisma.project.update({ where: { id: project.id }, data: { defaultStateId } });
    }
    await prisma.projectMember.create({ data: { projectId: project.id, userId: ownerUser.id, role: 20 } });
    await prisma.board.create({
      data: {
        tenantId: org.id,
        projectId: project.id,
        name: 'Доска',
        color: '#5EEAD4',
        sequence: 0,
        isDefault: true,
      },
    });

    for (const [key, value] of Object.entries(KNOBS)) {
      await prisma.adminSetting.upsert({
        where: { key },
        update: { value: value as never },
        create: { key, value: value as never, category: 'ai', section: 'task-solution', severity: 'medium' },
      });
      log(`  knob ${key} = ${JSON.stringify(value)}`);
    }

    const manifest: RegStandManifest = {
      orgId: org.id,
      ownerUserId: ownerUser.id,
      projectId: project.id,
      defaultStateId,
      people,
      personIds,
      config: KNOBS,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
    log('');
    log(`✓ prepare: манифест → ${MANIFEST}`);
    log(`  orgId=${org.id} project=${project.id}`);
    return manifest;
  } finally {
    await prisma.$disconnect();
  }
}

function loadManifest(): RegStandManifest {
  return JSON.parse(readFileSync(MANIFEST, 'utf8')) as RegStandManifest;
}

async function ensureSource(prisma: PrismaClient, tenantId: string, sourceType: string): Promise<string> {
  const s = await prisma.source.upsert({
    where: { tenantId_type_name: { tenantId, type: sourceType as never, name: `reg-stand-${sourceType}` } },
    update: {},
    create: { tenantId, type: sourceType as never, name: `reg-stand-${sourceType}`, dataClass: 'internal', isActive: true },
    select: { id: true },
  });
  return s.id;
}

async function seedBlock(
  prisma: PrismaClient,
  tenantId: string,
  channel: string,
  issueId: string | null,
  block: A5Block,
  now: Date,
): Promise<string> {
  const sourceType = channelToSourceType(channel);
  const sourceId = await ensureSource(prisma, tenantId, sourceType);
  const payload: Record<string, unknown> = { text: block.trustedAnswer };
  if (issueId) payload['contextCardId'] = issueId;
  const payloadJson = JSON.stringify(payload);
  const rand = randomBytes(8).toString('hex');
  const idempotencyKey = createHash('sha256').update(`${sourceId}:${rand}:${now.toISOString()}`).digest('hex');
  const rawEvent = await prisma.rawEvent.create({
    data: {
      tenantId,
      sourceId,
      sourceType: sourceType as never,
      sourceExternalId: rand,
      idempotencyKey,
      occurredAt: now,
      payloadStorage: 'inline',
      payload: payload as never,
      payloadChecksum: createHash('sha256').update(payloadJson).digest('hex'),
      payloadSizeBytes: Buffer.byteLength(payloadJson, 'utf8'),
      dataClass: 'internal',
      processingStatus: 'ingested',
    },
    select: { id: true },
  });
  const ideaBlock = await prisma.ideaBlock.create({
    data: {
      tenantId,
      name: block.name,
      criticalQuestion: block.criticalQuestion ?? block.name,
      trustedAnswer: block.trustedAnswer,
      tags: block.tags ?? [],
      signalType: block.signalType as never,
      status: 'canonical',
      dataClass: 'internal',
      externalSource: 'reg-stand',
      evidenceCount: 1,
    },
    select: { id: true },
  });
  await prisma.ideaBlockEvidence.create({
    data: {
      tenantId,
      blockId: ideaBlock.id,
      rawEventId: rawEvent.id,
      sourceType: sourceType as never,
      quote: block.evidenceQuotes?.[0] ?? block.trustedAnswer,
      sourceTimestamp: now,
    },
  });
  return ideaBlock.id;
}

function issueAssigneeNames(ri: A5RequiresIssue): string[] {
  if (ri.assignees && ri.assignees.length > 0) return ri.assignees;
  return ri.assignee ? [ri.assignee] : [];
}

async function createIssue(
  issues: IssuesService,
  m: RegStandManifest,
  title: string,
  assigneeNames: string[],
): Promise<string> {
  const assigneeUserIds = [
    ...new Set(assigneeNames.map((n) => m.people[n]).filter((u): u is string => !!u)),
  ];
  const created = await issues.create(
    m.projectId,
    {
      title,
      descriptionStripped: title,
      priority: 'medium',
      assigneeUserIds,
      sortOrder: 0,
      labelIds: [],
      skipDedup: true,
    } as never,
    m.orgId,
    m.ownerUserId,
  );
  return created.id;
}

const PRIMERS: Array<{ title: string; assignee: string; answer: string; tags: string[] }> = [
  { title: 'Инцидент 429 у клиента Альфа', assignee: 'Михаил', answer: 'Сделал так же: поставил лимитер на исходящие, очередь ретраев с бэкоффом, прогнал под нагрузкой.', tags: ['429', 'повтор'] },
  { title: 'Инцидент 429 у клиента Бета', assignee: 'Михаил', answer: 'Опять 429 — лимитер, очередь ретраев, экспоненциальный бэкофф, тот же приём что и раньше.', tags: ['429', 'повтор'] },
];

async function runForOrg(builder: TaskSolutionBuildService, orgId: string, now: Date): Promise<BuildPassStats> {
  const s = await builder.runForOrg(orgId, { now });
  return {
    candidates: s.candidates,
    created: s.created,
    updated: s.updated,
    skippedNoOwner: s.skippedNoOwner,
    skippedGate: s.skippedGate,
    skippedNoMethod: s.skippedNoMethod,
    skippedNoNew: s.skippedNoNew,
    skippedCompilerUnavailable: s.skippedCompilerUnavailable,
  };
}

async function observe(
  prisma: PrismaClient,
  m: RegStandManifest,
  cases: A5Case[],
  issueByScenario: Map<string, string>,
  blockIdsByScenario: Map<string, string[]>,
): Promise<ScenarioObservation[]> {
  const personNameById = new Map<string, string>();
  for (const [name, id] of Object.entries(m.personIds)) personNameById.set(id, name);

  const out: ScenarioObservation[] = [];
  for (const c of cases) {
    const scenarioId = c.scenario.id;
    const issueId = issueByScenario.get(scenarioId) ?? null;
    const blockIds = blockIdsByScenario.get(scenarioId) ?? [];

    let solution: ObservedTaskSolution | null = null;
    let solutionCountForIssue = 0;
    if (issueId) {
      const rows = await prisma.taskSolution.findMany({
        where: { tenantId: m.orgId, sourceIssueId: issueId, deletedAt: null },
      });
      solutionCountForIssue = rows.length;
      const row = rows[0];
      if (row) {
        const emb = await prisma.$queryRawUnsafe<Array<{ has: boolean }>>(
          'SELECT (embedding IS NOT NULL) AS has FROM "task_solutions" WHERE id = $1',
          row.id,
        );
        let signals: string[] = [];
        if (row.currentVersionId) {
          const cv = await prisma.cardVersion.findUnique({
            where: { id: row.currentVersionId },
            select: { payload: true },
          });
          const payload = cv?.payload as { signals?: unknown } | null;
          if (payload && Array.isArray(payload.signals)) {
            signals = payload.signals.filter((s): s is string => typeof s === 'string');
          }
        }
        solution = {
          id: row.id,
          title: row.title,
          ownerPersonId: row.ownerPersonId,
          ownerPersonName: personNameById.get(row.ownerPersonId) ?? null,
          personSubjectIds: row.personSubjectIds,
          subjectPersonNames: row.personSubjectIds.map((id) => personNameById.get(id) ?? id),
          sourceIssueId: row.sourceIssueId,
          sourceBlockIds: row.sourceBlockIds,
          skillTags: row.skillTags,
          solutionMd: row.solutionMd,
          repeatGroupKey: row.repeatGroupKey,
          candidateInstruction: row.candidateInstruction,
          version: row.version,
          hasEmbedding: emb[0]?.has ?? false,
          signals,
        };
      }
    }

    let sourceBlocksStillCanonical = true;
    if (blockIds.length > 0) {
      const canon = await prisma.ideaBlock.count({
        where: { tenantId: m.orgId, id: { in: blockIds }, status: 'canonical' },
      });
      sourceBlocksStillCanonical = canon === blockIds.length;
    }

    out.push({
      scenarioId,
      cell: c.scenario.cell,
      trap: c.scenario.trap,
      issueId,
      assignee: c.scenario.requiresIssue?.assignee ?? null,
      solution,
      solutionCountForIssue,
      sourceBlockIds: blockIds,
      sourceBlocksStillCanonical,
    });
  }
  return out;
}

export async function build(stamp: string): Promise<RawRun> {
  const m = loadManifest();
  const cases = loadA5Cases();
  const runDir = resolve(RUNS_DIR, stamp);
  mkdirSync(runDir, { recursive: true });

  return withApp(async (app) => {
    const prisma = createPrismaClient();
    const builder = app.get(TaskSolutionBuildService, { strict: false });
    const issues = app.get(IssuesService, { strict: false });
    const embedder = app.get(KnowledgeEmbeddingService, { strict: false }) as {
      embedQuery: (text: string) => Promise<number[] | null>;
    };
    embedder.embedQuery = async (text: string) => stubEmbed(text);
    try {
      const now = new Date();
      const issueByScenario = new Map<string, string>();
      const blockIdsByScenario = new Map<string, string[]>();

      log('build: фаза create (order=1) …');
      for (const c of cases) {
        const s = c.scenario;
        let issueId: string | null = null;
        if (s.requiresIssue) {
          issueId = await createIssue(
            issues,
            m,
            s.requiresIssue.title,
            issueAssigneeNames(s.requiresIssue),
          );
          issueByScenario.set(s.id, issueId);
        }
        const firstBlocks = s.blocks.filter((b) => b.order <= 1);
        const seeded: string[] = [];
        for (const b of firstBlocks) {
          const id = await seedBlock(prisma, m.orgId, s.channel, issueId, b, now);
          seeded.push(id);
        }
        blockIdsByScenario.set(s.id, seeded);
        log(`  ${s.id}: issue=${issueId ? 'yes' : 'NO-LINK'} blocks(order≤1)=${seeded.length}`);
      }

      log('build: посев праймеров 429 (для репит-кластера) …');
      for (const p of PRIMERS) {
        const iid = await createIssue(issues, m, p.title, [p.assignee]);
        await seedBlock(
          prisma,
          m.orgId,
          'chat',
          iid,
          { order: 1, signalType: 'methodology_step', name: p.title, trustedAnswer: p.answer, tags: p.tags, solverPerson: p.assignee },
          now,
        );
      }

      const createStats = await runForOrg(builder, m.orgId, now);
      log(`  create: ${JSON.stringify(createStats)}`);

      log('build: фаза extend (order≥2) …');
      let extendSeeded = 0;
      for (const c of cases) {
        const s = c.scenario;
        const laterBlocks = s.blocks.filter((b) => b.order >= 2);
        if (laterBlocks.length === 0) continue;
        const issueId = issueByScenario.get(s.id) ?? null;
        const prev = blockIdsByScenario.get(s.id) ?? [];
        for (const b of laterBlocks) {
          const id = await seedBlock(prisma, m.orgId, s.channel, issueId, b, now);
          prev.push(id);
          extendSeeded += 1;
        }
        blockIdsByScenario.set(s.id, prev);
      }
      log(`  посеяно доп. блоков: ${extendSeeded}`);
      const extendStats = extendSeeded > 0 ? await runForOrg(builder, m.orgId, now) : { candidates: 0, created: 0, updated: 0, skippedNoOwner: 0, skippedGate: 0, skippedNoMethod: 0, skippedNoNew: 0, skippedCompilerUnavailable: 0 };
      log(`  extend: ${JSON.stringify(extendStats)}`);

      log('build: фаза idempotency (повтор без новых блоков → Δ=0) …');
      const idemStats = await runForOrg(builder, m.orgId, now);
      log(`  idempotency: ${JSON.stringify(idemStats)}`);

      const embRows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
        'SELECT count(*)::int AS n FROM "task_solutions" WHERE "tenantId" = $1 AND embedding IS NOT NULL',
        m.orgId,
      );
      const embeddingsWritten = embRows[0]?.n ?? 0;

      const observations = await observe(prisma, m, cases, issueByScenario, blockIdsByScenario);

      const raw: RawRun = {
        stamp,
        orgId: m.orgId,
        headCommit: headCommit(),
        createdAt: new Date().toISOString(),
        passStats: { create: createStats, extend: extendStats, idempotency: idemStats },
        embeddingsWritten,
        observations,
        config: m.config,
      };
      writeFileSync(resolve(runDir, 'raw.json'), JSON.stringify(raw, null, 2), 'utf8');
      log('');
      log(`✓ build: raw → ${resolve(runDir, 'raw.json')}`);
      log(`  создано TaskSolution: ${observations.filter((o) => o.solution).length}/${cases.length}`);
      log(`  эмбеддингов записано: ${embeddingsWritten}`);
      return raw;
    } finally {
      await prisma.$disconnect();
    }
  });
}

if (require.main === module) {
  assertNotProd(readConfig());
  const mode = process.argv[2] ?? 'prepare';
  const stamp = process.argv[3] ?? new Date().toISOString().replace(/[:.]/g, '-');
  const run = mode === 'build' ? build(stamp) : prepare();
  run
    .then(() => process.exit(0))
    .catch((e: unknown) => {
      process.stderr.write(`seed-reg-feed FAIL: ${e instanceof Error ? e.stack : String(e)}\n`);
      process.exit(1);
    });
}
