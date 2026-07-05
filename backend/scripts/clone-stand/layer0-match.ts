import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { PrismaClient } from '@prisma/client';

import { directLlmCall } from '../_lib/llm-direct';
import { assertNotProd, readConfig } from '../_lib/combat-harness';
import { createPrismaClient } from '../_lib/prisma';

import { CLONES } from './clone-seed-data';

const JUDGE_MODEL = 'deepseek-v4-pro';
const DOCS = resolve(process.cwd(), '../docs/testing');

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

function requireOrg(): string {
  const org = process.env['STRELA_ORG'];
  if (!org) throw new Error('STRELA_ORG не задан — пере-сей Стрелу и пропиши STRELA_ORG в .env');
  return org;
}

interface ManifestExpected {
  methodId: string;
  derivedStatement: string;
  agreement: string;
}

interface ManifestBearer {
  name: string;
  clone: string;
  expectedTraits: ManifestExpected[];
}

interface Manifest {
  bearers: ManifestBearer[];
}

interface DbTrait {
  id: string;
  statement: string;
  sourceBlockIds: string[];
  conceptId: string | null;
  layer: string;
}

interface MatchDetail {
  methodId: string;
  derivedStatement: string;
  matched: boolean;
  matchedTraitId: string | null;
  matchedStatement: string | null;
  hasSourceBlocks: boolean;
  derived: boolean;
  inPersona: boolean;
}

interface BearerReport {
  name: string;
  clone: string;
  personResolved: boolean;
  profileResolved: boolean;
  activeTraitCount: number;
  expectedCount: number;
  matchedCount: number;
  derivationPassed: number;
  personaIn: number;
  unmatched: Array<{ methodId: string; derivedStatement: string }>;
  details: MatchDetail[];
}

interface FalseMergeReport {
  supportRoleResolved: boolean;
  activeBearerName: string | null;
  activeVersion: number | null;
  leakCount: number;
  leakDetail: string[];
  frozenPresent: boolean;
  versions: Array<{ roleVersion: number | null; status: string; bearerName: string | null; traits: number }>;
  pass: boolean;
}

const RECALL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    matched: { type: 'boolean' },
    matchedIndex: { type: 'number' },
    rationale: { type: 'string' },
  },
  required: ['matched', 'matchedIndex', 'rationale'],
} as const;

const DERIVED_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    derived: { type: 'boolean' },
    rationale: { type: 'string' },
  },
  required: ['derived', 'rationale'],
} as const;

function extractJson(raw: string): string {
  const cleaned = raw.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return cleaned;
  return cleaned.slice(start, end + 1);
}

async function llmJson<T>(args: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  toolName: string;
  validate: (parsed: T) => boolean;
}): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await directLlmCall({
        provider: 'deepseek',
        model: JUDGE_MODEL,
        system: args.system,
        user: args.user,
        schema: args.schema,
        schemaName: args.toolName,
        toolName: args.toolName,
        maxTokens: 800,
      });
      if (res.error) throw new Error(`judge LLM error: ${res.error}`);
      const raw = res.toolCallArgs ?? res.text;
      if (!raw) throw new Error('judge: пустой ответ LLM');
      const parsed = JSON.parse(extractJson(raw)) as T;
      if (!args.validate(parsed)) throw new Error('judge: ответ не соответствует схеме');
      return parsed;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, attempt * 1200));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const RECALL_SYSTEM = [
  'Ты — судья покрытия смысла (Слой 0, benefit-of-doubt). Дана ОЖИДАЕМАЯ черта метода человека (выведена слепо из сырья) и список черт его профиля в базе клона.',
  'Найди черту базы, которая покрывает СМЫСЛ ожидаемой — тот же поведенческий принцип, пусть иными словами.',
  'Верни matchedIndex — номер (1..N) наиболее подходящей черты; 0 если ни одна не покрывает смысл. matched=true, если покрытие есть.',
  'Сравнивай ЛОГИКУ/ПОДХОД, не слова. Сомневаешься между близкими — засчитывай (benefit-of-doubt).',
  'Отвечай ТОЛЬКО вызовом judge_recall. Если инструмент недоступен — верни чистый JSON по схеме.',
].join('\n');

