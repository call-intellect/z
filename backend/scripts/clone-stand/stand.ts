import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { PrismaService } from '../../src/common/prisma/prisma.service';
import { RedisService } from '../../src/common/redis/redis.service';
import { ClonesService } from '../../src/modules/clones/services/clones.service';

import { assertNotProd, readConfig, sleep } from '../_lib/combat-harness';
import { buildReport, computeLayerHit, judgeRun, loadManifest, writeReport, type RunConfig } from './report';
import type { AskKind, BankQuestion, CloneKey, JudgedResult, RunResult, RunTrace } from './types';

const DOCS = resolve(process.cwd(), '../docs/testing');
const BANK = resolve(DOCS, 'clone-stand-questions.json');
const RESULTS = resolve(DOCS, 'clone-stand-results.json');
const JUDGED = resolve(DOCS, 'clone-stand-judged.json');

const ROLE_BY_KEY: Record<CloneKey, string> = {
  ceo: 'Генеральный директор',
  integrator: 'Разработчик-интегратор',
  marketer: 'Маркетолог',
  support: 'Руководитель поддержки',
};
const BEARER_BY_KEY: Record<CloneKey, string> = {
  ceo: 'Сергей',
  integrator: 'Михаил',
  marketer: 'Дарья',
  support: 'Игорь',
};

const STAND_KNOBS: Array<{ key: string; value: unknown; category: string; section: string }> = [
  { key: 'clone.v2.enabled', value: true, category: 'ai', section: 'clone' },
  { key: 'clone.topic.similarityThreshold', value: 0.35, category: 'ai', section: 'clone' },
  { key: 'clone.topic.similarityThresholdJudgmental', value: 0.33, category: 'ai', section: 'clone' },
  { key: 'clone.topic.minBlocks', value: 1, category: 'ai', section: 'clone' },
  { key: 'clone.retrieval.topK', value: 20, category: 'ai', section: 'clone' },
];

const CONCURRENCY = 3;
const FIRST_PERSON = /(^|[^а-яё])(я|мне|меня|мной|мой|моя|моё|мои|моего|моих|нас|наш|наши|нашей)([^а-яё]|$)/i;
const DISCLAIMER = /(клон|цифров\w* двойник|цифров\w* копи|как клон|как цифров|ai[- ]двойник|я —? клон)/i;

function log(s: string): void {
  process.stdout.write(`${s}\n`);
}

function requireOrg(): string {
  const org = process.env['STRELA_ORG'];
  if (!org) throw new Error('STRELA_ORG не задан');
  return org;
}

