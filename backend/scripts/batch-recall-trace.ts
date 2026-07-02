import { NestFactory } from '@nestjs/core';
import { readFileSync, writeFileSync } from 'node:fs';

import { AppModule } from '../src/app.module';
import { DialogService } from '../src/modules/dialog-layer/services/dialog.service';
import { ChatV2OrchestrationService } from '../src/modules/chat-v2/chat-v2.service';

const ORG = 'cmr1qbvpx0001pwbwxbgmh1jl';
const USER = 'cmqxh4za3000018bwpuy1whg3';
const SCRATCH =
  '/private/tmp/claude-501/-Users-sergrvmz-Documents-kora/82c87a6d-ef71-45ce-b4d4-c4b5dd4e924d/scratchpad';
const BANK = `${SCRATCH}/strela-recall-questions.json`;
const OUT = `${SCRATCH}/strela-recall-results.json`;
const HONEST = 'В памяти компании я этого не нашёл';
const LIMIT = Number(process.argv[2] ?? '0') || Number.POSITIVE_INFINITY;
const CONCURRENCY = 3;

type Msg = { role: 'user' | 'assistant'; content: string };

async function processOne(
  dialog: DialogService,
  orch: ChatV2OrchestrationService,
  it: Record<string, unknown>,
  history: Msg[],
): Promise<Record<string, unknown>> {
  let d: any = null;
  let a: any = null;
  let error: string | null = null;
  const t0 = Date.now();
  try {
    d = await dialog.process({
      tenantId: ORG,
      userId: USER,
      userMessage: String(it.question),
      conversationId: null,
      scope: 'org',
      scopeRefId: null,
      validAt: null,
      historyOverride: history,
    });
    a = await orch.askEphemeral({
      tenantId: ORG,
      userId: USER,
      question: String(it.question),
      history,
      scope: 'org',
      collectTrace: true,
    } as any);
  } catch (e: any) {
    error = String(e?.message ?? e);
  }
  const seconds = Number(((Date.now() - t0) / 1000).toFixed(1));
  const sf = d?.structuralFilters ?? null;
  const pf = d?.queryPlan?.filters ?? null;
  const tr = a?.retrievalTrace ?? null;
  const cites = a?.citations ?? [];
  const honest = a
    ? String(a.text ?? '').includes(HONEST) ||
      a.needsClarification === true ||
      (Array.isArray(a.usedBlockIds) && a.usedBlockIds.length === 0 && cites.length === 0)
    : false;

  return {
    id: it.id,
    angle: it.angle,
    question: it.question,
    expectedAnswer: it.expectedAnswer,
    expectedEntities: it.expectedEntities,
    targeted: it.targeted,
    prediction: it.prediction,
    controlPair: it.controlPair,
    variant: it.variant,
    chain: it.chain ? String(it.chain) : null,
    turn: it.turn,
    error,
    seconds,
    queries: d?.queries ?? null,
    queryClass: d?.queryClass ?? null,
    queryClassConfidence: d?.queryClassConfidence ?? null,
    intent: d?.intent ?? null,
    planApplied: d?.queryPlan?.applied ?? null,
    entityHints: pf?.entityHints ?? null,
    personHints: pf?.personHints ?? null,
    planSignalTypes: pf?.signalTypes ?? null,
    planThemeBranches: pf?.themeBranches ?? null,
    aggregation: pf?.aggregation ?? null,
    resolvedEntityIds: sf?.entityIds ?? null,
    resolvedPersonIds: sf?.personIds ?? null,
    filterSignalTypes: sf?.signalTypes ?? null,
    filterThemeBranches: sf?.themeBranches ?? null,
    filterDateFrom: sf?.dateFrom ?? null,
    clarification: d?.clarification ? d.clarification.question : null,
    route: tr?.route ?? null,
    graphHops: tr?.graphHops ?? null,
    doorPerQuery:
      tr?.perQuery?.map((q: any) => ({
        q: q.query,
        sem: q.semanticHits?.length ?? 0,
        str: q.structuralHits?.length ?? 0,
        topSem: q.semanticHits?.slice(0, 3).map((h: any) => h.name) ?? [],
      })) ?? null,
    poolSize: tr?.poolAfterFusion?.length ?? null,
    graphRan: tr?.graphExpansion?.ran ?? null,
    graphSkip: tr?.graphExpansion?.skippedReason ?? null,
    graphNeighbors: tr?.graphExpansion?.neighborsAdded?.length ?? null,
    graphNeighborSample:
      tr?.graphExpansion?.neighborsAdded
        ?.slice(0, 5)
        .map((n: any) => ({ name: n.name, via: n.viaRelation, conf: n.confidence })) ?? null,
    rerankTop: tr?.afterRerank?.slice(0, 8).map((h: any) => h.name) ?? null,
    answerKind: a?.answerKind ?? null,
    dataClass: a?.dataClass ?? null,
    honest,
    citationsCount: cites.length,
    usedBlockIds: a?.usedBlockIds ?? null,
    citations: cites
      .slice(0, 5)
      .map((c: any) => ({ title: c.meetingTitle, snippet: String(c.snippet ?? '').slice(0, 140) })),
    answerText: a?.text ?? null,
  };
}