async function judgeRecall(expected: string, candidates: DbTrait[]): Promise<{ matched: boolean; index: number }> {
  if (candidates.length === 0) return { matched: false, index: -1 };
  const user = [
    `Ожидаемая черта: ${expected}`,
    'Черты профиля в базе:',
    ...candidates.map((c, i) => `${i + 1}. ${c.statement}`),
  ].join('\n');
  let res: { matched: boolean; matchedIndex: number; rationale: string };
  try {
    res = await llmJson<{ matched: boolean; matchedIndex: number; rationale: string }>({
      system: RECALL_SYSTEM,
      user,
      schema: RECALL_SCHEMA as unknown as Record<string, unknown>,
      toolName: 'judge_recall',
      validate: (p) => typeof p.matched === 'boolean' && typeof p.matchedIndex === 'number',
    });
  } catch {
    return { matched: false, index: -1 };
  }
  const idx = Math.trunc(res.matchedIndex) - 1;
  if (!res.matched || idx < 0 || idx >= candidates.length) return { matched: false, index: -1 };
  return { matched: true, index: idx };
}

const DERIVED_SYSTEM = [
  'Ты — судья деривации (правило №1 против тавтологии). Дана ожидаемая черта (выведена слепо из сырья) и черта из базы клона.',
  'derived=true, если черта базы — осмысленно ВЫВЕДЕННЫЙ поведенческий принцип, совместимый по смыслу с ожидаемой, а НЕ пустой ярлык и не дословная копия одной фразы без обобщения.',
  'derived=false ТОЛЬКО если это тавтология/ярлык без вывода или бессмысленный обрывок.',
  'Benefit-of-doubt: сомневаешься — derived=true. Отвечай ТОЛЬКО вызовом judge_derived; иначе чистый JSON по схеме.',
].join('\n');

async function judgeDerived(expected: string, dbStatement: string): Promise<boolean> {
  const user = [`Ожидаемая черта: ${expected}`, `Черта базы: ${dbStatement}`].join('\n');
  try {
    const res = await llmJson<{ derived: boolean; rationale: string }>({
      system: DERIVED_SYSTEM,
      user,
      schema: DERIVED_SCHEMA as unknown as Record<string, unknown>,
      toolName: 'judge_derived',
      validate: (p) => typeof p.derived === 'boolean',
    });
    return res.derived;
  } catch {
    return true;
  }
}

async function personaTraitIdsFor(
  prisma: PrismaClient,
  orgId: string,
  profileId: string | null,
  personId: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  if (profileId) {
    const personPersonas = await prisma.executablePersona.findMany({
      where: { tenantId: orgId, scope: 'person', profileId, status: 'active' },
      select: { includedTraitIds: true },
    });
    for (const p of personPersonas) for (const id of p.includedTraitIds) ids.add(id);
  }
  const rolePersonas = await prisma.executablePersona.findMany({
    where: { tenantId: orgId, scope: 'role', status: 'active', currentBearerPersonId: personId },
    select: { includedTraitIds: true },
  });
  for (const p of rolePersonas) for (const id of p.includedTraitIds) ids.add(id);
  return ids;
}

