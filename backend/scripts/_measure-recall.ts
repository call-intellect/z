import { NestFactory } from '@nestjs/core';
import { readFileSync, writeFileSync } from 'node:fs';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { RedisService } from '../src/common/redis/redis.service';
import { ChatV2OrchestrationService } from '../src/modules/chat-v2/chat-v2.service';
import { isRefusal, missingMustMention, mustMentionCoverage } from './eval/verdict/classify-outcome';

const ORG = 'cmr1qbvpx0001pwbwxbgmh1jl';
const USER = 'cmqxh4za3000018bwpuy1whg3';
const GOLD = 'scripts/eval/gold/recall-gold.json';
const GRAPHSYNC_KEYS = ['ideas', 'promises', 'okr', 'hypotheses', 'risks'];
const STRUCTURAL = new Set(['goals', 'blockers', 'risks']);
const POOL = 4;
const REPEATS = Number(process.argv[2] ?? '3');
const TABLES_ON = (process.argv[3] ?? 'on') !== 'off';
const OUT = `/private/tmp/claude-501/-Users-sergrvmz-Documents-kora/e05457f2-60db-436d-bbd1-c5e75163b785/scratchpad/recall-run-${TABLES_ON ? 'on' : 'off'}.json`;

type GoldQ = {
  id: string;
  angle?: string;
  chain?: string;
  turn?: number;
  question: string;
  expectedKind: 'answerable' | 'honest_empty';
  mustMention: string[];
};
type Msg = { role: 'user' | 'assistant'; content: string };
type Attempt = {
  verdict: string;
  cov: number;
  text: string;
  missing: string[];
  missingInCtx: string[];
  missingNotInCtx: string[];
};
type Agg = { q: GoldQ; attempts: Attempt[] };

function verdictOf(q: GoldQ, text: string): { verdict: string; cov: number } {
  const refusal = isRefusal(text);
  const cov = mustMentionCoverage(text, q.mustMention);
  if (q.expectedKind === 'honest_empty') return { verdict: refusal ? 'HONEST' : 'HALLUC', cov };
  if (refusal) return { verdict: 'FAIL_EMPTY', cov };
  if (cov >= 1) return { verdict: 'CORRECT', cov };
  if (cov >= 0.5) return { verdict: 'PARTIAL', cov };
  return { verdict: 'FAIL_MISS', cov };
}

