import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
});

const NEW_MODEL = 'deepseek-v4-pro';
const NEW_PROVIDER = 'deepseek';

interface MigrationTarget {
  taskType: string;
  category: 'merge' | 'cron' | 'formulate' | 'chat' | 'rollup' | 'classifier';
  smokeOk: boolean;
}

const TARGETS: MigrationTarget[] = [
  { taskType: 'regulation-dedupe', category: 'merge', smokeOk: true },
  { taskType: 'decision-supersede-detect', category: 'merge', smokeOk: true },
  { taskType: 'entity-merge-arbiter', category: 'merge', smokeOk: true },
  { taskType: 'knowledge-clone-merge', category: 'merge', smokeOk: true },
  { taskType: 'idea-cluster-merge', category: 'merge', smokeOk: true },
  { taskType: 'skill-trait-merge', category: 'merge', smokeOk: true },
  { taskType: 'helpfulness-trait-merge', category: 'merge', smokeOk: true },
  { taskType: 'insight-link-to-decisions', category: 'merge', smokeOk: true },
  { taskType: 'experiment-summarize-lessons', category: 'merge', smokeOk: false },

  { taskType: 'reframing', category: 'cron', smokeOk: true },
  { taskType: 'theme-classify', category: 'cron', smokeOk: true },
  { taskType: 'idea-status-summarize', category: 'cron', smokeOk: true },
  { taskType: 'skill-trait-concept-name', category: 'cron', smokeOk: true },
  { taskType: 'role-profile-build', category: 'cron', smokeOk: true },

  { taskType: 'probe-formulate', category: 'formulate', smokeOk: true },
  { taskType: 'recognition-formulate', category: 'formulate', smokeOk: true },
  { taskType: 'proactive-message-craft', category: 'formulate', smokeOk: false },

  { taskType: 'chat-v2-conversation-title', category: 'chat', smokeOk: true },

  { taskType: 'card-rollup-v2', category: 'rollup', smokeOk: true },
  { taskType: 'executable-persona-compile', category: 'rollup', smokeOk: true },

  { taskType: 'axis-classify', category: 'classifier', smokeOk: true },
];

interface LegacyProviderEntry {
  provider: string;
  model?: string;
}

interface RunStats {
  updatedTier: number;
  updatedLegacy: number;
  replacedPrimary: number;
  alreadyPro: number;
  skippedEdited: number;
  skippedNotFound: number;
  skippedOther: number;
}