async function matchBearer(prisma: PrismaClient, orgId: string, b: ManifestBearer): Promise<BearerReport> {
  const report: BearerReport = {
    name: b.name,
    clone: b.clone,
    personResolved: false,
    profileResolved: false,
    activeTraitCount: 0,
    expectedCount: b.expectedTraits.length,
    matchedCount: 0,
    derivationPassed: 0,
    personaIn: 0,
    unmatched: [],
    details: [],
  };

  const person = await prisma.person.findFirst({
    where: { tenantId: orgId, name: b.name, relationship: 'employee', deletedAt: null },
    select: { id: true },
  });
  if (!person) {
    log(`  ! ${b.name}: person не найден — все ожидаемые черты missing`);
    for (const e of b.expectedTraits) {
      report.unmatched.push({ methodId: e.methodId, derivedStatement: e.derivedStatement });
      report.details.push({
        methodId: e.methodId,
        derivedStatement: e.derivedStatement,
        matched: false,
        matchedTraitId: null,
        matchedStatement: null,
        hasSourceBlocks: false,
        derived: false,
        inPersona: false,
      });
    }
    return report;
  }
  report.personResolved = true;

  const profile = await prisma.skillProfile.findFirst({
    where: { tenantId: orgId, personId: person.id },
    select: { id: true },
  });
  const traits: DbTrait[] = profile
    ? (
        await prisma.skillTrait.findMany({
          where: { profileId: profile.id, status: 'active' },
          select: { id: true, statement: true, sourceBlockIds: true, conceptId: true, layer: true },
        })
      ).map((t) => ({
        id: t.id,
        statement: t.statement,
        sourceBlockIds: t.sourceBlockIds,
        conceptId: t.conceptId,
        layer: String(t.layer),
      }))
    : [];
  report.profileResolved = Boolean(profile);
  report.activeTraitCount = traits.length;

  const personaIds = profile ? await personaTraitIdsFor(prisma, orgId, profile.id, person.id) : new Set<string>();

  for (const e of b.expectedTraits) {
    const rec = await judgeRecall(e.derivedStatement, traits);
    if (!rec.matched) {
      report.unmatched.push({ methodId: e.methodId, derivedStatement: e.derivedStatement });
      report.details.push({
        methodId: e.methodId,
        derivedStatement: e.derivedStatement,
        matched: false,
        matchedTraitId: null,
        matchedStatement: null,
        hasSourceBlocks: false,
        derived: false,
        inPersona: false,
      });
      log(`    · ${e.methodId}: MISS`);
      continue;
    }
    const trait = traits[rec.index];
    if (!trait) continue;
    report.matchedCount++;
    const hasSourceBlocks = trait.sourceBlockIds.length >= 1;
    const derived = hasSourceBlocks ? await judgeDerived(e.derivedStatement, trait.statement) : false;
    if (hasSourceBlocks && derived) report.derivationPassed++;
    const inPersona = personaIds.has(trait.id);
    if (inPersona) report.personaIn++;
    report.details.push({
      methodId: e.methodId,
      derivedStatement: e.derivedStatement,
      matched: true,
      matchedTraitId: trait.id,
      matchedStatement: trait.statement,
      hasSourceBlocks,
      derived,
      inPersona,
    });
    log(`    · ${e.methodId}: HIT src=${hasSourceBlocks ? trait.sourceBlockIds.length : 0} derived=${derived} persona=${inPersona}`);
  }

  return report;
}

async function activeTraitIdSet(prisma: PrismaClient, orgId: string, personId: string): Promise<Set<string>> {
  const profile = await prisma.skillProfile.findFirst({
    where: { tenantId: orgId, personId },
    select: { id: true },
  });
  if (!profile) return new Set<string>();
  const traits = await prisma.skillTrait.findMany({
    where: { profileId: profile.id, status: 'active' },
    select: { id: true },
  });
  return new Set(traits.map((t) => t.id));
}