function stamp(): string {
  const v = process.env['CLONE_STAND_STAMP'];
  if (v) return v;
  throw new Error('CLONE_STAND_STAMP не задан (передай метку прогона, напр. 2026-07-05-1)');
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

function loadBank(): BankQuestion[] {
  const raw = JSON.parse(readFileSync(BANK, 'utf8')) as Record<string, unknown>;
  const arr = (raw['questions'] ?? Object.values(raw).find((v) => Array.isArray(v))) as BankQuestion[];
  if (!Array.isArray(arr)) throw new Error('банк: массив вопросов не найден');
  return arr;
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

interface Targets {
  roleId: string | null;
  personId: string | null;
}

async function resolveTargets(prisma: PrismaService, orgId: string): Promise<Map<CloneKey, Targets>> {
  const map = new Map<CloneKey, Targets>();
  for (const key of Object.keys(ROLE_BY_KEY) as CloneKey[]) {
    const role = await prisma.role.findFirst({ where: { tenantId: orgId, name: ROLE_BY_KEY[key], deletedAt: null }, select: { id: true } });
    const person = await prisma.person.findFirst({ where: { tenantId: orgId, name: BEARER_BY_KEY[key], relationship: 'employee', deletedAt: null }, select: { id: true } });
    map.set(key, { roleId: role?.id ?? null, personId: person?.id ?? null });
  }
  return map;
}

async function ownerUserId(prisma: PrismaService, orgId: string): Promise<string> {
  const owner = await prisma.membership.findFirst({ where: { orgId, role: 'owner' }, select: { userId: true } });
  if (!owner) throw new Error(`owner membership не найден для ${orgId}`);
  return owner.userId;
}

function errCode(e: unknown): string {
  const r = (e as { response?: { error?: { code?: string } } })?.response?.error?.code;
  if (typeof r === 'string') return r;
  return (e as Error)?.message ? `err:${(e as Error).message.slice(0, 40)}` : 'unknown_error';
}

async function fetchBlockTexts(prisma: PrismaService, orgId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.ideaBlock.findMany({
    where: { tenantId: orgId, id: { in: ids.slice(0, 20) } },
    select: { name: true, criticalQuestion: true, trustedAnswer: true },
  });
  return rows.map((r) => [r.name, r.criticalQuestion, r.trustedAnswer].filter(Boolean).join(' — '));
}

function traceFromMeta(meta: Record<string, unknown>): RunTrace {
  const mode = meta['mode'];
  return {
    usedBlockIds: strArr(meta['usedBlockIds']),
    usedSkillIds: strArr(meta['usedSkillIds']),
    usedRegulationNames: strArr(meta['usedRegulationNames']),
    topicMatchedBlocks: typeof meta['topicMatchedBlocks'] === 'number' ? (meta['topicMatchedBlocks'] as number) : null,
    topicTopCosine: typeof meta['topicTopCosine'] === 'number' ? (meta['topicTopCosine'] as number) : null,
    reasoningMode: mode === 'factual' || mode === 'judgmental' ? mode : null,
    personaVersion: typeof meta['personaVersion'] === 'number' ? (meta['personaVersion'] as number) : null,
  };
}

async function readMessageMeta(prisma: PrismaService, messageId: string | null): Promise<Record<string, unknown>> {
  if (!messageId) return {};
  const msg = await prisma.chatV2Message.findUnique({ where: { id: messageId }, select: { llmMeta: true } });
  return (msg?.llmMeta ?? {}) as Record<string, unknown>;
}

interface AskOutcome {
  askKind: AskKind;
  text: string;
  refused: boolean;
  refusalReason: string | null;
  errorCode: string | null;
  citations: string[];
  messageIds: string[];
  conversationId: string | null;
}

async function callClone(clones: ClonesService, orgId: string, requesterUserId: string, q: BankQuestion, t: Targets, convId: string | undefined): Promise<AskOutcome> {
  if (q.cloneScopeOverride === 'person') {
    if (!t.personId) return { askKind: 'person', text: '', refused: true, refusalReason: null, errorCode: 'no_person_target', citations: [], messageIds: [], conversationId: null };
    const dto = await clones.askPerson({ tenantId: orgId, requesterUserId, personId: t.personId, question: q.question, conversationId: convId });
    return { askKind: 'person', text: dto.text, refused: dto.refused === true, refusalReason: dto.refusalReason ?? null, errorCode: null, citations: dto.citations.map((c) => c.blockId), messageIds: [dto.messageId], conversationId: dto.conversationId };
  }
  if (!t.roleId) return { askKind: 'role', text: '', refused: true, refusalReason: null, errorCode: 'no_role_target', citations: [], messageIds: [], conversationId: null };
  if (q.askVersion === 'all_formers') {
    const res = await clones.askAllFormers({ tenantId: orgId, requesterUserId, roleId: t.roleId, question: q.question });
    const parts = res.answers.map((a) => `[${a.publicName} v${a.version}/${a.status}] ${a.response?.text ?? '(нет ответа)'}`);
    const refused = res.answers.every((a) => !a.response || a.response.refused === true);
    const citations = res.answers.flatMap((a) => a.response?.citations.map((c) => c.blockId) ?? []);
    const messageIds = res.answers.map((a) => a.response?.messageId).filter((x): x is string => Boolean(x));
    return { askKind: 'all_formers', text: parts.join('\n'), refused, refusalReason: null, errorCode: null, citations, messageIds, conversationId: null };
  }
  const roleVersion = q.askVersion === 'frozen_v1' ? 1 : undefined;
  const askKind: AskKind = q.askVersion === 'frozen_v1' ? 'frozen_v1' : 'role';
  const dto = await clones.askRole({ tenantId: orgId, requesterUserId, roleId: t.roleId, question: q.question, conversationId: convId, roleVersion });
  return { askKind, text: dto.text, refused: dto.refused === true, refusalReason: dto.refusalReason ?? null, errorCode: null, citations: dto.citations.map((c) => c.blockId), messageIds: [dto.messageId], conversationId: dto.conversationId };
}

async function askOne(clones: ClonesService, prisma: PrismaService, orgId: string, requesterUserId: string, q: BankQuestion, targets: Map<CloneKey, Targets>, convId: string | undefined): Promise<RunResult> {
  const t = targets.get(q.clone) ?? { roleId: null, personId: null };
  const start = Date.now();
  let outcome: AskOutcome;
  try {
    outcome = await callClone(clones, orgId, requesterUserId, q, t, convId);
  } catch (e) {
    outcome = { askKind: q.cloneScopeOverride === 'person' ? 'person' : 'role', text: '', refused: true, refusalReason: null, errorCode: errCode(e), citations: [], messageIds: [], conversationId: null };
  }
  const latencyMs = Date.now() - start;

  const meta = await readMessageMeta(prisma, outcome.messageIds[0] ?? null);
  let trace = traceFromMeta(meta);
  for (const mid of outcome.messageIds.slice(1)) {
    const m2 = traceFromMeta(await readMessageMeta(prisma, mid));
    trace = {
      usedBlockIds: [...new Set([...trace.usedBlockIds, ...m2.usedBlockIds])],
      usedSkillIds: [...new Set([...trace.usedSkillIds, ...m2.usedSkillIds])],
      usedRegulationNames: [...new Set([...trace.usedRegulationNames, ...m2.usedRegulationNames])],
      topicMatchedBlocks: trace.topicMatchedBlocks ?? m2.topicMatchedBlocks,
      topicTopCosine: trace.topicTopCosine ?? m2.topicTopCosine,
      reasoningMode: trace.reasoningMode ?? m2.reasoningMode,
      personaVersion: trace.personaVersion ?? m2.personaVersion,
    };
  }
  const refusalReason = outcome.refusalReason ?? (typeof meta['refusalReason'] === 'string' ? (meta['refusalReason'] as string) : null);
  const retrievedTexts = await fetchBlockTexts(prisma, orgId, trace.usedBlockIds);

  const citationsExist = outcome.citations.length === 0 ? 0 : await prisma.ideaBlock.count({ where: { tenantId: orgId, id: { in: outcome.citations } } });
  const layer = computeLayerHit(q.expectedLayer, trace);

  return {
    id: q.id,
    clone: q.clone,
    category: q.category,
    askKind: outcome.askKind,
    question: q.question,
    conversationId: outcome.conversationId,
    messageId: outcome.messageIds[0] ?? null,
    text: outcome.text,
    refused: outcome.refused,
    refusalReason,
    errorCode: outcome.errorCode,
    latencyMs,
    citations: outcome.citations,
    retrievedTexts,
    trace,
    det: {
      citationCount: outcome.citations.length,
      citationsValid: citationsExist === outcome.citations.length,
      hasDisclaimer: DISCLAIMER.test(outcome.text),
      firstPerson: FIRST_PERSON.test(outcome.text),
      layerHit: layer.hit,
      layerAdvisoryOnly: layer.advisoryOnly,
      layerDetail: layer.detail,
    },
  };
}

async function cleanCaches(redis: RedisService, orgId: string): Promise<void> {
  for (const p of [`dlg:ans:${orgId}:*`, `dlg:ret:${orgId}:*`, 'bull:core.skill-profile-rebuild:*']) {
    const keys = await redis.client.keys(p);
    if (keys.length > 0) await redis.client.del(...keys);
  }
}

async function modeRun(): Promise<void> {
  const orgId = requireOrg();
  const limit = Number(process.env['CLONE_STAND_LIMIT'] ?? '0');
  const bank = limit > 0 ? loadBank().slice(0, limit) : loadBank();
  await withApp(async (app) => {
    const prisma = app.get(PrismaService);
    const clones = app.get(ClonesService);
    const redis = app.get(RedisService);
    const requesterUserId = await ownerUserId(prisma, orgId);
    const targets = await resolveTargets(prisma, orgId);
    await cleanCaches(redis, orgId);
    log(`run: банк ${bank.length}, targets ${[...targets].map(([k, v]) => `${k}:${v.roleId ? 'R' : '-'}${v.personId ? 'P' : '-'}`).join(' ')}`);

    const chains = new Map<string, BankQuestion[]>();
    const flat: BankQuestion[] = [];
    for (const q of bank) {
      if (q.chain) {
        const arr = chains.get(q.chain) ?? [];
        arr.push(q);
        chains.set(q.chain, arr);
      } else flat.push(q);
    }

    const results: RunResult[] = [];
    let done = 0;
    const flatResults = await mapLimit(flat, CONCURRENCY, async (q) => {
      const r = await askOne(clones, prisma, orgId, requesterUserId, q, targets, undefined);
      done++;
      if (done % 10 === 0) log(`  ...${done}/${bank.length}`);
      return r;
    });
    results.push(...flatResults);

    for (const [name, turns] of chains) {
      turns.sort((a, b) => (a.turn ?? 0) - (b.turn ?? 0));
      let convId: string | undefined;
      for (const q of turns) {
        const r = await askOne(clones, prisma, orgId, requesterUserId, q, targets, convId);
        convId = r.conversationId ?? convId;
        results.push(r);
        done++;
      }
      log(`  chain ${name}: ${turns.length} ходов`);
    }

    results.sort((a, b) => a.id.localeCompare(b.id));
    writeFileSync(RESULTS, JSON.stringify({ stamp: stamp(), orgId, results }, null, 2), 'utf8');
    const refused = results.filter((r) => r.refused).length;
    log(`✓ run: ${results.length} вопросов, отказов ${refused}, → ${RESULTS}`);
  });
}

async function loadRegulationTextMap(orgId: string): Promise<Map<string, string>> {
  const prisma = (await import('../_lib/prisma')).createPrismaClient();
  try {
    const base = { tenantId: orgId, deletedAt: null };
    const [regs, instrs, pols, procs] = await Promise.all([
      prisma.regulation.findMany({ where: base, select: { name: true, statement: true, contentMd: true } }),
      prisma.instruction.findMany({ where: base, select: { name: true, statement: true, contentMd: true } }),
      prisma.policy.findMany({ where: base, select: { name: true, contentMd: true } }),
      prisma.process.findMany({ where: base, select: { name: true, description: true } }),
    ]);
    const map = new Map<string, string>();
    const put = (name: string, text: string): void => {
      const t = (text ?? '').trim();
      if (t && !map.has(name)) map.set(name, t);
    };
    for (const r of regs) put(r.name, r.statement?.trim() || r.contentMd || '');
    for (const r of instrs) put(r.name, r.statement?.trim() || r.contentMd || '');
    for (const r of pols) put(r.name, r.contentMd ?? '');
    for (const r of procs) put(r.name, r.description ?? '');
    return map;
  } finally {
    await prisma.$disconnect();
  }
}

async function modeJudge(): Promise<void> {
  const parsed = JSON.parse(readFileSync(RESULTS, 'utf8')) as { results: RunResult[]; orgId?: string };
  const ctx = loadManifest();
  const bank = loadBank();
  const bankById = new Map(bank.map((q) => [q.id, q]));
  const regMap = await loadRegulationTextMap(parsed.orgId ?? requireOrg());
  log(`judge: ${parsed.results.length} результатов, панель линз (deepseek-v4-pro), карта регламентов=${regMap.size}`);
  let done = 0;
  const judged = await mapLimit(parsed.results, 2, async (run) => {
    const q = bankById.get(run.id);
    if (!q) throw new Error(`вопрос ${run.id} не найден в банке`);
    const regTexts = (run.trace?.usedRegulationNames ?? [])
      .map((n) => regMap.get(n))
      .filter((t): t is string => !!t && t.length > 0);
    const parts = await judgeRun(q, run, ctx, regTexts);
    done++;
    if (done % 10 === 0) log(`  ...judged ${done}/${parsed.results.length}`);
    return { run, ...parts } as JudgedResult;
  });
  writeFileSync(JUDGED, JSON.stringify({ stamp: stamp(), judged }, null, 2), 'utf8');
  log(`✓ judge: → ${JUDGED}`);
}

async function modeConfigure(): Promise<void> {
  const prisma = (await import('../_lib/prisma')).createPrismaClient();
  try {
    for (const k of STAND_KNOBS) {
      await prisma.adminSetting.upsert({
        where: { key: k.key },
        update: { value: k.value as never },
        create: {
          key: k.key,
          value: k.value as never,
          category: k.category,
          section: k.section,
          severity: 'medium',
        },
      });
      log(`  knob ${k.key} = ${JSON.stringify(k.value)}`);
    }
    log('✓ configure: STAND_KNOBS выставлены в AdminSetting');
  } finally {
    await prisma.$disconnect();
  }
}

async function readRunConfig(): Promise<RunConfig> {
  const prisma = (await import('../_lib/prisma')).createPrismaClient();
  try {
    const knob = async (key: string): Promise<string> => {
      const r = await prisma.adminSetting.findUnique({ where: { key }, select: { value: true } });
      return r ? JSON.stringify(r.value) : '(default)';
    };
    const route = await prisma.$queryRawUnsafe<Array<{ provider: string; model: string }>>(
      `SELECT provider, model FROM "LlmTaskRoute" WHERE "taskType"='clone-respond' AND tier='primary' LIMIT 1`,
    ).catch(() => [] as Array<{ provider: string; model: string }>);
    return {
      cloneV2Enabled: process.env['CLONE_V2_ENABLED'] ?? '(unset)',
      personaRoleAggMinPersons: await knob('knowledge.personaRoleAggMinPersons'),
      personaMinTraits: await knob('knowledge.personaMinTraits'),
      skillClusterSimilarityThreshold: await knob('knowledge.skillClusterSimilarityThreshold'),
      cloneRespondModel: route[0] ? `${route[0].provider}/${route[0].model}` : '(route не найден)',
      extra: {
        'clone.v2.enabled': await knob('clone.v2.enabled'),
        'clone.topic.similarityThreshold': await knob('clone.topic.similarityThreshold'),
        'clone.topic.similarityThresholdJudgmental': await knob('clone.topic.similarityThresholdJudgmental'),
        'clone.topic.minBlocks': await knob('clone.topic.minBlocks'),
        'clone.retrieval.topK': await knob('clone.retrieval.topK'),
        CLONE_RESPOND_GROUNDING_ENABLED: process.env['CLONE_RESPOND_GROUNDING_ENABLED'] ?? '(default)',
      },
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function modeReport(): Promise<void> {
  const { judged } = JSON.parse(readFileSync(JUDGED, 'utf8')) as { judged: JudgedResult[] };
  const config = await readRunConfig();
  const s = stamp();
  const body = buildReport({ judged, funnel: null, layer0: null, config, stamp: s });
  writeReport(body, judged, s);
  log(`✓ report: → docs/testing/clone-stand-report.md`);
  log('');
  log(body.split('\n').slice(0, 40).join('\n'));
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'run';
  assertNotProd(readConfig());
  switch (mode) {
    case 'configure': await modeConfigure(); break;
    case 'run': await modeRun(); break;
    case 'judge': await modeJudge(); break;
    case 'report': await modeReport(); break;
    case 'all': await modeConfigure(); await modeRun(); await modeJudge(); await modeReport(); break;
    default: throw new Error(`режим: configure|run|judge|report|all (дано ${mode})`);
  }
}

main().then(() => process.exit(0)).catch((e: unknown) => {
  process.stderr.write(`clone-stand FAIL: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
