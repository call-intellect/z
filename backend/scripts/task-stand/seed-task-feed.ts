import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { PrismaClient } from '@prisma/client';

import { EmbeddingFallbackService } from '../../src/modules/embeddings/services/embedding-fallback.service';
import { IssuesService } from '../../src/modules/tracker/services/issues.service';

import { assertNotProd, readConfig, sleep } from '../_lib/combat-harness';
import { createPrismaClient } from '../_lib/prisma';
import type { ScenarioExpect, StandManifest, StandManifestProject, StandManifestSetupTask } from './types';

const DOCS = resolve(process.cwd(), '../docs/testing');
const FIXTURES = resolve(DOCS, 'task-stand-fixtures.json');
const SCENARIOS = resolve(DOCS, 'task-stand-scenarios.json');
const MANIFEST = resolve(DOCS, 'task-stand-manifest.json');

type StateCategory = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled';
type MembershipRoleValue = 'owner' | 'admin' | 'manager' | 'coo' | 'hr_partner' | 'demo_observer';

interface FixturePerson {
  name: string;
  role: string;
  membership: string;
  assignable: boolean;
}

interface FixtureState {
  name: string;
  category: StateCategory;
  sequence: number;
  isDefault: boolean;
}

interface FixtureProject {
  key: string;
  identifier: string;
  name: string;
  isInboxFallback: boolean;
  states: FixtureState[];
}

interface FixtureSetupTask {
  key: string;
  tenant: 'A' | 'B';
  project: string;
  title: string;
  descriptionStripped: string;
  assignee: string | null;
  stateCategory: StateCategory;
  priority: 'urgent' | 'high' | 'medium' | 'low' | 'none';
  closed: boolean;
  embeddingRequired: boolean;
}

interface Fixtures {
  people: FixturePerson[];
  projects: FixtureProject[];
  setupTasks: FixtureSetupTask[];
  configPins: Record<string, unknown>;
}

interface Scenario {
  id: string;
  category: string;
  targets: string[];
  input: { channel: string };
  expect: { creates: string; count: number; fields?: Record<string, unknown>; notes?: string; extra?: string };
}

function log(s: string): void {
  process.stdout.write(`${s}\n`);
}

function loadFixtures(): Fixtures {
  const raw = JSON.parse(readFileSync(FIXTURES, 'utf8')) as Record<string, unknown>;
  return {
    people: raw['people'] as FixturePerson[],
    projects: raw['projects'] as FixtureProject[],
    setupTasks: raw['setupTasks'] as FixtureSetupTask[],
    configPins: raw['configPins'] as Record<string, unknown>,
  };
}

function loadScenarios(): Scenario[] {
  const raw = JSON.parse(readFileSync(SCENARIOS, 'utf8')) as { scenarios: Scenario[] };
  if (!Array.isArray(raw.scenarios)) throw new Error('scenarios: массив не найден');
  return raw.scenarios;
}

