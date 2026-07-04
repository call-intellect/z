import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { RedisService } from '../src/common/redis/redis.service';
import { ChatV2OrchestrationService } from '../src/modules/chat-v2/chat-v2.service';
import { LlmRouterService } from '../src/modules/ai/services/llm-router.service';

const ORG = 'cmr1qbvpx0001pwbwxbgmh1jl';
const USER = 'cmqxh4za3000018bwpuy1whg3';
const BANK = '../docs/testing/strela-recall-questions.json';
const ANGLES = new Set(['risks', 'blockers', 'goals']);
const GRAPHSYNC_KEYS = ['ideas', 'promises', 'okr', 'hypotheses', 'risks'];
const HONEST = 'В памяти компании я этого не нашёл';
const POOL = 4;

type Q = { id: string; angle: string; question: string; expectedAnswer: string };
type Ans = { id: string; angle: string; question: string; expected: string; text: string; empty: boolean };
type Verdict = 'CORRECT' | 'PARTIAL' | 'WRONG' | 'EMPTY';

async function mapPool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()));
  return out;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);
  const orch = app.get(ChatV2OrchestrationService);
  const llm = app.get(LlmRouterService);

  const bank: Q[] = JSON.parse(readFileSync(BANK, 'utf8'));
  const qs = bank.filter((q) => ANGLES.has(q.angle));
  console.log(`Вопросов структурного подмножества: ${qs.length} (${[...ANGLES].join('/')})`);

  async function clearCache(): Promise<void> {
    const keys = await redis.client.keys(`dlg:ans:${ORG}:*`);
    if (keys.length) await redis.client.del(...keys);
  }

  async function ask(q: Q): Promise<Ans> {
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
    const empty = text.includes(HONEST) || text.trim().length === 0;
    return { id: q.id, angle: q.angle, question: q.question, expected: q.expectedAnswer, text, empty };
  }

  async function runCondition(label: string): Promise<Ans[]> {
    await clearCache();
    console.log(`\n--- прогон: ${label} ---`);
    const res = await mapPool(qs, POOL, (q) => ask(q));
    return res;
  }

  async function judge(a: Ans): Promise<Verdict> {
    if (a.empty) return 'EMPTY';
    const sys =
      'Ты строгий оценщик качества ответов корпоративного ассистента. Тебе дают ВОПРОС, ЭТАЛОННЫЙ ответ (правда) и ФАКТИЧЕСКИЙ ответ ассистента. ' +
      'Оцени, насколько фактический ответ передаёт ключевые факты эталона. ' +
      'Вердикт: CORRECT — переданы все ключевые факты эталона (допустимы доп. детали, если не противоречат); ' +
      'PARTIAL — часть ключевых фактов есть, но неполно; ' +
      'WRONG — противоречит эталону или ключевые факты отсутствуют/выдуманы; ' +
      'EMPTY — ассистент сказал, что данных нет. ' +
      'Отвечай СТРОГО JSON: {"verdict":"CORRECT|PARTIAL|WRONG|EMPTY","reason":"кратко"}';
    const user = `ВОПРОС: ${a.question}\n\nЭТАЛОН: ${a.expected}\n\nФАКТИЧЕСКИЙ ОТВЕТ: ${a.text}`;
    try {
      const r = await llm.call({
        taskType: 'chat-v2',
        systemPrompt: sys,
        userMessage: user,
        tenantId: ORG,
        dataClass: 'internal',
        maxTokens: 300,
      });
      const m = String(r?.text ?? '').match(/\{[\s\S]*\}/);
      if (!m) return 'WRONG';
      const v = String(JSON.parse(m[0]).verdict ?? '').toUpperCase();
      if (v === 'CORRECT' || v === 'PARTIAL' || v === 'WRONG' || v === 'EMPTY') return v;
      return 'WRONG';
    } catch {
      return 'WRONG';
    }
  }

  const answersOn = await runCondition('B: С ТАБЛИЦАМИ (текущее состояние)');

  let answersOff: Ans[] = [];
  try {
    const now = new Date();
    const arch = await prisma.table.updateMany({
      where: { tenantId: ORG, isSystem: true, systemKey: { in: GRAPHSYNC_KEYS } },
      data: { archivedAt: now },
    });
    console.log(`\n[toggle] заархивировано таблиц: ${arch.count} → табличный контекст выключен`);
    answersOff = await runCondition('A: GRAPH-ONLY (таблицы выключены)');
  } finally {
    const rest = await prisma.table.updateMany({
      where: { tenantId: ORG, isSystem: true, systemKey: { in: GRAPHSYNC_KEYS } },
      data: { archivedAt: null },
    });
    console.log(`[toggle] восстановлено таблиц: ${rest.count}`);
  }

  console.log('\n=== СУДЕЙСТВО ===');
  const vOff = await mapPool(answersOff, POOL, (a) => judge(a));
  const vOn = await mapPool(answersOn, POOL, (a) => judge(a));

  function tally(vs: Verdict[]): Record<Verdict, number> {
    const t: Record<Verdict, number> = { CORRECT: 0, PARTIAL: 0, WRONG: 0, EMPTY: 0 };
    for (const v of vs) t[v]++;
    return t;
  }

  const byId = new Map(answersOn.map((a, i) => [a.id, i]));
  console.log('\nID    | angle    | A(graph-only) | B(с таблицами)');
  for (let i = 0; i < answersOff.length; i++) {
    const a = answersOff[i]!;
    const j = byId.get(a.id)!;
    const flip = vOff[i] !== vOn[j] ? '  <<<' : '';
    console.log(`${a.id.padEnd(5)} | ${a.angle.padEnd(8)} | ${String(vOff[i]).padEnd(13)} | ${String(vOn[j]).padEnd(13)}${flip}`);
  }

  const tOff = tally(vOff);
  const tOn = tally(vOn);
  const n = qs.length;
  const pct = (x: number): string => `${((x / n) * 100).toFixed(1)}%`;
  console.log(`\nВсего вопросов: ${n}`);
  console.log(`A graph-only:  CORRECT ${tOff.CORRECT} (${pct(tOff.CORRECT)}) · PARTIAL ${tOff.PARTIAL} · WRONG ${tOff.WRONG} · EMPTY ${tOff.EMPTY}`);
  console.log(`B с таблицами: CORRECT ${tOn.CORRECT} (${pct(tOn.CORRECT)}) · PARTIAL ${tOn.PARTIAL} · WRONG ${tOn.WRONG} · EMPTY ${tOn.EMPTY}`);
  const correctOrPartial = (t: Record<Verdict, number>): number => t.CORRECT + t.PARTIAL;
  console.log(`Δ CORRECT: ${tOn.CORRECT - tOff.CORRECT} · Δ (CORRECT+PARTIAL): ${correctOrPartial(tOn) - correctOrPartial(tOff)} · Δ EMPTY: ${tOn.EMPTY - tOff.EMPTY}`);

  await app.close();
}

main().catch((e) => {
  console.error('MEASURE ERROR:', e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
