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
const LABEL = process.argv[2] ?? 'post';
const GRAPHSYNC_KEYS = ['ideas', 'promises', 'okr', 'hypotheses', 'risks'];
const POOL = 4;

type GoldQ = {
  id: string;
  angle?: string;
  question: string;
  expectedKind: 'answerable' | 'honest_empty';
  mustMention: string[];
};
type Res = { id: string; angle: string; kind: string; verdict: string; cov: number; text: string };

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
  console.log(`Gold-линейка (детерминированная): ${gold.length} вопросов · label=${LABEL} · таблицы ВЫКЛ`);

  const keys = await redis.client.keys(`dlg:ans:${ORG}:*`);
  if (keys.length) await redis.client.del(...keys);

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
    const refusal = isRefusal(text);
    const cov = mustMentionCoverage(text, q.mustMention);
    let verdict: string;
    if (q.expectedKind === 'honest_empty') {
      verdict = refusal ? 'HONEST' : 'HALLUC';
    } else if (refusal) {
      verdict = 'FAIL_EMPTY';
    } else if (cov >= 1) {
      verdict = 'CORRECT';
    } else if (cov >= 0.5) {
      verdict = 'PARTIAL';
    } else {
      verdict = 'FAIL_MISS';
    }
    return { id: q.id, angle: q.angle ?? '?', kind: q.expectedKind, verdict, cov, text: text.slice(0, 200) };
  }

  let res: Res[] = [];
  try {
    const arch = await prisma.table.updateMany({
      where: { tenantId: ORG, isSystem: true, systemKey: { in: GRAPHSYNC_KEYS } },
      data: { archivedAt: new Date() },
    });
    console.log(`[toggle] таблицы выкл: ${arch.count}`);
    res = await mapPool(gold, POOL, ask);
  } finally {
    const rest = await prisma.table.updateMany({
      where: { tenantId: ORG, isSystem: true, systemKey: { in: GRAPHSYNC_KEYS } },
      data: { archivedAt: null },
    });
    console.log(`[toggle] таблицы восстановлены: ${rest.count}`);
  }

  const answerable = res.filter((r) => r.kind === 'answerable');
  const empty = res.filter((r) => r.kind === 'honest_empty');
  const correct = answerable.filter((r) => r.verdict === 'CORRECT').length;
  const partial = answerable.filter((r) => r.verdict === 'PARTIAL').length;
  const honest = empty.filter((r) => r.verdict === 'HONEST').length;
  const halluc = empty.filter((r) => r.verdict === 'HALLUC').length;
  const na = answerable.length;
  const pc = (x: number): string => `${((x / na) * 100).toFixed(1)}%`;

  console.log(`\n=== GOLD ИТОГ (${LABEL}) ===`);
  console.log(`Answerable (${na}): CORRECT ${correct} (${pc(correct)}) · PARTIAL ${partial} (${pc(partial)}) · FAIL ${na - correct - partial}`);
  console.log(`CORRECT+PARTIAL: ${correct + partial} (${pc(correct + partial)})`);
  console.log(`Honest-empty (${empty.length}): HONEST ${honest} · HALLUC ${halluc}`);
  console.log(`\nПровалы (answerable, не CORRECT):`);
  for (const r of answerable.filter((x) => x.verdict !== 'CORRECT').sort((a, b) => a.angle.localeCompare(b.angle))) {
    console.log(`  ${r.id} [${r.angle}] ${r.verdict} cov=${r.cov.toFixed(2)} :: ${r.text.slice(0, 90)}`);
  }
  await app.close();
}

main().catch((e) => {
  console.error('GOLD ERROR:', e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
