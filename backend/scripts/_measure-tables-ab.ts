import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { RedisService } from '../src/common/redis/redis.service';
import { ChatV2OrchestrationService } from '../src/modules/chat-v2/chat-v2.service';
import { isRefusal, mustMentionCoverage } from './eval/verdict/classify-outcome';

const ORG = 'cmr1qbvpx0001pwbwxbgmh1jl';
const USER = 'cmqxh4za3000018bwpuy1whg3';
const GOLD = 'scripts/eval/gold/recall-gold.json';
const GRAPHSYNC_KEYS = ['ideas', 'promises', 'okr', 'hypotheses', 'risks'];
const STRUCTURAL = new Set(['goals', 'blockers', 'risks']);
const POOL = 4;
const REPEATS = Number(process.argv[2] ?? '1');

type GoldQ = {
  id: string;
  angle?: string;
  chain?: string;
  question: string;
  expectedKind: 'answerable' | 'honest_empty';
  mustMention: string[];
};
type Res = { id: string; angle: string; kind: string; verdict: string; cov: number };

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
  const chained = gold.filter((q) => q.chain);
  const solo = gold.filter((q) => !q.chain);
  console.log(
    `A/B recall · gold=${gold.length} (solo=${solo.length}, chained=${chained.length} — цепочки пропущены) · repeats=${REPEATS} · POOL=${POOL}`,
  );

  async function clearCache(): Promise<void> {
    const keys = await redis.client.keys(`dlg:ans:${ORG}:*`);
    if (keys.length) await redis.client.del(...keys);
  }

  async function setTables(on: boolean): Promise<void> {
    await prisma.table.updateMany({
      where: { tenantId: ORG, isSystem: true, systemKey: { in: GRAPHSYNC_KEYS } },
      data: { archivedAt: on ? null : new Date() },
    });
  }

  async function ask(q: GoldQ): Promise<Res> {
    let text = '';
    try {
      const a = await orch.askEphemeral({
        tenantId: ORG,
        userId: USER,
        question: q.question,
        history: [],
        scope: 'org',
        collectTrace: false,
      });
      text = String(a?.text ?? '');
    } catch (e) {
      text = `__ERROR__ ${e instanceof Error ? e.message : String(e)}`;
    }
    const { verdict, cov } = verdictOf(q, text);
    return { id: q.id, angle: q.angle ?? '?', kind: q.expectedKind, verdict, cov };
  }

  async function runArm(on: boolean): Promise<Map<string, Res[]>> {
    const acc = new Map<string, Res[]>();
    for (let r = 0; r < REPEATS; r++) {
      await setTables(on);
      await clearCache();
      const res = await mapPool(solo, POOL, ask);
      for (const x of res) {
        const list = acc.get(x.id) ?? [];
        list.push(x);
        acc.set(x.id, list);
      }
      console.log(`  [${on ? 'ON ' : 'OFF'}] repeat ${r + 1}/${REPEATS} готов`);
    }
    return acc;
  }

  const pass = (v: string): boolean => v === 'CORRECT' || v === 'PARTIAL' || v === 'HONEST';
  const good = (list: Res[]): number => list.filter((x) => pass(x.verdict)).length / list.length;

  let off: Map<string, Res[]>;
  let on: Map<string, Res[]>;
  try {
    off = await runArm(false);
    on = await runArm(true);
  } finally {
    await setTables(true);
  }

  const byAngle = new Map<string, { off: number; on: number; n: number }>();
  let offGood = 0;
  let onGood = 0;
  let hallucOff = 0;
  let hallucOn = 0;
  const flips: Array<{ id: string; angle: string; off: number; on: number }> = [];

  for (const q of solo) {
    const o = off.get(q.id)!;
    const n = on.get(q.id)!;
    const og = good(o);
    const ng = good(n);
    offGood += og;
    onGood += ng;
    if (q.expectedKind === 'honest_empty') {
      hallucOff += o.filter((x) => x.verdict === 'HALLUC').length / o.length;
      hallucOn += n.filter((x) => x.verdict === 'HALLUC').length / n.length;
    }
    const a = q.angle ?? '?';
    const rec = byAngle.get(a) ?? { off: 0, on: 0, n: 0 };
    rec.off += og;
    rec.on += ng;
    rec.n += 1;
    byAngle.set(a, rec);
    if (Math.abs(ng - og) > 0.01) flips.push({ id: q.id, angle: a, off: og, on: ng });
  }

  const N = solo.length;
  const pc = (x: number): string => `${((x / N) * 100).toFixed(1)}%`;
  console.log(`\n=== A/B ИТОГ (solo=${N}) ===`);
  console.log(`OFF (graph-only):  good ${offGood.toFixed(1)} (${pc(offGood)})`);
  console.log(`ON  (с таблицами): good ${onGood.toFixed(1)} (${pc(onGood)})`);
  console.log(`Дельта: ${(onGood - offGood >= 0 ? '+' : '') + (onGood - offGood).toFixed(1)} вопр. (${((onGood - offGood) / N * 100).toFixed(1)} п.п.)`);
  console.log(`Галлюцинации на honest_empty: OFF ${hallucOff.toFixed(1)} · ON ${hallucOn.toFixed(1)} (ниже — лучше; ON не должен расти)`);

  console.log(`\n--- По углам (good-доля) ---`);
  const angles = [...byAngle.entries()].sort((a, b) => {
    const sa = STRUCTURAL.has(a[0]) ? 0 : 1;
    const sb = STRUCTURAL.has(b[0]) ? 0 : 1;
    return sa - sb || a[0].localeCompare(b[0]);
  });
  let structOff = 0;
  let structOn = 0;
  let structN = 0;
  let guardOff = 0;
  let guardOn = 0;
  let guardN = 0;
  for (const [a, rec] of angles) {
    const tag = STRUCTURAL.has(a) ? 'СТРУКТ' : a === 'empty' ? 'empty ' : 'guard ';
    const d = rec.on - rec.off;
    console.log(
      `  [${tag}] ${a.padEnd(16)} n=${rec.n}  OFF ${(rec.off / rec.n * 100).toFixed(0)}%  ON ${(rec.on / rec.n * 100).toFixed(0)}%  Δ ${(d >= 0 ? '+' : '') + (d / rec.n * 100).toFixed(0)}п.п.`,
    );
    if (STRUCTURAL.has(a)) {
      structOff += rec.off;
      structOn += rec.on;
      structN += rec.n;
    } else if (a !== 'empty') {
      guardOff += rec.off;
      guardOn += rec.on;
      guardN += rec.n;
    }
  }
  console.log(`\nСТРУКТУРНЫЙ subset (risks+blockers+goals, n=${structN}): OFF ${(structOff / structN * 100).toFixed(1)}% → ON ${(structOn / structN * 100).toFixed(1)}%  Δ ${((structOn - structOff) / structN * 100).toFixed(1)}п.п.`);
  console.log(`GUARD (не-структурные answerable, n=${guardN}): OFF ${(guardOff / guardN * 100).toFixed(1)}% → ON ${(guardOn / guardN * 100).toFixed(1)}%  Δ ${((guardOn - guardOff) / guardN * 100).toFixed(1)}п.п. (не должен просесть)`);

  console.log(`\n--- Изменения по вопросам (OFF→ON) ---`);
  for (const f of flips.sort((a, b) => a.on - a.off - (b.on - b.off))) {
    const dir = f.on > f.off ? '↑' : '↓';
    console.log(`  ${dir} ${f.id} [${f.angle}] ${(f.off * 100).toFixed(0)}%→${(f.on * 100).toFixed(0)}%`);
  }

  await app.close();
}

main().catch((e) => {
  console.error('AB ERROR:', e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