async function migrateTaskType(
  target: MigrationTarget,
  updateExisting: boolean,
  dryRun: boolean,
  stats: RunStats,
): Promise<void> {
  const tag = `[${target.category}] ${target.taskType}`;
  const routes = await prisma.llmTaskRoute.findMany({
    where: { taskType: target.taskType, tenantId: null },
  });
  if (routes.length === 0) {
    stats.skippedNotFound++;
    // eslint-disable-next-line no-console
    console.log(`${tag} [skip:not-found] нет записей (tenantId=null)`);
    return;
  }

  const primaryTier = routes.find((r) => r.tier === 'primary' && r.providerName !== null);
  const legacyRecord = routes.find((r) => r.tier === null && r.providers != null);

  if (primaryTier) {
    if (primaryTier.editedByAdmin) {
      stats.skippedEdited++;
      // eslint-disable-next-line no-console
      console.log(
        `${tag} [skip:edited] primary id=${primaryTier.id} provider=${primaryTier.providerName}:${primaryTier.model}`,
      );
      return;
    }
    if (primaryTier.providerName === NEW_PROVIDER && primaryTier.model === NEW_MODEL) {
      stats.alreadyPro++;
      // eslint-disable-next-line no-console
      console.log(`${tag} [ok] primary уже ${NEW_PROVIDER}:${NEW_MODEL}`);
      return;
    }
    if (!updateExisting) {
      stats.skippedOther++;
      // eslint-disable-next-line no-console
      console.log(
        `${tag} [skip:no-flag] primary ${primaryTier.providerName}:${primaryTier.model} (нужно --update-existing)`,
      );
      return;
    }
    if (primaryTier.providerName === NEW_PROVIDER) {
      if (dryRun) {
        // eslint-disable-next-line no-console
        console.log(
          `${tag} [dry:updateTier] id=${primaryTier.id} ${primaryTier.model} → ${NEW_MODEL}`,
        );
      } else {
        await prisma.llmTaskRoute.update({
          where: { id: primaryTier.id },
          data: { model: NEW_MODEL },
        });
      }
      stats.updatedTier++;
      // eslint-disable-next-line no-console
      console.log(
        `${tag} [updated:tier] id=${primaryTier.id} model: ${primaryTier.model} → ${NEW_MODEL}`,
      );
      return;
    }
    if (dryRun) {
      // eslint-disable-next-line no-console
      console.log(
        `${tag} [dry:replacePrimary] id=${primaryTier.id} ${primaryTier.providerName}:${primaryTier.model} → ${NEW_PROVIDER}:${NEW_MODEL}`,
      );
    } else {
      await prisma.llmTaskRoute.update({
        where: { id: primaryTier.id },
        data: {
          providerName: NEW_PROVIDER,
          model: NEW_MODEL,
        },
      });
    }
    stats.replacedPrimary++;
    // eslint-disable-next-line no-console
    console.log(
      `${tag} [replaced:primary] id=${primaryTier.id} ${primaryTier.providerName}:${primaryTier.model} → ${NEW_PROVIDER}:${NEW_MODEL}`,
    );
    return;
  }

  if (legacyRecord) {
    if (legacyRecord.editedByAdmin) {
      stats.skippedEdited++;
      // eslint-disable-next-line no-console
      console.log(`${tag} [skip:edited] legacy id=${legacyRecord.id}`);
      return;
    }
    const providers = legacyRecord.providers as unknown as LegacyProviderEntry[];
    if (!Array.isArray(providers)) {
      stats.skippedOther++;
      // eslint-disable-next-line no-console
      console.log(`${tag} [skip:invalid] legacy providers не массив`);
      return;
    }
    const deepseekIdx = providers.findIndex((p) => p.provider === NEW_PROVIDER);
    const alreadyHasPro = providers.some(
      (p) => p.provider === NEW_PROVIDER && p.model === NEW_MODEL,
    );
    if (alreadyHasPro) {
      stats.alreadyPro++;
      // eslint-disable-next-line no-console
      console.log(`${tag} [ok] legacy уже содержит ${NEW_PROVIDER}:${NEW_MODEL}`);
      return;
    }
    if (!updateExisting) {
      stats.skippedOther++;
      // eslint-disable-next-line no-console
      console.log(`${tag} [skip:no-flag] legacy (нужно --update-existing)`);
      return;
    }
    let newProviders: LegacyProviderEntry[];
    if (deepseekIdx === -1) {
      newProviders = [{ provider: NEW_PROVIDER, model: NEW_MODEL }, ...providers];
    } else {
      newProviders = [...providers];
      newProviders[deepseekIdx] = {
        ...newProviders[deepseekIdx],
        provider: NEW_PROVIDER,
        model: NEW_MODEL,
      };
      if (deepseekIdx > 0) {
        const head = newProviders[deepseekIdx];
        if (head) {
          newProviders.splice(deepseekIdx, 1);
          newProviders.unshift(head);
        }
      }
    }
    if (dryRun) {
      // eslint-disable-next-line no-console
      console.log(
        `${tag} [dry:legacy] id=${legacyRecord.id} → primary ${NEW_PROVIDER}:${NEW_MODEL}`,
      );
    } else {
      await prisma.llmTaskRoute.update({
        where: { id: legacyRecord.id },
        data: { providers: newProviders as unknown as object },
      });
    }
    stats.updatedLegacy++;
    // eslint-disable-next-line no-console
    console.log(
      `${tag} [updated:legacy] id=${legacyRecord.id} → primary ${NEW_PROVIDER}:${NEW_MODEL}`,
    );
    return;
  }

  stats.skippedOther++;
  // eslint-disable-next-line no-console
  console.log(`${tag} [skip:no-primary] есть записи (${routes.length}) но нет primary/legacy`);
}

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  const dryRun = process.argv.includes('--dry-run');
  // eslint-disable-next-line no-console
  console.log(
    `=== patch-mass-migrate-to-deepseek-pro START (updateExisting=${updateExisting}, dryRun=${dryRun}, targets=${TARGETS.length}) ===`,
  );

  const stats: RunStats = {
    updatedTier: 0,
    updatedLegacy: 0,
    replacedPrimary: 0,
    alreadyPro: 0,
    skippedEdited: 0,
    skippedNotFound: 0,
    skippedOther: 0,
  };

  for (const target of TARGETS) {
    await migrateTaskType(target, updateExisting, dryRun, stats);
  }

  // eslint-disable-next-line no-console
  console.log(
    `\nИТОГО: updatedTier=${stats.updatedTier}, updatedLegacy=${stats.updatedLegacy}, replacedPrimary=${stats.replacedPrimary}, alreadyPro=${stats.alreadyPro}, skippedEdited=${stats.skippedEdited}, skippedNotFound=${stats.skippedNotFound}, skippedOther=${stats.skippedOther}`,
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-mass-migrate-to-deepseek-pro FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    // eslint-disable-next-line no-console
    console.log('=== patch-mass-migrate-to-deepseek-pro DONE ===');
  });