async function checkFalseMerge(prisma: PrismaClient, orgId: string, manifest: Manifest): Promise<FalseMergeReport> {
  const report: FalseMergeReport = {
    supportRoleResolved: false,
    activeBearerName: null,
    activeVersion: null,
    leakCount: 0,
    leakDetail: [],
    frozenPresent: false,
    versions: [],
    pass: false,
  };

  const supportClone = CLONES.find((c) => c.key === 'support');
  const supportRoleName = supportClone?.roleName ?? 'Руководитель поддержки';
  const role = await prisma.role.findFirst({
    where: { tenantId: orgId, name: supportRoleName, deletedAt: null },
    select: { id: true },
  });
  if (!role) {
    log('  ! support role не найдена — no_false_merge пропущен');
    return report;
  }
  report.supportRoleResolved = true;

  const supportBearers = manifest.bearers.filter((b) => b.clone === 'support');
  const bearerByPerson = new Map<string, { name: string; traitIds: Set<string> }>();
  for (const b of supportBearers) {
    const person = await prisma.person.findFirst({
      where: { tenantId: orgId, name: b.name, relationship: 'employee', deletedAt: null },
      select: { id: true },
    });
    if (!person) continue;
    const traitIds = await activeTraitIdSet(prisma, orgId, person.id);
    bearerByPerson.set(person.id, { name: b.name, traitIds });
  }

  const personas = await prisma.executablePersona.findMany({
    where: { tenantId: orgId, scope: 'role', scopeRefId: role.id },
    select: { roleVersion: true, status: true, includedTraitIds: true, currentBearerPersonId: true },
    orderBy: { roleVersion: 'desc' },
  });

  for (const p of personas) {
    const bearerName = p.currentBearerPersonId ? bearerByPerson.get(p.currentBearerPersonId)?.name ?? null : null;
    report.versions.push({
      roleVersion: p.roleVersion,
      status: String(p.status),
      bearerName,
      traits: p.includedTraitIds.length,
    });
    if (String(p.status) === 'frozen') report.frozenPresent = true;
  }

  const active = personas.find((p) => String(p.status) === 'active');
  if (active) {
    report.activeVersion = active.roleVersion;
    const currentPersonId = active.currentBearerPersonId;
    report.activeBearerName = currentPersonId ? bearerByPerson.get(currentPersonId)?.name ?? null : null;
    for (const [personId, info] of bearerByPerson) {
      if (personId === currentPersonId) continue;
      const leaked = active.includedTraitIds.filter((id) => info.traitIds.has(id));
      if (leaked.length > 0) {
        report.leakCount += leaked.length;
        report.leakDetail.push(`активная персона содержит ${leaked.length} черт носителя ${info.name}`);
      }
    }
  }

  report.pass = report.supportRoleResolved && report.leakCount === 0 && report.frozenPresent;
  return report;
}

function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : '—';
}

