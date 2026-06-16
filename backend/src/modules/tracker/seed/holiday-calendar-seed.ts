import type { PrismaClient } from '@prisma/client';

import { HOLIDAYS_RU_2026, type HolidaySeedEntry } from './holiday-calendar-ru-2026-data';

export interface HolidayCalendarSeedStats {
  inserted: number;
  updated: number;
  skippedAdminEdited: number;
}

const ADMIN_EDIT_THRESHOLD_MS = 60 * 60 * 1000;

function parseIsoDateUtc(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export async function seedHolidayCalendarRu2026(
  prisma: PrismaClient,
  opts?: {
    entries?: readonly HolidaySeedEntry[];
    log?: (msg: string) => void;
  },
): Promise<HolidayCalendarSeedStats> {
  const entries = opts?.entries ?? HOLIDAYS_RU_2026;
  const log = opts?.log ?? ((m) => console.log(m)); // eslint-disable-line no-console
  const stats: HolidayCalendarSeedStats = {
    inserted: 0,
    updated: 0,
    skippedAdminEdited: 0,
  };

  const now = Date.now();
  for (const entry of entries) {
    const date = parseIsoDateUtc(entry.date);
    const existing = await prisma.holidayCalendar.findFirst({
      where: { tenantId: null, date },
    });

    if (!existing) {
      await prisma.holidayCalendar.create({
        data: {
          tenantId: null,
          date,
          name: entry.name,
          isWorking: entry.isWorking,
        },
      });
      stats.inserted += 1;
      log(`[inserted] holiday ${entry.date} — ${entry.name}`);
      continue;
    }

    const editedManually = now - existing.createdAt.getTime() > ADMIN_EDIT_THRESHOLD_MS;
    if (editedManually) {
      stats.skippedAdminEdited += 1;
      log(`[skipped] holiday ${entry.date} — запись создана >1ч назад, возможно отредактирована`);
      continue;
    }

    await prisma.holidayCalendar.update({
      where: { id: existing.id },
      data: { name: entry.name, isWorking: entry.isWorking },
    });
    stats.updated += 1;
    log(`[updated] holiday ${entry.date} — ${entry.name}`);
  }

  return stats;
}
