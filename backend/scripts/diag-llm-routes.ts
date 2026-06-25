import { type LlmRouteTier } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const DEFAULT_TASK_TYPES = [
  'concierge-respond',
  'dialog-understand',
  'rag-rerank',
  'chat-v2',
  'rag-groundedness',
] as const;

const TIER_RANK: Record<LlmRouteTier, number> = {
  primary: 0,
  secondary: 1,
  tertiary: 2,
};

interface RouteRow {
  taskType: string;
  tier: LlmRouteTier;
  priority: number;
  providerName: string;
  model: string | null;
  editedByAdmin: boolean;
}

function parseTaskTypes(): string[] {
  const argv = process.argv.slice(2);
  const explicit = argv.filter((a) => !a.startsWith('--'));
  return explicit.length > 0 ? explicit : [...DEFAULT_TASK_TYPES];
}

async function main(): Promise<void> {
  const taskTypes = parseTaskTypes();
  const asJson = process.argv.includes('--json');

  const rows = await prisma.llmTaskRoute.findMany({
    where: {
      taskType: { in: taskTypes },
      tenantId: null,
      isActive: true,
      tier: { not: null },
      providerName: { not: null },
    },
  });

  const byTask = new Map<string, RouteRow[]>();
  for (const r of rows) {
    if (r.tier == null || r.providerName == null) continue;
    const list = byTask.get(r.taskType) ?? [];
    list.push({
      taskType: r.taskType,
      tier: r.tier,
      priority: r.priority,
      providerName: r.providerName,
      model: r.model,
      editedByAdmin: r.editedByAdmin,
    });
    byTask.set(r.taskType, list);
  }

  for (const [, list] of byTask) {
    list.sort((a, b) => {
      const ta = TIER_RANK[a.tier];
      const tb = TIER_RANK[b.tier];
      if (ta !== tb) return ta - tb;
      return a.priority - b.priority;
    });
  }

  if (asJson) {
    const out = taskTypes.map((taskType) => ({
      taskType,
      chain: (byTask.get(taskType) ?? []).map((r) => ({
        tier: r.tier,
        priority: r.priority,
        providerName: r.providerName,
        model: r.model,
        editedByAdmin: r.editedByAdmin,
      })),
    }));
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }

  process.stdout.write(`=== diag-llm-routes (tenantId=null, isActive) ===\n`);
  for (const taskType of taskTypes) {
    const list = byTask.get(taskType) ?? [];
    if (list.length === 0) {
      process.stdout.write(
        `\n${taskType}: НЕТ активных tier-маршрутов → едет по DEFAULT_FALLBACK_CHAIN (deepseek → openai-via-proxy → kie/gemini-3.1-pro)\n`,
      );
      continue;
    }
    process.stdout.write(`\n${taskType}:\n`);
    for (const r of list) {
      const adminMark = r.editedByAdmin ? ' [правка-админа]' : '';
      process.stdout.write(
        `  ${r.tier} (priority=${r.priority}) → ${r.providerName}:${r.model ?? '—'}${adminMark}\n`,
      );
    }
  }
  process.stdout.write('\n');
}

main()
  .catch((err) => {
    process.stderr.write(`\n✗ diag-llm-routes FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