function buildReport(bearers: BearerReport[], fm: FalseMergeReport, orgId: string, stamp: string): string {
  const lines: string[] = [];
  lines.push('# Клон-стенд Слой 0 — фиделити построения (read-only)');
  lines.push('');
  lines.push(`Прогон: ${stamp}. Org: ${orgId}. Метод: docs/methodology/synthetic-fidelity-eval-method.md.`);
  lines.push('Baseline-замер: пороги — non-regression, не абсолют (первый прогон).');
  lines.push('');

  const totExpected = bearers.reduce((a, b) => a + b.expectedCount, 0);
  const totMatched = bearers.reduce((a, b) => a + b.matchedCount, 0);
  const totDerivation = bearers.reduce((a, b) => a + b.derivationPassed, 0);
  const totPersona = bearers.reduce((a, b) => a + b.personaIn, 0);

  lines.push('## Сводка');
  lines.push('');
  lines.push(`- trait recall: ${totMatched}/${totExpected} (${pct(totMatched, totExpected)})`);
  lines.push(`- derivation (правило №1): ${totDerivation}/${totMatched} (${pct(totDerivation, totMatched)})`);
  lines.push(`- persona fidelity: ${totPersona}/${totMatched} (${pct(totPersona, totMatched)})`);
  lines.push(`- no_false_merge: ${fm.pass ? 'PASS' : 'FAIL'} (leak=${fm.leakCount}, frozen=${fm.frozenPresent})`);
  lines.push('');

  lines.push('## По носителям');
  lines.push('');
  lines.push('| носитель | клон | active-черт | trait recall | derivation | persona fidelity |');
  lines.push('|---|---|---:|---:|---:|---:|');
  for (const b of bearers) {
    lines.push(
      `| ${b.name} | ${b.clone} | ${b.activeTraitCount} | ${b.matchedCount}/${b.expectedCount} (${pct(b.matchedCount, b.expectedCount)}) | ${b.derivationPassed}/${b.matchedCount} (${pct(b.derivationPassed, b.matchedCount)}) | ${b.personaIn}/${b.matchedCount} (${pct(b.personaIn, b.matchedCount)}) |`,
    );
  }
  lines.push('');

  lines.push('## no_false_merge (роль поддержки)');
  lines.push('');
  lines.push(`- support role резолвится: ${fm.supportRoleResolved}`);
  lines.push(`- активная версия: v${fm.activeVersion ?? '?'} носитель=${fm.activeBearerName ?? '—'}`);
  lines.push(`- утечка черт другого носителя в активную персону: ${fm.leakCount} ${fm.leakDetail.length ? `(${fm.leakDetail.join('; ')})` : ''}`);
  lines.push(`- frozen-снимок бывшего носителя присутствует: ${fm.frozenPresent}`);
  lines.push(`- версии: ${fm.versions.map((v) => `v${v.roleVersion ?? '?'}/${v.status}/${v.bearerName ?? '—'}(${v.traits}черт)`).join('; ') || '—'}`);
  lines.push('');

  const buildMiss = bearers.flatMap((b) => b.unmatched.map((u) => ({ bearer: b.name, clone: b.clone, ...u })));
  lines.push('## Несматчившиеся ожидаемые черты (build-miss кандидаты Слоя 0)');
  lines.push('');
  if (buildMiss.length === 0) {
    lines.push('— нет, все ожидаемые черты нашли семантический матч в базе.');
  } else {
    lines.push('| носитель | клон | methodId | ожидаемая черта |');
    lines.push('|---|---|---|---|');
    for (const m of buildMiss) lines.push(`| ${m.bearer} | ${m.clone} | ${m.methodId} | ${m.derivedStatement} |`);
  }
  lines.push('');

  return lines.join('\n');
}

async function main(): Promise<void> {
  const orgId = requireOrg();
  assertNotProd(readConfig());
  const prisma = createPrismaClient();
  try {
    const manifestPath = resolve(DOCS, 'clone-layer0-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    log(`=== layer0-match: org ${orgId}, носителей в манифесте ${manifest.bearers.length} ===`);

    const bearers: BearerReport[] = [];
    for (const b of manifest.bearers) {
      log(`  носитель ${b.name} (${b.clone}): ${b.expectedTraits.length} ожидаемых черт`);
      bearers.push(await matchBearer(prisma, orgId, b));
    }

    log('=== no_false_merge ===');
    const fm = await checkFalseMerge(prisma, orgId, manifest);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const body = buildReport(bearers, fm, orgId, stamp);
    mkdirSync(DOCS, { recursive: true });
    writeFileSync(resolve(DOCS, 'clone-layer0-report.md'), body, 'utf8');
    writeFileSync(
      resolve(DOCS, 'clone-layer0-report.json'),
      JSON.stringify({ stamp, orgId, bearers, falseMerge: fm }, null, 2),
      'utf8',
    );
    log('');
    log('✓ отчёт → docs/testing/clone-layer0-report.md (+ .json)');
    const totExpected = bearers.reduce((a, b) => a + b.expectedCount, 0);
    const totMatched = bearers.reduce((a, b) => a + b.matchedCount, 0);
    log(`  trait recall ${totMatched}/${totExpected} (${pct(totMatched, totExpected)}) · no_false_merge ${fm.pass ? 'PASS' : 'FAIL'}`);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