function membershipRole(fixtureValue: string): MembershipRoleValue {
  if (fixtureValue === 'owner') return 'owner';
  return 'manager';
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

interface OrgBootstrap {
  orgId: string;
  ownerUserId: string;
  people: Map<string, string>;
}

async function bootstrapOrg(
  prisma: PrismaClient,
  people: FixturePerson[],
  label: 'A' | 'B',
): Promise<OrgBootstrap> {
  const tag = `taskstand-${label.toLowerCase()}-${randomBytes(3).toString('hex')}`;
  const owner = people.find((p) => p.membership === 'owner');
  if (!owner) throw new Error(`bootstrapOrg ${label}: нет владельца в people`);

  const ownerUser = await prisma.user.create({
    data: {
      email: `${owner.name.toLowerCase()}.${tag}@task-stand.test`,
      name: owner.name,
      role: 'user',
      signupSource: 'standalone',
    },
  });
  const org = await prisma.org.create({
    data: {
      name: `Task-Stand ${label} [${tag}]`,
      slug: `${tag}-org`,
      ownerId: ownerUser.id,
      visibilityMode: 'open',
      tier: 'basic',
    },
  });
  await prisma.membership.create({ data: { orgId: org.id, userId: ownerUser.id, role: 'owner' } });
  await prisma.person.create({
    data: {
      tenantId: org.id,
      userId: ownerUser.id,
      name: owner.name,
      email: `${owner.name.toLowerCase()}.${tag}@task-stand.test`,
      relationship: 'employee',
      externalSource: 'task-stand',
    },
  });

  const peopleMap = new Map<string, string>([[owner.name, ownerUser.id]]);
  for (const p of people) {
    if (p.membership === 'owner') continue;
    const user = await prisma.user.create({
      data: {
        email: `${p.name.toLowerCase()}.${tag}@task-stand.test`,
        name: p.name,
        role: 'user',
        signupSource: 'standalone',
      },
    });
    await prisma.membership.create({ data: { orgId: org.id, userId: user.id, role: membershipRole(p.membership) } });
    await prisma.person.create({
      data: {
        tenantId: org.id,
        userId: user.id,
        name: p.name,
        email: `${p.name.toLowerCase()}.${tag}@task-stand.test`,
        relationship: 'employee',
        externalSource: 'task-stand',
      },
    });
    peopleMap.set(p.name, user.id);
  }
  return { orgId: org.id, ownerUserId: ownerUser.id, people: peopleMap };
}

async function createProject(
  prisma: PrismaClient,
  orgId: string,
  ownerUserId: string,
  fx: FixtureProject,
): Promise<void> {
  const project = await prisma.project.create({
    data: {
      tenantId: orgId,
      slug: `${fx.key}-${randomBytes(2).toString('hex')}`,
      identifier: fx.identifier,
      name: fx.name,
      ownerId: ownerUserId,
      network: 0,
      externalSource: 'task-stand',
    },
  });
  const states = await prisma.issueState.createManyAndReturn({
    data: fx.states.map((s) => ({
      tenantId: orgId,
      projectId: project.id,
      name: s.name,
      category: s.category,
      sequence: s.sequence,
      isDefault: s.isDefault,
      externalSource: 'task-stand',
    })),
    select: { id: true, isDefault: true },
  });
  const defaultStateId = states.find((s) => s.isDefault)?.id ?? null;
  if (defaultStateId) {
    await prisma.project.update({ where: { id: project.id }, data: { defaultStateId } });
  }
  await prisma.projectMember.create({ data: { projectId: project.id, userId: ownerUserId, role: 20 } });
  await prisma.board.create({
    data: {
      tenantId: orgId,
      projectId: project.id,
      name: 'Доска',
      color: '#5EEAD4',
      sequence: 0,
      isDefault: true,
    },
  });
}

async function pinKnobs(prisma: PrismaClient, configPins: Record<string, unknown>): Promise<void> {
  for (const [key, value] of Object.entries(configPins)) {
    if (key.startsWith('_')) continue;
    await prisma.adminSetting.upsert({
      where: { key },
      update: { value: value as never },
      create: {
        key,
        value: value as never,
        category: 'ai',
        section: 'tracker',
        severity: 'medium',
      },
    });
    log(`  knob ${key} = ${JSON.stringify(value)}`);
  }
}

export async function prepare(): Promise<{
  orgA: string;
  orgB: string;
  ownerUserIdA: string;
  ownerUserIdB: string;
  people: Record<string, string>;
  projects: string[];
}> {
  const prisma = createPrismaClient();
  try {
    const fx = loadFixtures();
    log('prepare: создаю ORG_A (полный мир) …');
    const a = await bootstrapOrg(prisma, fx.people, 'A');
    for (const proj of fx.projects) {
      await createProject(prisma, a.orgId, a.ownerUserId, proj);
      log(`  project A ${proj.key} (${proj.identifier}) — ${proj.states.length} статусов`);
    }
    log(`  люди A: ${[...a.people.keys()].join(', ')}`);

    log('prepare: создаю ORG_B (owner + ops) …');
    const ownerOnly = fx.people.filter((p) => p.membership === 'owner');
    const b = await bootstrapOrg(prisma, ownerOnly, 'B');
    const opsFx = fx.projects.find((p) => p.key === 'ops');
    if (!opsFx) throw new Error('prepare: проект ops не найден в фикстурах');
    await createProject(prisma, b.orgId, b.ownerUserId, opsFx);
    log(`  project B ${opsFx.key} (${opsFx.identifier})`);

    log('prepare: пины крутилок → AdminSetting …');
    await pinKnobs(prisma, fx.configPins);

    log('');
    log('=== ВПИШИТЕ В backend/.env ===');
    log(`TASK_STAND_ORG_A=${a.orgId}`);
    log(`TASK_STAND_ORG_B=${b.orgId}`);
    log('=============================');

    return {
      orgA: a.orgId,
      orgB: b.orgId,
      ownerUserIdA: a.ownerUserId,
      ownerUserIdB: b.ownerUserId,
      people: Object.fromEntries(a.people),
      projects: fx.projects.map((p) => p.key),
    };
  } finally {
    await prisma.$disconnect();
  }
}

function requireOrgA(): string {
  return process.env['TASK_STAND_ORG_A'] ?? process.env['STRELA_ORG'] ?? throwMissing('TASK_STAND_ORG_A');
}

function requireOrgB(): string {
  return process.env['TASK_STAND_ORG_B'] ?? throwMissing('TASK_STAND_ORG_B');
}

function throwMissing(name: string): never {
  throw new Error(`${name} не задан в env (сначала prepare → впишите значения)`);
}

async function resolvePeople(prisma: PrismaClient, orgId: string): Promise<Map<string, string>> {
  const persons = await prisma.person.findMany({
    where: { tenantId: orgId, deletedAt: null, userId: { not: null } },
    select: { name: true, userId: true },
  });
  const map = new Map<string, string>();
  for (const p of persons) if (p.userId) map.set(p.name, p.userId);
  return map;
}

async function resolveProjects(
  prisma: PrismaClient,
  orgId: string,
  fixtures: FixtureProject[],
): Promise<Map<string, StandManifestProject>> {
  const byIdentifier = new Map<string, FixtureProject>();
  for (const f of fixtures) byIdentifier.set(f.identifier, f);
  const rows = await prisma.project.findMany({
    where: { tenantId: orgId, deletedAt: null },
    select: { id: true, identifier: true, states: { select: { id: true, category: true } } },
  });
  const map = new Map<string, StandManifestProject>();
  for (const r of rows) {
    const fx = byIdentifier.get(r.identifier);
    if (!fx) continue;
    const states: Record<string, string> = {};
    for (const s of r.states) states[s.category] = s.id;
    map.set(fx.key, { id: r.id, identifier: r.identifier, states });
  }
  return map;
}

async function ownerUserId(prisma: PrismaClient, orgId: string): Promise<string> {
  const m = await prisma.membership.findFirst({ where: { orgId, role: 'owner' }, select: { userId: true } });
  if (!m) throw new Error(`owner membership не найден для ${orgId}`);
  return m.userId;
}

function buildEmbedText(title: string, descriptionStripped: string | null, description: string | null): string {
  const desc = (descriptionStripped ?? description ?? '').trim();
  const t = title.trim();
  if (t.length === 0 && desc.length === 0) return '';
  if (desc.length === 0) return t;
  return `${t}\n\n${desc}`;
}

async function embedIssue(
  prisma: PrismaClient,
  embeddings: EmbeddingFallbackService,
  issueId: string,
  tenantId: string,
): Promise<boolean> {
  const issue = await prisma.issue.findFirst({
    where: { id: issueId, tenantId },
    select: { title: true, description: true, descriptionStripped: true },
  });
  if (!issue) return false;
  const text = buildEmbedText(issue.title, issue.descriptionStripped, issue.description);
  if (text.length === 0) return false;
  const vectors = await embeddings.embed([text]);
  const vector = vectors[0];
  if (!vector || vector.length === 0) return false;
  const hash = createHash('sha256').update(text, 'utf8').digest('hex');
  await prisma.$executeRawUnsafe(
    'UPDATE "Issue" SET embedding = $1::vector, "embeddingHash" = $2 WHERE id = $3 AND "tenantId" = $4',
    `[${vector.join(',')}]`,
    hash,
    issueId,
    tenantId,
  );
  return true;
}

async function countEmbedded(prisma: PrismaClient, orgId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    'SELECT count(*)::int AS n FROM "Issue" WHERE "tenantId"=$1 AND embedding IS NOT NULL',
    orgId,
  );
  return rows[0]?.n ?? 0;
}