async function mapPool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = idx++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);
  const orch = app.get(ChatV2OrchestrationService);

  const gold: GoldQ[] = JSON.parse(readFileSync(GOLD, 'utf8')).questions;
  const solo = gold.filter((q) => !q.chain);
  const chainIds = [...new Set(gold.filter((q) => q.chain).map((q) => q.chain!))];
  console.log(
    `RECALL · gold=${gold.length} (solo=${solo.length}, chains=${chainIds.length}) · repeats=${REPEATS} · таблицы ${TABLES_ON ? 'ON' : 'OFF'}`,
  );

  async function ctxTextFor(trace: any): Promise<string> {
    const ids = new Set<string>();
    for (const h of trace?.afterRerank ?? []) if (h?.blockId) ids.add(h.blockId);
    for (const id of trace?.usedBlockIds ?? []) if (id) ids.add(id);
    for (const h of trace?.poolAfterFusion ?? []) if (h?.blockId) ids.add(h.blockId);
    for (const n of trace?.graphExpansion?.neighborsAdded ?? []) if (n?.blockId) ids.add(n.blockId);
    if (ids.size === 0) return '';
    const blocks = await prisma.ideaBlock.findMany({
      where: { id: { in: [...ids] } },
      select: { name: true, criticalQuestion: true, trustedAnswer: true },
    });
    return blocks
      .map((b) => `${b.name}\n${b.criticalQuestion}\n${b.trustedAnswer}`)
      .join('\n')
      .toLowerCase();
  }

  async function ask(q: GoldQ, history: Msg[]): Promise<Attempt & { raw: string }> {
    let text = '';
    let trace: any = null;
    try {
      const a = await orch.askEphemeral({
        tenantId: ORG,
        userId: USER,
        question: q.question,
        history,
        scope: 'org',
        collectTrace: true,
      });
      text = String(a?.text ?? '');
      trace = (a as any)?.retrievalTrace ?? null;
    } catch (e) {
      text = `__ERROR__ ${e instanceof Error ? e.message : String(e)}`;
    }
    const { verdict, cov } = verdictOf(q, text);
    const missing = missingMustMention(text, q.mustMention);
    let missingInCtx: string[] = [];
    let missingNotInCtx: string[] = [];
    if (missing.length && verdict !== 'HONEST' && verdict !== 'HALLUC') {
      const ctx = await ctxTextFor(trace);
      for (const m of missing) {
        const present = m.split('|').some((alt) => alt.trim() && ctx.includes(alt.trim().toLowerCase()));
        if (present) missingInCtx.push(m);
        else missingNotInCtx.push(m);
      }
    }
    return { verdict, cov, text, missing, missingInCtx, missingNotInCtx, raw: text };
  }

  async function setTables(on: boolean): Promise<void> {
    await prisma.table.updateMany({
      where: { tenantId: ORG, isSystem: true, systemKey: { in: GRAPHSYNC_KEYS } },
      data: { archivedAt: on ? null : new Date() },
    });
  }
  async function clearCache(): Promise<void> {
    const keys = await redis.client.keys(`dlg:ans:${ORG}:*`);
    if (keys.length) await redis.client.del(...keys);
  }

  const byId = new Map<string, Agg>();
  for (const q of gold) byId.set(q.id, { q, attempts: [] });

  try {
    await setTables(TABLES_ON);
    for (let r = 0; r < REPEATS; r++) {
      await clearCache();
      const soloRes = await mapPool(solo, POOL, async (q) => ({ q, a: await ask(q, []) }));
      for (const { q, a } of soloRes) byId.get(q.id)!.attempts.push(a);
      for (const cid of chainIds) {
        const turns = gold.filter((q) => q.chain === cid).sort((x, y) => (x.turn ?? 0) - (y.turn ?? 0));
        const hist: Msg[] = [];
        for (const q of turns) {
          const a = await ask(q, hist);
          byId.get(q.id)!.attempts.push(a);
          hist.push({ role: 'user', content: q.question }, { role: 'assistant', content: a.raw });
        }
      }
      console.log(`  repeat ${r + 1}/${REPEATS} готов`);
    }
  } finally {
    await setTables(true);
  }

  const answerable = gold.filter((q) => q.expectedKind === 'answerable');
  const empty = gold.filter((q) => q.expectedKind === 'honest_empty');
  const passRate = (a: Attempt[], f: (v: string) => boolean): number =>
    a.filter((x) => f(x.verdict)).length / a.length;

  let correctSum = 0;
  let partialSum = 0;
  let hallucSum = 0;
  const byAngle = new Map<string, { correct: number; cp: number; n: number }>();
  const rows: any[] = [];

  for (const q of answerable) {
    const at = byId.get(q.id)!.attempts;
    const c = passRate(at, (v) => v === 'CORRECT');
    const cp = passRate(at, (v) => v === 'CORRECT' || v === 'PARTIAL');
    correctSum += c;
    partialSum += cp - c;
    const a = q.angle ?? '?';
    const rec = byAngle.get(a) ?? { correct: 0, cp: 0, n: 0 };
    rec.correct += c;
    rec.cp += cp;
    rec.n += 1;
    byAngle.set(a, rec);
    rows.push({ id: q.id, angle: a, kind: 'answerable', correct: c, cp, attempts: at });
  }
  for (const q of empty) {
    const at = byId.get(q.id)!.attempts;
    hallucSum += passRate(at, (v) => v === 'HALLUC');
    rows.push({ id: q.id, angle: q.angle, kind: 'honest_empty', attempts: at });
  }

  const NA = answerable.length;
  const pc = (x: number): string => `${((x / NA) * 100).toFixed(1)}%`;
  console.log(`\n=== ИТОГ (таблицы ${TABLES_ON ? 'ON' : 'OFF'}, ${REPEATS} прогонов, усреднено) ===`);
  console.log(`Answerable (${NA}): CORRECT ${correctSum.toFixed(1)} (${pc(correctSum)}) · +PARTIAL → ${(correctSum + partialSum).toFixed(1)} (${pc(correctSum + partialSum)})`);
  console.log(`Honest-empty (${empty.length}): галлюцинаций ${hallucSum.toFixed(2)} (0 = идеал)`);

  console.log(`\n--- По углам (CORRECT / CORRECT+PARTIAL, усреднено) ---`);
  const angles = [...byAngle.entries()].sort((a, b) => {
    const sa = STRUCTURAL.has(a[0]) ? 0 : 1;
    const sb = STRUCTURAL.has(b[0]) ? 0 : 1;
    return sa - sb || a[0].localeCompare(b[0]);
  });
  for (const [a, rec] of angles) {
    const tag = STRUCTURAL.has(a) ? 'СТРУКТ' : 'guard ';
    console.log(`  [${tag}] ${a.padEnd(16)} n=${rec.n}  CORRECT ${((rec.correct / rec.n) * 100).toFixed(0)}%  +PARTIAL ${((rec.cp / rec.n) * 100).toFixed(0)}%`);
  }

  console.log(`\n--- ПРОВАЛЫ (не всегда CORRECT) + АТРИБУЦИЯ упущенных фактов ---`);
  const fails = rows
    .filter((r) => r.kind === 'answerable' && r.correct < 1)
    .sort((a, b) => a.cp - b.cp || a.correct - b.correct);
  for (const r of fails) {
    const last = r.attempts[r.attempts.length - 1] as Attempt;
    const inCtx = [...new Set(r.attempts.flatMap((a: Attempt) => a.missingInCtx))];
    const notCtx = [...new Set(r.attempts.flatMap((a: Attempt) => a.missingNotInCtx))];
    const attr = notCtx.length && !inCtx.length ? 'RETRIEVAL' : inCtx.length && !notCtx.length ? 'СИНТЕЗ' : inCtx.length && notCtx.length ? 'СМЕШ' : '—';
    console.log(
      `  ${r.id} [${r.angle}] CORRECT=${(r.correct * 100).toFixed(0)}% +PART=${(r.cp * 100).toFixed(0)}% → ${attr}` +
        `${inCtx.length ? ` · был-в-ctx(синтез не собрал): ${inCtx.join(', ')}` : ''}` +
        `${notCtx.length ? ` · НЕ поднят(retrieval): ${notCtx.join(', ')}` : ''}`,
    );
    console.log(`      «${last.text.replace(/\s+/g, ' ').slice(0, 180)}»`);
  }

  writeFileSync(OUT, JSON.stringify({ meta: { REPEATS, TABLES_ON, correctSum, partialSum, hallucSum }, rows }, null, 2));
  console.log(`\nДамп → ${OUT}`);
  await app.close();
}

main().catch((e) => {
  console.error('RECALL ERROR:', e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
