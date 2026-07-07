import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TypedConfigService } from '../../src/common/config/index';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { LlmRouterService } from '../../src/modules/ai/services/llm-router.service';
import { KnowledgeEmbeddingService } from '../../src/modules/knowledge-core/services/embedding.service';

import {
  ARTIFACTS_DIR,
  assertNotProd,
  type CloneKey,
  costUsd,
  fmtUsd,
  log,
  mean,
  type OwnedRule,
  pct,
  requireOrg,
  withApp,
} from './_shared';
import { GOLD, type GoldItem } from './gold';

const OWNERSHIP = resolve(ARTIFACTS_DIR, 'ownership.json');
const SUMMARIES = resolve(ARTIFACTS_DIR, 'summaries.json');
const REPORT = resolve(ARTIFACTS_DIR, 'bakeoff-report.md');
const RESULTS = resolve(ARTIFACTS_DIR, 'bakeoff-results.json');

const ROUTER_MODEL = 'deepseek-v4-flash';
const ROUTER_MAX_TOKENS = Number(process.env['ROUTER_MAX_TOKENS'] ?? '900');

type StrategyId = 'A_names' | 'B_summary' | 'C_fulltext' | 'kw_bm25' | 'semantic';
const STRATEGIES: StrategyId[] = ['A_names', 'B_summary', 'C_fulltext', 'kw_bm25', 'semantic'];

const ROUTER_SYSTEM = [
  'Ты — маршрутизатор правил роли. На входе: вопрос сотрудника и НУМЕРОВАННЫЙ список правил его роли (у каждого — id).',
  'Задача: вернуть id ТОЛЬКО тех правил из списка, которые прямо релевантны вопросу (как правило 1, максимум 3).',
  'Если НИ ОДНО правило из списка не отвечает на вопрос — верни пустой список.',
  'НИКОГДА не выдумывай id — бери строго из данного списка. Не объясняй, верни только JSON.',
  'Формат ответа: {"ids": ["<id>", ...]}',
].join('\n');

interface Cand {
  id: string;
  name: string;
  text: string;
  summary: string;
}

interface CellResult {
  selected: string[];
  hit: boolean;
  falseInvoke: boolean;
  fabricated: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number;
  emptyLlm?: boolean;
}

function tokenize(s: string): string[] {
  const STOP = new Set([
    'и', 'в', 'во', 'не', 'на', 'по', 'с', 'со', 'а', 'но', 'что', 'как', 'из', 'у', 'за', 'от', 'до', 'о', 'об',
    'для', 'то', 'же', 'ли', 'бы', 'мы', 'я', 'он', 'она', 'они', 'это', 'если', 'или', 'при', 'без', 'над', 'под',
    'наш', 'нас', 'нам', 'ещё', 'уже', 'когда', 'чтобы', 'какой', 'какие', 'себя', 'быть', 'есть', 'them', 'the',
  ]);
  return (s.toLowerCase().match(/[a-zа-яё0-9]+/gi) ?? [])
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

function stem(t: string): string {
  return t.length > 6 ? t.slice(0, Math.max(5, t.length - 2)) : t;
}

function buildCandidates(owned: OwnedRule[], summaries: Map<string, string>): Cand[] {
  return owned.map((r) => ({
    id: r.id,
    name: r.name,
    text: r.text,
    summary: (summaries.get(r.id) ?? '').trim() || r.text,
  }));
}

function contextFor(strategy: StrategyId, cands: Cand[]): string {
  return cands
    .map((c, i) => {
      if (strategy === 'A_names') return `${i + 1}. id=${c.id} | ${c.name}`;
      if (strategy === 'B_summary') return `${i + 1}. id=${c.id} | ${c.name} — ${c.summary}`;
      return `${i + 1}. id=${c.id} | ${c.name} — ${c.text}`;
    })
    .join('\n');
}

function evalHit(
  g: GoldItem,
  selected: string[],
  poolIds: Set<string>,
): { hit: boolean; falseInvoke: boolean; fabricated: number } {
  const fabricated = selected.filter((id) => !poolIds.has(id)).length;
  const valid = selected.filter((id) => poolIds.has(id));
  if (g.category === 'rule_absent') {
    return { hit: valid.length === 0, falseInvoke: valid.length > 0, fabricated };
  }
  const goldSet = new Set(g.gold);
  return { hit: valid.some((id) => goldSet.has(id)), falseInvoke: false, fabricated };
}

function parseIds(text: string): string[] {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const obj = JSON.parse(m ? m[0] : text) as { ids?: unknown };
    if (Array.isArray(obj.ids)) return obj.ids.filter((x): x is string => typeof x === 'string');
  } catch {
    /* fallthrough */
  }
  return [];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function bm25Select(question: string, cands: Cand[], absMin: number): string[] {
  const docs = cands.map((c) => tokenize(`${c.name} ${c.text}`).map(stem));
  const N = docs.length;
  const avgdl = mean(docs.map((d) => d.length)) || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const k1 = 1.5;
  const b = 0.75;
  const q = [...new Set(tokenize(question).map(stem))];
  const scores = docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const term of q) {
      const f = tf.get(term) ?? 0;
      if (f === 0) continue;
      const idf = Math.log(1 + (N - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (d.length / avgdl))));
    }
    return s;
  });
  const best = Math.max(0, ...scores);
  if (best < absMin) return [];
  const out: string[] = [];
  for (let i = 0; i < cands.length; i++) if (scores[i]! >= Math.max(absMin, best * 0.6)) out.push(cands[i]!.id);
  return out;
}

