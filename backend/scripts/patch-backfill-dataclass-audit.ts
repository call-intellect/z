/**
 * W4.2 KC-Temporal (2026-05-25) — patch-backfill для `dataClassAudit`.
 *
 * Источник: plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md §W4.2.
 *
 * Для каждой проекции (13 моделей) — загружает существующие записи, восстанавливает
 * `sourceBlockIds[]` → блоки → `DataClassPolicyService.derive(blocks, {kind})` →
 * сохраняет `dataClassAudit` с `policyVersion='backfill_v1'`.
 *
 * ⚠ ВАЖНО: dataClass НЕ меняется — только audit-trail. Если расходится с
 * derive — пишем warn в лог, но реальное значение оставляем (это совместимо
 * с DoD W4.2 «Не понижай dataClass нигде»).
 *
 * Идемпотентность: записи с `dataClassAudit IS NOT NULL` пропускаются.
 *
 * Запуск:
 *   bun run scripts/patch-backfill-dataclass-audit.ts --dry-run
 *   bun run scripts/patch-backfill-dataclass-audit.ts
 */

import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { DataClassPolicyService } from '../src/modules/knowledge-core/services/dataclass-policy.service';
import type { DerivedKind } from '../src/modules/knowledge-core/services/dataclass-policy.types';

interface RunArgs {
  dryRun: boolean;
}

interface ProjectionStats {
  kind: string;
  scanned: number;
  updated: number;
  skipped: number;
  driftedFromLegacy: number;
  errors: number;
}

const BATCH = 500;
const POLICY_VERSION_BACKFILL = 'backfill_v1';

/**
 * Map проекций → конфиг с моделью Prisma + DerivedKind + способом извлечения
 * blockIds (поле `sourceBlockIds` существует не у всех моделей).
 */
const PROJECTIONS: Array<{
  kind: DerivedKind;
  modelKey:
    | 'insight'
    | 'decision'
    | 'card'
    | 'skillTrait'
    | 'skillProfile'
    | 'executablePersona'
    | 'idea'
    | 'regulation'
    | 'process'
    | 'policy'
    | 'conflictItem'
    | 'aiUsageLog'
    | 'probeEvent';
  hasDataClassColumn: boolean;
  blockIdsField:
    | 'sourceBlockIds'
    | 'includedTraitIds'
    | 'evidenceJson'
    | 'payloadJson'
    | null;
}> = [
  { kind: 'insight', modelKey: 'insight', hasDataClassColumn: true, blockIdsField: 'sourceBlockIds' },
  { kind: 'decision', modelKey: 'decision', hasDataClassColumn: true, blockIdsField: 'sourceBlockIds' },
  { kind: 'card_rollup', modelKey: 'card', hasDataClassColumn: false, blockIdsField: 'sourceBlockIds' },
  { kind: 'skill_trait', modelKey: 'skillTrait', hasDataClassColumn: false, blockIdsField: 'sourceBlockIds' },
  { kind: 'skill_profile', modelKey: 'skillProfile', hasDataClassColumn: false, blockIdsField: null },
  { kind: 'executable_persona', modelKey: 'executablePersona', hasDataClassColumn: false, blockIdsField: 'includedTraitIds' },
  { kind: 'idea', modelKey: 'idea', hasDataClassColumn: true, blockIdsField: 'sourceBlockIds' },
  { kind: 'regulation', modelKey: 'regulation', hasDataClassColumn: true, blockIdsField: 'sourceBlockIds' },
  { kind: 'process', modelKey: 'process', hasDataClassColumn: true, blockIdsField: 'sourceBlockIds' },
  { kind: 'policy', modelKey: 'policy', hasDataClassColumn: true, blockIdsField: 'sourceBlockIds' },
  { kind: 'conflict_item', modelKey: 'conflictItem', hasDataClassColumn: false, blockIdsField: 'evidenceJson' },
  { kind: 'ai_usage_log', modelKey: 'aiUsageLog', hasDataClassColumn: false, blockIdsField: null },
  { kind: 'probe_event', modelKey: 'probeEvent', hasDataClassColumn: false, blockIdsField: 'payloadJson' },
];

