import { createPrismaClient } from './_lib/prisma';
import { ALL_LLM_TASK_TYPES } from '../src/modules/ai/services/llm-router.service';

export interface TierSpec {
  providerName: string;
  model: string;
}
export interface DesiredChain {
  primary: TierSpec;
  secondary: TierSpec;
  tertiary: TierSpec;
}

const DEEPSEEK_FLASH: TierSpec = { providerName: 'deepseek', model: 'deepseek-v4-flash' };
const DEEPSEEK_PRO: TierSpec = { providerName: 'deepseek', model: 'deepseek-v4-pro' };
const OPENAI_MINI: TierSpec = { providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' };
const KIE_TERTIARY: TierSpec = { providerName: 'kie', model: 'gemini-3.1-pro' };

const GPT4O_DEEPSEEK_PRO = new Set<string>([
  'orchestrator-plan',
  'orchestrator-synthesize',
  'brand-voice-extract',
]);
const CONCIERGE_RESPOND_PRIMARY: TierSpec = {
  providerName: 'openai-via-proxy',
  model: 'gpt-5-mini',
};

export function computeDesiredChain(
  taskType: string,
  current: { primary?: TierSpec; secondary?: TierSpec; tertiary?: TierSpec },
): DesiredChain {
  let primary: TierSpec | undefined;
  if (GPT4O_DEEPSEEK_PRO.has(taskType)) {
    primary = { ...DEEPSEEK_PRO };
  } else if (taskType === 'concierge-respond') {
    primary = { ...CONCIERGE_RESPOND_PRIMARY };
  }

  if (!primary) {
    if (!current.primary) {
      primary = { ...DEEPSEEK_FLASH };
    } else if (current.primary.providerName === 'ollama') {
      primary = { ...DEEPSEEK_FLASH };
    } else {
      primary = { ...current.primary };
    }
  }

  const tertiary: TierSpec = { ...KIE_TERTIARY };

  const secondary = computeSecondary(primary, current.secondary);

  return ensureDistinct(primary, secondary, tertiary);
}

function defaultSecondary(primary: TierSpec): TierSpec {
  if (primary.providerName !== 'deepseek') {
    return { ...DEEPSEEK_FLASH };
  }
  return { ...OPENAI_MINI };
}

function computeSecondary(primary: TierSpec, candidate?: TierSpec): TierSpec {
  const invalid =
    !candidate ||
    candidate.providerName === 'ollama' ||
    candidate.providerName === primary.providerName ||
    candidate.providerName === 'kie';
  if (invalid) {
    return defaultSecondary(primary);
  }
  return { ...candidate };
}

function ensureDistinct(primary: TierSpec, secondary: TierSpec, tertiary: TierSpec): DesiredChain {
  let sec = secondary;
  if (sec.providerName === primary.providerName || sec.providerName === tertiary.providerName) {
    sec = defaultSecondary(primary);
  }
  if (sec.providerName === primary.providerName || sec.providerName === tertiary.providerName) {
    sec = primary.providerName === 'deepseek' ? { ...OPENAI_MINI } : { ...DEEPSEEK_FLASH };
  }
  return { primary: { ...primary }, secondary: sec, tertiary: { ...tertiary } };
}

export function asCurrent(chain: DesiredChain): {
  primary?: TierSpec;
  secondary?: TierSpec;
  tertiary?: TierSpec;
} {
  return {
    primary: chain.primary,
    secondary: chain.secondary,
    tertiary: chain.tertiary,
  };
}

interface RunStats {
  taskTypesProcessed: number;
  tiersUpserted: number;
  tiersUnchanged: number;
  tiersDeactivated: number;
  skippedEdited: number;
}

const TIERS = ['primary', 'secondary', 'tertiary'] as const;
type TierName = (typeof TIERS)[number];

async function normalizeTaskType(
  prisma: ReturnType<typeof createPrismaClient>,
  taskType: string,
  dryRun: boolean,
  force: boolean,
  stats: RunStats,
): Promise<void> {
  const routes = await prisma.llmTaskRoute.findMany({
    where: { taskType, tenantId: null },
  });

  const current: { primary?: TierSpec; secondary?: TierSpec; tertiary?: TierSpec } = {};
  const byTier: Record<TierName, typeof routes> = {
    primary: [],
    secondary: [],
    tertiary: [],
  };
  for (const r of routes) {
    if (r.tier === 'primary' || r.tier === 'secondary' || r.tier === 'tertiary') {
      byTier[r.tier].push(r);
    }
  }
  for (const tier of TIERS) {
    const list = byTier[tier];
    const chosen = list.find((r) => r.isActive) ?? list[0];
    if (chosen && chosen.providerName) {
      current[tier] = { providerName: chosen.providerName, model: chosen.model ?? '' };
    }
  }

  const desired = computeDesiredChain(taskType, current);
  const desiredByTier: Record<TierName, TierSpec> = {
    primary: desired.primary,
    secondary: desired.secondary,
    tertiary: desired.tertiary,
  };

  stats.taskTypesProcessed++;

  for (const tier of TIERS) {
    const want = desiredByTier[tier];
    const priority = 0;
    const list = byTier[tier];
    const chosen = list.find((r) => r.isActive) ?? list[0];

    if (chosen && chosen.editedByAdmin && !force) {
      stats.skippedEdited++;
      // eslint-disable-next-line no-console
      console.log(
        `[skip:edited] ${taskType} ${tier} id=${chosen.id} ${chosen.providerName}:${chosen.model} (нужен --force)`,
      );
      continue;
    }

    const extras = list.filter((r) => r !== chosen);
    for (const ex of extras) {
      if (ex.editedByAdmin && !force) continue;
      if (!ex.isActive) continue;
      if (dryRun) {
        // eslint-disable-next-line no-console
        console.log(
          `[dry:deactivate] ${taskType} ${tier} id=${ex.id} ${ex.providerName}:${ex.model}`,
        );
      } else {
        await prisma.llmTaskRoute.update({
          where: { id: ex.id },
          data: { isActive: false },
        });
      }
      stats.tiersDeactivated++;
      if (!dryRun) {
        // eslint-disable-next-line no-console
        console.log(`[deactivate] ${taskType} ${tier} id=${ex.id} (дубль tier'а)`);
      }
    }

    if (!chosen) {
      if (dryRun) {
        // eslint-disable-next-line no-console
        console.log(`[dry:create] ${taskType} ${tier} ${want.providerName}:${want.model}`);
      } else {
        const sameKey = await prisma.llmTaskRoute.findFirst({
          where: { taskType, tenantId: null, tier, providerName: want.providerName },
        });
        if (sameKey) {
          await prisma.llmTaskRoute.update({
            where: { id: sameKey.id },
            data: { model: want.model, priority, isActive: true, providers: null },
          });
        } else {
          await prisma.llmTaskRoute.create({
            data: {
              taskType,
              tenantId: null,
              tier,
              providerName: want.providerName,
              model: want.model,
              priority,
              providers: null,
              isActive: true,
              editedByAdmin: false,
            },
          });
        }
        // eslint-disable-next-line no-console
        console.log(`[create] ${taskType} ${tier} ${want.providerName}:${want.model}`);
      }
      stats.tiersUpserted++;
      continue;
    }

    const sameProvider = chosen.providerName === want.providerName;
    const sameModel = chosen.model === want.model;
    const sameActive = chosen.isActive === true;
    const samePriority = chosen.priority === priority;
    if (sameProvider && sameModel && sameActive && samePriority && chosen.providers == null) {
      stats.tiersUnchanged++;
      continue;
    }

    if (!sameProvider) {
      const targetExisting = list.find((r) => r !== chosen && r.providerName === want.providerName);
      if (targetExisting) {
        if (targetExisting.editedByAdmin && !force) {
          stats.skippedEdited++;
          // eslint-disable-next-line no-console
          console.log(
            `[skip:edited] ${taskType} ${tier} target id=${targetExisting.id} (нужен --force)`,
          );
          continue;
        }
        if (dryRun) {
          // eslint-disable-next-line no-console
          console.log(
            `[dry:reuse] ${taskType} ${tier} id=${targetExisting.id} ${want.providerName}:${want.model}; deactivate id=${chosen.id}`,
          );
        } else {
          await prisma.llmTaskRoute.update({
            where: { id: targetExisting.id },
            data: { model: want.model, priority, isActive: true, providers: null },
          });
          await prisma.llmTaskRoute.update({
            where: { id: chosen.id },
            data: { isActive: false },
          });
          // eslint-disable-next-line no-console
          console.log(
            `[reuse] ${taskType} ${tier} → ${want.providerName}:${want.model} (id=${targetExisting.id}), deactivate id=${chosen.id}`,
          );
        }
        stats.tiersUpserted++;
        continue;
      }
    }

    if (dryRun) {
      // eslint-disable-next-line no-console
      console.log(
        `[dry:update] ${taskType} ${tier} id=${chosen.id} ${chosen.providerName}:${chosen.model} → ${want.providerName}:${want.model}`,
      );
    } else {
      await prisma.llmTaskRoute.update({
        where: { id: chosen.id },
        data: {
          providerName: want.providerName,
          model: want.model,
          priority,
          isActive: true,
          providers: null,
        },
      });
      // eslint-disable-next-line no-console
      console.log(
        `[update] ${taskType} ${tier} id=${chosen.id} → ${want.providerName}:${want.model}`,
      );
    }
    stats.tiersUpserted++;
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  const prisma = createPrismaClient();

  // eslint-disable-next-line no-console
  console.log(
    `=== patch-normalize-llm-chains-deepseek-openai-kie START (dryRun=${dryRun}, force=${force}, taskTypes=${ALL_LLM_TASK_TYPES.length}) ===`,
  );

  const stats: RunStats = {
    taskTypesProcessed: 0,
    tiersUpserted: 0,
    tiersUnchanged: 0,
    tiersDeactivated: 0,
    skippedEdited: 0,
  };

  try {
    for (const taskType of ALL_LLM_TASK_TYPES) {
      await normalizeTaskType(prisma, taskType, dryRun, force, stats);
    }
  } finally {
    await prisma.$disconnect();
  }

  // eslint-disable-next-line no-console
  console.log(
    `\nИТОГО: taskTypesProcessed=${stats.taskTypesProcessed}, tiersUpserted=${stats.tiersUpserted}, ` +
      `tiersUnchanged=${stats.tiersUnchanged}, tiersDeactivated=${stats.tiersDeactivated}, ` +
      `skippedEdited=${stats.skippedEdited}${dryRun ? ' (DRY-RUN — ничего не записано)' : ''}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== patch-normalize-llm-chains-deepseek-openai-kie DONE ===');
}

if (import.meta.main) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-normalize-llm-chains-deepseek-openai-kie FAILED:', err);
    process.exit(1);
  });
}
