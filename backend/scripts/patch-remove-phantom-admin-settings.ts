import { registeredSettingKeys } from '../src/modules/admin/settings/admin-setting-schema-registry';

import { createPrismaClient } from './_lib/prisma';

export const PHANTOM_KEYS: readonly string[] = [
  'knowledge.distill.debounce_ms',
  'knowledge.distill.knn_top_k',
  'knowledge.entity.merge_threshold',
  'knowledge.theme.cosine_threshold',
  'knowledge.theme.cluster_min_size',
  'knowledge.theme.clustering_min_blocks',
  'knowledge.theme.clusterer_cron',
  'knowledge.idea.cluster_threshold',
  'knowledge.idea.clusterer_cron',
  'knowledge.idea.min_supporters_for_cluster',
  'knowledge.insight.cluster_threshold',
  'knowledge.insight.cluster_cron',
  'knowledge.insight.frequency_window_days',
  'knowledge.insight.spike_ratio',
  'knowledge.skill.min_observations',
  'knowledge.skill.trait_similarity_threshold',
  'knowledge.skill.lookback_months',
  'knowledge.skill.decay_months',
  'knowledge.skill.archive_months',
  'knowledge.persona.build_cron',
  'knowledge.persona.min_traits',
  'knowledge.persona.role_agg_min_persons',
  'knowledge.persona.executable_threshold_traits_count',
  'knowledge.block_ingest.window_segments',
  'knowledge.block_ingest.max_tokens_per_segment',
  'knowledge.block.dynamic_score_decay_days',
  'knowledge.link.min_confidence',
  'knowledge.link.knn_top_k',
  'knowledge.linker.min_blocks',
  'knowledge.curation.auto_threshold_default',
  'knowledge.curation.deep_review_threshold_default',
  'knowledge.curation.item_expiry_days',
  'embeddings.chunk_target_tokens',
  'embeddings.chunk_overlap_tokens',
  'embeddings.batch_size',
  'betaOps.commitmentFollowupLocalHour',
  'daySignals.enabled',
  'daySignals.detectThreshold',
  'daySignals.processLocalHour',
];

export function phantomTargets(registered: string[]): string[] {
  const reg = new Set(registered);
  return PHANTOM_KEYS.filter((k) => !reg.has(k));
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const targets = phantomTargets(registeredSettingKeys());

  console.log(
    `=== patch-remove-phantom-admin-settings START (mode=${apply ? 'APPLY' : 'dry-run'}, targets=${targets.length}) ===`,
  );

  if (targets.length === 0) {
    console.log('Нет целевых phantom-ключей (все известные phantom уже в реестре) — нечего чистить.');
    return;
  }

  const prisma = createPrismaClient();
  try {
    const rows = await prisma.adminSetting.findMany({
      where: { key: { in: targets } },
      select: { key: true, updatedAt: true, updatedBy: true },
    });

    if (rows.length === 0) {
      console.log('Осиротевших строк AdminSetting под phantom-ключами не найдено (0). No-op.');
      return;
    }

    for (const r of rows) {
      console.log(
        `  ${apply ? 'delete' : 'dry'} ${r.key} (updatedBy=${r.updatedBy ?? 'system'}, updatedAt=${r.updatedAt.toISOString()})`,
      );
    }

    if (!apply) {
      console.log(`\nDry-run: найдено ${rows.length} осиротевших строк. Для удаления повтори с --apply.`);
      return;
    }

    const del = await prisma.adminSetting.deleteMany({ where: { key: { in: targets } } });
    console.log(`\nУдалено строк AdminSetting: ${del.count}. (AdminSettingHistory сохранён как аудит.)`);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) {
  main()
    .catch((err) => {
      console.error('patch-remove-phantom-admin-settings FAILED:', err);
      process.exit(1);
    })
    .finally(() => {
      console.log('=== patch-remove-phantom-admin-settings DONE ===');
    });
}