async function main(args: RunArgs): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const policy = app.get(DataClassPolicyService);

    // eslint-disable-next-line no-console
    console.log(
      `=== patch-backfill-dataclass-audit START (dryRun=${args.dryRun}) ===`,
    );

    for (const projection of PROJECTIONS) {
      const stats: ProjectionStats = {
        kind: projection.kind,
        scanned: 0,
        updated: 0,
        skipped: 0,
        driftedFromLegacy: 0,
        errors: 0,
      };

      // Делегат модели — динамически по ключу.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delegate: any = (prisma as unknown as Record<string, unknown>)[projection.modelKey];
      if (!delegate || typeof delegate.findMany !== 'function') {
        // eslint-disable-next-line no-console
        console.log(
          `[${projection.kind}] delegate "${projection.modelKey}" не найден, пропускаем`,
        );
        continue;
      }

      let lastId: string | undefined;
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const rows: Array<Record<string, unknown>> = await delegate.findMany({
          where: {
            dataClassAudit: null,
            ...(lastId ? { id: { gt: lastId } } : {}),
          },
          orderBy: { id: 'asc' },
          take: BATCH,
        });
        if (rows.length === 0) break;

        for (const row of rows) {
          stats.scanned++;
          try {
            const id = String(row.id);
            const legacyDc = projection.hasDataClassColumn
              ? (row.dataClass as
                  | 'public'
                  | 'internal'
                  | 'sensitive'
                  | 'private'
                  | undefined)
              : 'internal';

            // Извлекаем sourceBlockIds.
            let blockIds: string[] = [];
            if (projection.blockIdsField === 'sourceBlockIds') {
              const v = row.sourceBlockIds;
              if (Array.isArray(v)) blockIds = v.map(String).filter(Boolean);
            } else if (projection.blockIdsField === 'includedTraitIds') {
              const v = row.includedTraitIds;
              if (Array.isArray(v)) blockIds = v.map(String).filter(Boolean);
            }

            let sources: Array<{
              dataClass: 'public' | 'internal' | 'sensitive' | 'private';
              sourceId: string;
              sourceKind: 'idea_block' | 'skill_trait' | 'other';
            }> = [];

            if (
              projection.kind === 'executable_persona' &&
              blockIds.length > 0
            ) {
              // SkillTrait'ы — берём их dataClass (фактически всегда 'internal',
              // но фиксируем сорсы для аудита).
              const traits = await prisma.skillTrait.findMany({
                where: { id: { in: blockIds } },
                select: { id: true },
              });
              sources = traits.map((t) => ({
                dataClass: 'internal' as const,
                sourceId: t.id,
                sourceKind: 'skill_trait' as const,
              }));
            } else if (blockIds.length > 0) {
              const blocks = await prisma.ideaBlock.findMany({
                where: { id: { in: blockIds } },
                select: { id: true, dataClass: true },
              });
              sources = blocks.map((b) => ({
                dataClass: b.dataClass,
                sourceId: b.id,
                sourceKind: 'idea_block' as const,
              }));
            }

            const derived = policy.derive({
              sources,
              context: { kind: projection.kind },
            });

            if (
              legacyDc &&
              projection.hasDataClassColumn &&
              legacyDc !== derived.dataClass
            ) {
              stats.driftedFromLegacy++;
              if (args.dryRun) {
                // eslint-disable-next-line no-console
                console.warn(
                  `[${projection.kind}] drift id=${id}: legacy=${legacyDc} vs derive=${derived.dataClass}`,
                );
              }
            }

            const auditWithBackfillMark = {
              ...derived.audit,
              policyVersion: POLICY_VERSION_BACKFILL,
            };

            if (!args.dryRun) {
              // ВАЖНО: dataClass НЕ обновляем — только audit.
              await delegate.update({
                where: { id },
                data: {
                  dataClassAudit:
                    auditWithBackfillMark as unknown as Prisma.InputJsonValue,
                },
              });
            }
            stats.updated++;
          } catch (err) {
            stats.errors++;
            // eslint-disable-next-line no-console
            console.warn(
              `[${projection.kind}] ошибка обработки id=${row.id}:`,
              err instanceof Error ? err.message : String(err),
            );
          }
        }
        lastId = String(rows[rows.length - 1]!.id);
        // eslint-disable-next-line no-console
        console.log(
          `[${projection.kind}] processed=${stats.scanned} updated=${stats.updated} drift=${stats.driftedFromLegacy} errors=${stats.errors}`,
        );
      }

      // eslint-disable-next-line no-console
      console.log(`=== [${projection.kind}] DONE`, stats);
    }

    // eslint-disable-next-line no-console
    console.log('=== patch-backfill-dataclass-audit END ===');
  } finally {
    await app.close();
  }
}

const args: RunArgs = {
  dryRun: process.argv.includes('--dry-run'),
};

main(args).catch((err) => {
  // eslint-disable-next-line no-console
  console.error('patch-backfill-dataclass-audit FAILED:', err);
  process.exit(1);
});