function logProgress(n: number, total: number, rec: Record<string, unknown>): void {
  const g = rec.graphRan
    ? `graphY(${rec.graphNeighbors})`
    : `graphN(${rec.graphSkip ?? ''})`;
  console.log(
    `[${n}/${total}] ${rec.id} ${rec.angle} cls=${rec.queryClass} entIds=${(rec.resolvedEntityIds as unknown[])?.length ?? 0} route=${rec.route} ${g} ${rec.honest ? 'EMPTY' : `ans(${rec.citationsCount})`} ${rec.seconds}s${rec.error ? ` ERR:${rec.error}` : ''}`,
  );
}

async function main(): Promise<void> {
  const bank = JSON.parse(readFileSync(BANK, 'utf8')) as Array<Record<string, unknown>>;
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const dialog = app.get(DialogService);
  const orch = app.get(ChatV2OrchestrationService);

  const singles = bank.filter((b) => !b.chain).slice(0, LIMIT);
  const chainMap: Record<string, Array<Record<string, unknown>>> = {};
  for (const b of bank.filter((b) => b.chain)) {
    const key = String(b.chain);
    (chainMap[key] ??= []).push(b);
  }
  for (const k of Object.keys(chainMap)) {
    chainMap[k].sort((a, b) => Number(a.turn ?? 0) - Number(b.turn ?? 0));
  }
  const total = singles.length + (LIMIT === Number.POSITIVE_INFINITY ? Object.values(chainMap).flat().length : 0);

  const results: Array<Record<string, unknown>> = [];
  let done = 0;
  const flush = (): void => writeFileSync(OUT, JSON.stringify(results, null, 2));

  let idx = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, singles.length) }, async () => {
    while (true) {
      const cur = idx++;
      if (cur >= singles.length) break;
      const rec = await processOne(dialog, orch, singles[cur], []);
      results.push(rec);
      done += 1;
      logProgress(done, total, rec);
      flush();
    }
  });
  await Promise.all(runners);

  if (LIMIT === Number.POSITIVE_INFINITY) {
    for (const k of Object.keys(chainMap)) {
      const hist: Msg[] = [];
      for (const it of chainMap[k]) {
        const rec = await processOne(dialog, orch, it, hist);
        hist.push(
          { role: 'user', content: String(it.question) },
          { role: 'assistant', content: String(rec.answerText ?? '') },
        );
        results.push(rec);
        done += 1;
        logProgress(done, total, rec);
        flush();
      }
    }
  }

  await app.close();
  console.log(`\nDONE ${results.length} → ${OUT}`);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