async function loadOrphanCandidates(
  prisma: PrismaService,
  orgId: string,
  ownedIds: Set<string>,
): Promise<Cand[]> {
  const base = { tenantId: orgId, deletedAt: null, status: 'active' as const };
  const notShared = (scope: string | null): boolean =>
    scope !== 'org' && !(scope ?? '').startsWith('department:');
  const [regs, instrs, pols, procs] = await Promise.all([
    prisma.regulation.findMany({ where: base, select: { id: true, name: true, statement: true, contentMd: true, scope: true } }),
    prisma.instruction.findMany({ where: base, select: { id: true, name: true, statement: true, contentMd: true, scope: true } }),
    prisma.policy.findMany({ where: base, select: { id: true, name: true, contentMd: true, scope: true } }),
    prisma.process.findMany({ where: base, select: { id: true, name: true, description: true, scope: true } }),
  ]);
  const pick = (id: string, name: string, text: string, scope: string | null): Cand | null =>
    ownedIds.has(id) || !notShared(scope) ? null : { id, name, text: (text ?? '').trim().slice(0, 4000), summary: (text ?? '').trim().slice(0, 4000) };
  const out: Cand[] = [];
  for (const r of regs) {
    const c = pick(r.id, r.name, (r.statement && r.statement.trim()) || r.contentMd, r.scope);
    if (c) out.push(c);
  }
  for (const r of instrs) {
    const c = pick(r.id, r.name, (r.statement && r.statement.trim()) || r.contentMd, r.scope);
    if (c) out.push(c);
  }
  for (const r of pols) {
    const c = pick(r.id, r.name, r.contentMd, r.scope);
    if (c) out.push(c);
  }
  for (const r of procs) {
    const c = pick(r.id, r.name, r.description ?? '', r.scope);
    if (c) out.push(c);
  }
  return out;
}

