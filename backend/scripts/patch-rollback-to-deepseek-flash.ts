import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const OLD_MODEL = 'deepseek-v4-pro';
const NEW_MODEL = 'deepseek-v4-flash';
const PROVIDER = 'deepseek';

interface RollbackTarget {
  taskType: string;
  category: 'merge' | 'cron' | 'formulate' | 'chat' | 'rollup' | 'classifier';
}

const ROLLBACK_TARGETS: RollbackTarget[] = [
  { taskType: 'regulation-dedupe', category: 'merge' },
  { taskType: 'decision-supersede-detect', category: 'merge' },
  { taskType: 'entity-merge-arbiter', category: 'merge' },
  { taskType: 'knowledge-clone-merge', category: 'merge' },
  { taskType: 'idea-cluster-merge', category: 'merge' },
  { taskType: 'skill-trait-merge', category: 'merge' },
  { taskType: 'helpfulness-trait-merge', category: 'merge' },
  { taskType: 'insight-link-to-decisions', category: 'merge' },
  { taskType: 'experiment-summarize-lessons', category: 'merge' },

  { taskType: 'reframing', category: 'cron' },
  { taskType: 'theme-classify', category: 'cron' },
  { taskType: 'idea-status-summarize', category: 'cron' },
  { taskType: 'skill-trait-concept-name', category: 'cron' },
  { taskType: 'role-profile-build', category: 'cron' },

  { taskType: 'probe-formulate', category: 'formulate' },
  { taskType: 'recognition-formulate', category: 'formulate' },
  { taskType: 'proactive-message-craft', category: 'formulate' },

  { taskType: 'chat-v2-conversation-title', category: 'chat' },

  { taskType: 'card-rollup-v2', category: 'rollup' },

  { taskType: 'axis-classify', category: 'classifier' },
];

const EXTRA_TARGETS: RollbackTarget[] = [
  { taskType: 'chat-v2', category: 'chat' },
  { taskType: 'dialog-contextualize', category: 'chat' },
  { taskType: 'dialog-confidence', category: 'chat' },
  { taskType: 'dialog-classify', category: 'chat' },
  { taskType: 'dialog-multi-query', category: 'chat' },
  { taskType: 'dialog-summarize', category: 'chat' },
];

const FEATURE_FLAGGED_TARGETS: RollbackTarget[] = [
  { taskType: 'clone-respond-v2', category: 'chat' },
  { taskType: 'knowledge-specialists-combined', category: 'merge' },
];

interface LegacyProviderEntry {
  provider: string;
  model?: string;
}

interface RunStats {
  updatedTier: number;
  updatedLegacy: number;
  alreadyFlash: number;
  skippedEdited: number;
  skippedNotFound: number;
  skippedNoFlag: number;
  skippedOther: number;
}

