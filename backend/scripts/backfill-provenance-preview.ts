import { Prisma } from '@prisma/client';

import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { KnowledgeAccessResolver } from '../src/modules/rbac/knowledge-access-resolver.service';
import { ProvenanceService } from '../src/modules/knowledge-core/services/provenance.service';

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const provenance = new ProvenanceService(
  prisma as unknown as PrismaService,
  {} as unknown as KnowledgeAccessResolver,
);

interface RunArgs {
  dryRun: boolean;
}

interface Stats {
  decisions: number;
  issues: number;
  regulations: number;
  tasks: number;
}

async function backfillDecisions(dryRun: boolean): Promise<number> {
  let updated = 0;
  const rows = await prisma.decision.findMany({
    where: { previewQuote: null, sourceBlockIds: { isEmpty: false } },
    select: { id: true, tenantId: true, sourceBlockIds: true },
    take: 50_000,
  });
  for (const r of rows) {
    const snap = await provenance.computePreviewSnapshot(r.tenantId, r.sourceBlockIds);
    if (!snap.previewQuote && !snap.previewSourceRef) continue;
    if (!dryRun) {
      await prisma.decision.update({
        where: { id: r.id },
        data: {
          previewQuote: snap.previewQuote,
          previewSourceRef: (snap.previewSourceRef ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    }
    updated++;
  }
  return updated;
}

async function backfillIssues(dryRun: boolean): Promise<number> {
  let updated = 0;
  const rows = await prisma.issue.findMany({
    where: { previewQuote: null, sourceBlockIds: { isEmpty: false }, deletedAt: null },
    select: { id: true, tenantId: true, sourceBlockIds: true },
    take: 50_000,
  });
  for (const r of rows) {
    const snap = await provenance.computePreviewSnapshot(r.tenantId, r.sourceBlockIds);
    if (!snap.previewQuote && !snap.previewSourceRef) continue;
    if (!dryRun) {
      await prisma.issue.update({
        where: { id: r.id },
        data: {
          previewQuote: snap.previewQuote,
          previewSourceRef: (snap.previewSourceRef ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    }
    updated++;
  }
  return updated;
}

async function backfillRegulations(dryRun: boolean): Promise<number> {
  let updated = 0;
  const rows = await prisma.regulation.findMany({
    where: { previewQuote: null, sourceBlockIds: { isEmpty: false } },
    select: { id: true, tenantId: true, sourceBlockIds: true },
    take: 50_000,
  });
  for (const r of rows) {
    const snap = await provenance.computePreviewSnapshot(r.tenantId, r.sourceBlockIds);
    if (!snap.previewQuote && !snap.previewSourceRef) continue;
    if (!dryRun) {
      await prisma.regulation.update({
        where: { id: r.id },
        data: {
          previewQuote: snap.previewQuote,
          previewSourceRef: (snap.previewSourceRef ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    }
    updated++;
  }
  return updated;
}

async function backfillTasks(dryRun: boolean): Promise<number> {
  let updated = 0;
  const rows = await prisma.task.findMany({
    where: {
      previewSourceRef: { equals: Prisma.AnyNull },
      evidenceBlockIds: { isEmpty: false },
      tenantId: { not: null },
    },
    select: { id: true, tenantId: true, evidenceBlockIds: true },
    take: 50_000,
  });
  for (const r of rows) {
    if (!r.tenantId) continue;
    const snap = await provenance.computePreviewSnapshot(r.tenantId, r.evidenceBlockIds);
    if (!snap.previewSourceRef) continue;
    if (!dryRun) {
      await prisma.task.update({
        where: { id: r.id },
        data: { previewSourceRef: snap.previewSourceRef as Prisma.InputJsonValue },
      });
    }
    updated++;
  }
  return updated;
}

async function main(args: RunArgs): Promise<void> {
  console.log(`=== backfill-provenance-preview START (dryRun=${args.dryRun}) ===`);
  const stats: Stats = { decisions: 0, issues: 0, regulations: 0, tasks: 0 };

  stats.decisions = await backfillDecisions(args.dryRun);
  stats.issues = await backfillIssues(args.dryRun);
  stats.regulations = await backfillRegulations(args.dryRun);
  stats.tasks = await backfillTasks(args.dryRun);

  console.log(
    `updated decisions=${stats.decisions}, issues=${stats.issues}, regulations=${stats.regulations}, tasks=${stats.tasks}`,
  );
  console.log('=== backfill-provenance-preview DONE ===');
}

const dryRun = process.argv.includes('--dry-run');

main({ dryRun })
  .catch((err) => {
    console.error('backfill-provenance-preview FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });
