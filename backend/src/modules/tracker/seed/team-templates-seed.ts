/**
 * Wave 3 / Tracker Phase 4 — seed системных TeamTemplate.
 *
 * Идемпотентно по `@@unique([tenantId, slug])` (tenantId=null для системных).
 *
 * Защита admin-edited (skill `safe-seed-rules`):
 *   - У TeamTemplate нет поля `editedByAdmin`. Эвристика: если запись
 *     существует и `updatedAt > createdAt + 1ч` — значит её правили через
 *     админку (вручную). НЕ перезаписываем `name/description/definition`.
 *   - Если запись существует, но `updatedAt ≈ createdAt` (в пределах часа) —
 *     можно безопасно обновить (это наш предыдущий seed без правок).
 *
 * Используется:
 *   - `backend/scripts/seed-team-templates.ts` — standalone seed.
 *   - Тесты — для подготовки фикстур.
 */

import type { PrismaClient } from '@prisma/client';

import {
  ALL_TEAM_TEMPLATES,
  type TeamTemplateSeedEntry,
} from './team-templates-data';

export interface TeamTemplatesSeedStats {
  inserted: number;
  updated: number;
  skippedAdminEdited: number;
}

const ADMIN_EDIT_THRESHOLD_MS = 60 * 60 * 1000; // 1 час

/**
 * Прогон seed'а для системных TeamTemplate (tenantId=null).
 *
 * @param prisma — PrismaClient.
 * @param opts.entries — список шаблонов (по умолчанию все 15). Тесты могут передать подмножество.
 * @param opts.log — функция логирования. По умолчанию `console.log`.
 */
export async function seedSystemTeamTemplates(
  prisma: PrismaClient,
  opts?: {
    entries?: readonly TeamTemplateSeedEntry[];
    log?: (msg: string) => void;
  },
): Promise<TeamTemplatesSeedStats> {
  const entries = opts?.entries ?? ALL_TEAM_TEMPLATES;
  const log = opts?.log ?? ((m) => console.log(m)); // eslint-disable-line no-console
  const stats: TeamTemplatesSeedStats = {
    inserted: 0,
    updated: 0,
    skippedAdminEdited: 0,
  };

  for (const entry of entries) {
    // tenantId=null — composite unique, использовать findFirst (не findUnique:
    // Prisma не поддерживает null в @@unique через findUnique).
    const existing = await prisma.teamTemplate.findFirst({
      where: { tenantId: null, slug: entry.slug },
    });

    if (!existing) {
      await prisma.teamTemplate.create({
        data: {
          tenantId: null,
          slug: entry.slug,
          name: entry.name,
          description: entry.description,
          category: entry.category,
          isPublic: entry.isPublic,
          definition: entry.definition as unknown as object,
        },
      });
      stats.inserted += 1;
      log(`[inserted] team-template "${entry.slug}"`);
      continue;
    }

    const editedManually =
      existing.updatedAt.getTime() - existing.createdAt.getTime() >
      ADMIN_EDIT_THRESHOLD_MS;

    if (editedManually) {
      stats.skippedAdminEdited += 1;
      log(
        `[skipped] team-template "${entry.slug}" — admin-edited (updatedAt > createdAt + 1h)`,
      );
      continue;
    }

    await prisma.teamTemplate.update({
      where: { id: existing.id },
      data: {
        name: entry.name,
        description: entry.description,
        category: entry.category,
        isPublic: entry.isPublic,
        definition: entry.definition as unknown as object,
      },
    });
    stats.updated += 1;
    log(`[updated] team-template "${entry.slug}"`);
  }

  return stats;
}