function scenarioExpect(s: Scenario): ScenarioExpect {
  return {
    creates: s.expect.creates,
    count: s.expect.count,
    ...(s.expect.fields ? { fields: s.expect.fields } : {}),
    ...((s.expect.notes ?? s.expect.extra) ? { notes: s.expect.notes ?? s.expect.extra } : {}),
    targets: s.targets ?? [],
    category: s.category,
    channel: s.input.channel,
  };
}

export async function seed(): Promise<StandManifest> {
  const orgA = requireOrgA();
  const orgB = requireOrgB();
  const fx = loadFixtures();
  const scenarios = loadScenarios();

  return withApp(async (app) => {
    const prisma = createPrismaClient();
    const issues = app.get(IssuesService, { strict: false });
    const embeddings = app.get(EmbeddingFallbackService, { strict: false });
    try {
      const [peopleA, projectsA, projectsB, ownerA, ownerB] = await Promise.all([
        resolvePeople(prisma, orgA),
        resolveProjects(prisma, orgA, fx.projects),
        resolveProjects(prisma, orgB, fx.projects),
        ownerUserId(prisma, orgA),
        ownerUserId(prisma, orgB),
      ]);
      log(`seed: люди A ${peopleA.size}, проекты A ${projectsA.size}, проекты B ${projectsB.size}`);

      const setup: Record<string, StandManifestSetupTask> = {};
      const warnings: string[] = [];

      for (const t of fx.setupTasks) {
        const tenantId = t.tenant === 'A' ? orgA : orgB;
        const actorUserId = t.tenant === 'A' ? ownerA : ownerB;
        const projects = t.tenant === 'A' ? projectsA : projectsB;
        const people = t.tenant === 'A' ? peopleA : new Map<string, string>();
        const project = projects.get(t.project);
        if (!project) throw new Error(`setup ${t.key}: проект ${t.project} не найден в тенанте ${t.tenant}`);

        let assigneeUserId: string | null = null;
        if (t.assignee) {
          const resolved = people.get(t.assignee);
          if (resolved) {
            assigneeUserId = resolved;
          } else {
            assigneeUserId = actorUserId;
            warnings.push(`setup ${t.key}: исполнитель «${t.assignee}» не найден среди людей → фолбэк на owner`);
          }
        }

        const created = await issues.create(
          project.id,
          {
            title: t.title,
            descriptionStripped: t.descriptionStripped,
            priority: t.priority,
            assigneeUserIds: assigneeUserId ? [assigneeUserId] : [],
            sortOrder: 0,
            labelIds: [],
            skipDedup: true,
          },
          tenantId,
          actorUserId,
        );

        if (t.stateCategory !== 'backlog') {
          await issues.transitionToCategory(created.id, t.stateCategory, tenantId, actorUserId);
        }

        setup[t.key] = {
          issueId: created.id,
          title: t.title,
          assigneeUserId,
          stateCategory: t.stateCategory,
          closed: t.closed,
          embeddingReady: false,
          tenant: t.tenant,
        };
      }
      log(`seed: создано ${Object.keys(setup).length} setup-задач`);
      for (const w of warnings) log(`  WARN ${w}`);

      const countA = fx.setupTasks.filter((t) => t.tenant === 'A').length;
      const countB = fx.setupTasks.filter((t) => t.tenant === 'B').length;
      log(`seed: считаю эмбеддинги напрямую (A=${countA}, B=${countB}) …`);
      for (const [key, task] of Object.entries(setup)) {
        const tenantId = task.tenant === 'A' ? orgA : orgB;
        try {
          task.embeddingReady = await embedIssue(prisma, embeddings, task.issueId, tenantId);
        } catch (e) {
          task.embeddingReady = false;
          log(`  WARN embed ${key}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const [readyA, readyB] = await Promise.all([countEmbedded(prisma, orgA), countEmbedded(prisma, orgB)]);
      log(`seed: эмбеддинги готовы A ${readyA}/${countA}, B ${readyB}/${countB}`);

      const scenarioMap: Record<string, ScenarioExpect> = {};
      for (const s of scenarios) scenarioMap[s.id] = scenarioExpect(s);

      const projectsManifest: Record<string, StandManifestProject> = {};
      for (const [key, val] of projectsA) projectsManifest[key] = val;

      const manifest: StandManifest = {
        orgA,
        orgB,
        ownerUserIdA: ownerA,
        ownerUserIdB: ownerB,
        people: Object.fromEntries(peopleA),
        projects: projectsManifest,
        setupTasks: setup,
        scenarios: scenarioMap,
        config: Object.fromEntries(Object.entries(fx.configPins).filter(([k]) => !k.startsWith('_'))),
        createdAt: new Date().toISOString(),
      };
      writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');

      log('');
      log(`✓ seed: манифест → ${MANIFEST}`);
      log(`  setupTasks: ${Object.keys(setup).length} (A ${countA} + B ${countB})`);
      log(`  scenarios (ground truth): ${Object.keys(scenarioMap).length}`);
      log(`  embeddingReady: ${Object.values(setup).filter((s) => s.embeddingReady).length}/${Object.keys(setup).length}`);
      return manifest;
    } finally {
      await prisma.$disconnect();
    }
  });
}

if (require.main === module) {
  assertNotProd(readConfig());
  const mode = process.argv[2] ?? 'prepare';
  const run = mode === 'seed' ? seed() : prepare();
  run
    .then(() => process.exit(0))
    .catch((e: unknown) => {
      process.stderr.write(`seed-task-feed FAIL: ${e instanceof Error ? e.stack : String(e)}\n`);
      process.exit(1);
    });
}