async function rollbackTaskType(
  target: RollbackTarget,
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

    console.log(`${tag} [skip:not-found] нет записей (tenantId=null)`);
    return;
  }

  const primaryTier = routes.find((r) => r.tier === 'primary' && r.providerName !== null);
  const legacyRecord = routes.find((r) => r.tier === null && r.providers != null);

  if (primaryTier) {
    if (primaryTier.editedByAdmin) {
      stats.skippedEdited++;

      console.log(
        `${tag} [skip:edited] primary id=${primaryTier.id} provider=${primaryTier.providerName}:${primaryTier.model}`,
      );
      return;
    }
    if (primaryTier.providerName === PROVIDER && primaryTier.model === NEW_MODEL) {
      stats.alreadyFlash++;

      console.log(`${tag} [ok] primary уже ${PROVIDER}:${NEW_MODEL}`);
      return;
    }
    if (primaryTier.providerName !== PROVIDER) {
      stats.skippedOther++;

      console.log(
        `${tag} [skip:other-provider] primary id=${primaryTier.id} ${primaryTier.providerName}:${primaryTier.model} — не deepseek, откат не применим`,
      );
      return;
    }
    if (primaryTier.model !== OLD_MODEL) {
      if (!updateExisting) {
        stats.skippedNoFlag++;

        console.log(
          `${tag} [skip:no-flag] primary id=${primaryTier.id} model=${primaryTier.model} (не pro и не flash; нужно --update-existing для принудительного отката)`,
        );
        return;
      }
      if (dryRun) {
        console.log(
          `${tag} [dry:updateTier:forced] id=${primaryTier.id} ${primaryTier.model} → ${NEW_MODEL}`,
        );
      } else {
        await prisma.llmTaskRoute.update({
          where: { id: primaryTier.id },
          data: { model: NEW_MODEL },
        });
      }
      stats.updatedTier++;

      console.log(
        `${tag} [updated:tier:forced] id=${primaryTier.id} model: ${primaryTier.model} → ${NEW_MODEL}`,
      );
      return;
    }
    if (!updateExisting) {
      stats.skippedNoFlag++;

      console.log(
        `${tag} [skip:no-flag] primary id=${primaryTier.id} ${OLD_MODEL} (нужно --update-existing для отката на ${NEW_MODEL})`,
      );
      return;
    }
    if (dryRun) {
      console.log(`${tag} [dry:updateTier] id=${primaryTier.id} ${OLD_MODEL} → ${NEW_MODEL}`);
    } else {
      await prisma.llmTaskRoute.update({
        where: { id: primaryTier.id },
        data: { model: NEW_MODEL },
      });
    }
    stats.updatedTier++;

    console.log(`${tag} [updated:tier] id=${primaryTier.id} ${OLD_MODEL} → ${NEW_MODEL}`);
    return;
  }

  if (legacyRecord) {
    if (legacyRecord.editedByAdmin) {
      stats.skippedEdited++;

      console.log(`${tag} [skip:edited] legacy id=${legacyRecord.id}`);
      return;
    }
    const providers = legacyRecord.providers as unknown as LegacyProviderEntry[];
    if (!Array.isArray(providers)) {
      stats.skippedOther++;

      console.log(`${tag} [skip:invalid] legacy providers не массив`);
      return;
    }
    const proIdx = providers.findIndex((p) => p.provider === PROVIDER && p.model === OLD_MODEL);
    const alreadyFlash = providers.some((p) => p.provider === PROVIDER && p.model === NEW_MODEL);
    if (alreadyFlash && proIdx === -1) {
      stats.alreadyFlash++;

      console.log(`${tag} [ok] legacy уже содержит ${PROVIDER}:${NEW_MODEL}`);
      return;
    }
    if (proIdx === -1) {
      stats.skippedOther++;

      console.log(
        `${tag} [skip:other] legacy id=${legacyRecord.id} — deepseek:${OLD_MODEL} не найден`,
      );
      return;
    }
    if (!updateExisting) {
      stats.skippedNoFlag++;

      console.log(`${tag} [skip:no-flag] legacy id=${legacyRecord.id} (нужно --update-existing)`);
      return;
    }
    const newProviders = [...providers];
    newProviders[proIdx] = {
      ...newProviders[proIdx],
      provider: PROVIDER,
      model: NEW_MODEL,
    };
    if (dryRun) {
      console.log(
        `${tag} [dry:legacy] id=${legacyRecord.id} ${OLD_MODEL} → ${NEW_MODEL} (idx=${proIdx})`,
      );
    } else {
      await prisma.llmTaskRoute.update({
        where: { id: legacyRecord.id },
        data: { providers: newProviders as unknown as object },
      });
    }
    stats.updatedLegacy++;

    console.log(`${tag} [updated:legacy] id=${legacyRecord.id} ${OLD_MODEL} → ${NEW_MODEL}`);
    return;
  }

  stats.skippedOther++;

  console.log(`${tag} [skip:no-primary] есть ${routes.length} записей, но нет primary/legacy`);
}

function parseTaskFlag(): string | null {
  const idx = process.argv.indexOf('--task');
  if (idx === -1) return null;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('--task требует имя taskType, например `--task chat-v2`');
  }
  return value;
}

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  const dryRun = process.argv.includes('--dry-run');
  const includeFeatureFlagged = process.argv.includes('--include-feature-flagged');
  const onlyTask = parseTaskFlag();

  const allTargets = [
    ...ROLLBACK_TARGETS,
    ...EXTRA_TARGETS,
    ...(includeFeatureFlagged ? FEATURE_FLAGGED_TARGETS : []),
  ];
  const targets = onlyTask ? allTargets.filter((t) => t.taskType === onlyTask) : allTargets;

  if (onlyTask && targets.length === 0) {
    console.error(
      `Неизвестный --task ${onlyTask}. Доступные: ${allTargets.map((t) => t.taskType).join(', ')}`,
    );
    process.exit(2);
  }

  console.log(
    `=== patch-rollback-to-deepseek-flash START (${OLD_MODEL} → ${NEW_MODEL}, updateExisting=${updateExisting}, dryRun=${dryRun}, includeFeatureFlagged=${includeFeatureFlagged}, targets=${targets.length}${onlyTask ? `, --task ${onlyTask}` : ''}) ===`,
  );

  const stats: RunStats = {
    updatedTier: 0,
    updatedLegacy: 0,
    alreadyFlash: 0,
    skippedEdited: 0,
    skippedNotFound: 0,
    skippedNoFlag: 0,
    skippedOther: 0,
  };

  for (const target of targets) {
    await rollbackTaskType(target, updateExisting, dryRun, stats);
  }

  console.log(
    `\nИТОГО: updatedTier=${stats.updatedTier}, updatedLegacy=${stats.updatedLegacy}, alreadyFlash=${stats.alreadyFlash}, skippedEdited=${stats.skippedEdited}, skippedNotFound=${stats.skippedNotFound}, skippedNoFlag=${stats.skippedNoFlag}, skippedOther=${stats.skippedOther}`,
  );

  if (dryRun) {
    console.log(
      'Это был --dry-run. Для реального отката повтори без --dry-run (с --update-existing).',
    );
  } else if (!updateExisting && stats.updatedTier + stats.updatedLegacy === 0) {
    console.log('Изменений не сделано — повтори с --update-existing для применения отката.');
  }
}

main()
  .catch((err) => {
    console.error('patch-rollback-to-deepseek-flash FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();

    console.log('=== patch-rollback-to-deepseek-flash DONE ===');
  });