async function main(): Promise<void> {
  assertNotProd();
  const orgId = requireOrg();
  if (!existsSync(OWNERSHIP)) throw new Error('нет ownership.json — сначала explore');
  const ownership = JSON.parse(readFileSync(OWNERSHIP, 'utf8')) as {
    ownedByRole: Record<CloneKey, OwnedRule[]>;
  };
  const summaries = new Map<string, string>();
  if (existsSync(SUMMARIES)) {
    const arr = JSON.parse(readFileSync(SUMMARIES, 'utf8')) as Array<{ id: string; summary: string }>;
    for (const e of arr) summaries.set(e.id, e.summary);
  }
  const summariesReady = summaries.size > 0;

  await withApp(async (app) => {
    const cfg = app.get(TypedConfigService);
    const router = app.get(LlmRouterService);
    const embedder = app.get(KnowledgeEmbeddingService);

    const bm25AbsMin = await cfg.getDynamic<number>('clone.regulations.router.bm25_min', undefined, 1.0);
    const semThreshold = await cfg.getDynamic<number>('clone.regulations.router.semantic_threshold', undefined, 0.45);
    log(`bakeoff: gold ${GOLD.length}, router=${ROUTER_MODEL}, bm25_min=${bm25AbsMin}, sem_thr=${semThreshold}, summaries=${summariesReady ? 'ON' : 'OFF'}`);

    const candByRole = new Map<CloneKey, Cand[]>();
    for (const key of Object.keys(ownership.ownedByRole) as CloneKey[]) {
      candByRole.set(key, buildCandidates(ownership.ownedByRole[key] ?? [], summaries));
    }

    const embedCache = new Map<string, number[]>();
    const embed = async (text: string): Promise<number[] | null> => {
      const hit = embedCache.get(text);
      if (hit) return hit;
      const v = await embedder.embedQuery(text);
      if (v) embedCache.set(text, v);
      return v;
    };

    const scalePool = Number(process.env['SCALE_POOL'] ?? '0');
    if (scalePool > 0) {
      const prisma = app.get(PrismaService);
      const ownedIds = new Set<string>();
      for (const arr of Object.values(ownership.ownedByRole)) for (const r of arr) ownedIds.add(r.id);
      const orphans = await loadOrphanCandidates(prisma, orgId, ownedIds);
      log(`  SCALE_POOL=${scalePool}: бесхозных-дистракторов ${orphans.length}, расширяю пулы ролей ближайшими по смыслу`);
      for (const key of Object.keys(ownership.ownedByRole) as CloneKey[]) {
        const owned = candByRole.get(key) ?? [];
        const ownedVecs: number[][] = [];
        for (const c of owned) {
          const v = await embed(`${c.name}. ${c.text}`);
          if (v) ownedVecs.push(v);
        }
        const scored: Array<{ c: Cand; sim: number }> = [];
        for (const o of orphans) {
          if (owned.some((x) => x.id === o.id)) continue;
          const ov = await embed(`${o.name}. ${o.text}`);
          if (!ov) continue;
          const sim = Math.max(0, ...ownedVecs.map((wv) => cosine(ov, wv)));
          scored.push({ c: o, sim });
        }
        scored.sort((a, b) => b.sim - a.sim);
        const need = Math.max(0, scalePool - owned.length);
        candByRole.set(key, [...owned, ...scored.slice(0, need).map((s) => s.c)]);
      }
    }

    const rows: Array<{ g: GoldItem; cells: Record<StrategyId, CellResult> }> = [];
    for (const g of GOLD) {
      const cands = candByRole.get(g.clone) ?? [];
      const poolIds = new Set(cands.map((c) => c.id));
      const cells = {} as Record<StrategyId, CellResult>;

      for (const strat of ['A_names', 'B_summary', 'C_fulltext'] as StrategyId[]) {
        if (strat === 'B_summary' && !summariesReady) {
          cells[strat] = { selected: [], hit: false, falseInvoke: false, fabricated: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0, costUsd: 0 };
          continue;
        }
        const ctx = contextFor(strat, cands);
        const t0 = Date.now();
        let selected: string[] = [];
        let inTok = 0;
        let outTok = 0;
        try {
          const res = await router.call({
            taskType: 'clone-respond',
            model: ROUTER_MODEL,
            tenantId: orgId,
            dataClass: 'internal',
            maxTokens: ROUTER_MAX_TOKENS,
            responseFormat: { type: 'json_object' },
            systemPrompt: ROUTER_SYSTEM,
            userMessage: `ВОПРОС: ${g.question}\n\nПРАВИЛА РОЛИ:\n${ctx}\n\nВерни JSON {"ids":[...]}.`,
          });
          selected = parseIds(res.text);
          inTok = res.inputTokens;
          outTok = res.outputTokens;
        } catch (e) {
          log(`  ! ${g.id}/${strat} LLM fail: ${e instanceof Error ? e.message : String(e)}`);
        }
        const latencyMs = Date.now() - t0;
        const ev = evalHit(g, selected, poolIds);
        cells[strat] = {
          selected,
          hit: ev.hit,
          falseInvoke: ev.falseInvoke,
          fabricated: ev.fabricated,
          inputTokens: inTok,
          outputTokens: outTok,
          latencyMs,
          costUsd: costUsd(ROUTER_MODEL, inTok, outTok),
          emptyLlm: selected.length === 0 && inTok > 0,
        };
      }

      {
        const t0 = Date.now();
        const selected = bm25Select(g.question, cands, bm25AbsMin);
        const ev = evalHit(g, selected, poolIds);
        cells['kw_bm25'] = { selected, hit: ev.hit, falseInvoke: ev.falseInvoke, fabricated: 0, inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - t0, costUsd: 0 };
      }

      {
        const t0 = Date.now();
        let selected: string[] = [];
        const qv = await embed(g.question);
        if (qv) {
          const scored: Array<{ id: string; sim: number }> = [];
          for (const c of cands) {
            const cv = await embed(`${c.name}. ${c.text}`);
            if (cv) scored.push({ id: c.id, sim: cosine(qv, cv) });
          }
          const best = Math.max(0, ...scored.map((s) => s.sim));
          if (best >= semThreshold) {
            selected = scored.filter((s) => s.sim >= Math.max(semThreshold, best - 0.05)).map((s) => s.id);
          }
        }
        const ev = evalHit(g, selected, poolIds);
        cells['semantic'] = { selected, hit: ev.hit, falseInvoke: ev.falseInvoke, fabricated: 0, inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - t0, costUsd: 0 };
      }

      rows.push({ g, cells });
      log(`  ${g.id} [${g.category}/${g.clone}] pool=${cands.length} ` + STRATEGIES.map((s) => `${s.split('_')[0]}:${cells[s].hit ? '✓' : '✗'}`).join(' '));
    }

    const hitCats = rows.filter((r) => r.g.category !== 'rule_absent');
    const absentCats = rows.filter((r) => r.g.category === 'rule_absent');

    const report: string[] = [];
    report.push(`# Бейк-офф подбора правил роли клоном — отчёт`);
    report.push(`\norg=${orgId} · gold=${GOLD.length} (hit/paraphrase=${hitCats.length}, absent=${absentCats.length}) · router-модель=${ROUTER_MODEL}`);
    report.push(`bm25_min=${bm25AbsMin} · semantic_threshold=${semThreshold} · саммари=${summariesReady ? 'предвычислены' : 'НЕТ'} · router_max_tokens=${ROUTER_MAX_TOKENS} · режим пула=${scalePool > 0 ? `SCALE≈${scalePool} (owned + бесхозные-дистракторы)` : 'owned-only (5–9)'}`);
    report.push(`\n## Построчно (✓ = попал в gold; для rule_absent ✓ = вернул пусто)\n`);
    report.push(`| qid | кат | роль | pool | ${STRATEGIES.join(' | ')} |`);
    report.push(`|---|---|---|---|${STRATEGIES.map(() => '---').join('|')}|`);
    for (const r of rows) {
      const pool = (candByRole.get(r.g.clone) ?? []).length;
      const cellStr = STRATEGIES.map((s) => {
        const c = r.cells[s];
        const mark = c.hit ? '✓' : '✗';
        const extra = c.falseInvoke ? '⚠fi' : c.fabricated > 0 ? `⚠fab${c.fabricated}` : '';
        return `${mark}${extra} (${c.selected.length})`;
      }).join(' | ');
      report.push(`| ${r.g.id} | ${r.g.category.replace('rule_', '')} | ${r.g.clone} | ${pool} | ${cellStr} |`);
    }

    report.push(`\n## Итоговая таблица бейк-оффа (стратегия × точность × цена)\n`);
    report.push(`| стратегия | router-hit (hit+para, ${hitCats.length}) | false-invoke (absent, ${absentCats.length}) | fabrication | пустой LLM | ср. вход-ток | ср. выход-ток | ср. латентность | $/запрос | $ всего |`);
    report.push(`|---|---|---|---|---|---|---|---|---|---|`);
    const summaryRows: Array<{ s: StrategyId; hitRate: number; fi: number; fab: number; empty: number; inTok: number; outTok: number; lat: number; costEach: number; costTotal: number }> = [];
    for (const s of STRATEGIES) {
      const all = rows.map((r) => r.cells[s]);
      const hits = hitCats.filter((r) => r.cells[s].hit).length;
      const fi = absentCats.filter((r) => r.cells[s].falseInvoke).length;
      const fab = all.reduce((a, c) => a + c.fabricated, 0);
      const empty = hitCats.filter((r) => r.cells[s].emptyLlm).length;
      const inTok = mean(all.map((c) => c.inputTokens));
      const outTok = mean(all.map((c) => c.outputTokens));
      const lat = mean(all.map((c) => c.latencyMs));
      const costEach = mean(all.map((c) => c.costUsd));
      const costTotal = all.reduce((a, c) => a + c.costUsd, 0);
      summaryRows.push({ s, hitRate: hits / Math.max(1, hitCats.length), fi, fab, empty, inTok, outTok, lat, costEach, costTotal });
      report.push(
        `| ${s} | ${pct(hits, hitCats.length)} (${hits}/${hitCats.length}) | ${fi} | ${fab} | ${empty} | ${inTok.toFixed(0)} | ${outTok.toFixed(0)} | ${lat.toFixed(0)}ms | ${fmtUsd(costEach)} | ${fmtUsd(costTotal)} |`,
      );
    }

    const bestAcc = Math.max(...summaryRows.map((r) => r.hitRate));
    const cheapestAtBest = summaryRows.filter((r) => r.hitRate >= bestAcc - 0.001 && r.fi === 0 && r.fab === 0).sort((a, b) => a.costEach - b.costEach)[0];
    report.push(`\n## Вывод\n`);
    report.push(`- Лучшая достигнутая точность: **${pct(Math.round(bestAcc * hitCats.length), hitCats.length)}**.`);
    if (cheapestAtBest) {
      report.push(`- Победитель по связке точность×цена: **${cheapestAtBest.s}** (hit ${pct(Math.round(cheapestAtBest.hitRate * hitCats.length), hitCats.length)}, fabrication=0, false-invoke=0, ${fmtUsd(cheapestAtBest.costEach)}/запрос, ${cheapestAtBest.inTok.toFixed(0)} вход-ток).`);
    } else {
      report.push(`- Ни одна стратегия не дала точность=потолок при fabrication=0 И false-invoke=0 — см. таблицу.`);
    }
    report.push(`- LLM-стратегии vs не-LLM базы: см. $/запрос и латентность выше. Не-LLM (kw_bm25/semantic) стоят $0 по chat-токенам.`);

    const body = report.join('\n');
    mkdirSync(ARTIFACTS_DIR, { recursive: true });
    writeFileSync(REPORT, body + '\n', 'utf8');
    writeFileSync(RESULTS, JSON.stringify({ orgId, rows: rows.map((r) => ({ id: r.g.id, category: r.g.category, clone: r.g.clone, gold: r.g.gold, cells: r.cells })), summaryRows }, null, 2), 'utf8');
    log(`\n✓ bakeoff → ${REPORT}`);
    log('');
    log(body);
  });
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    process.stderr.write(`bakeoff FAIL: ${e instanceof Error ? e.stack : String(e)}\n`);
    process.exit(1);
  });
