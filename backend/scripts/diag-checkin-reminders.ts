import { createPrismaClient } from './_lib/prisma';
import {
  getLocalHour,
  getLocalDate,
  getLocalWeekday,
} from '../src/modules/operations/utils/local-date';

const SETTING_KEYS = [
  'betaOps.morningLocalHour',
  'betaOps.eveningLocalHour',
  'betaOps.weeklyDigestLocalHour',
  'betaOps.weeklyDigestLocalDay',
  'conversational.telegramDigestHourLocal',
  'notifications.daily_budget.per_person',
  'notifications.quiet_hours.start',
  'notifications.quiet_hours.end',
];

function decideQuietHours(localHour: number, start: number, end: number): boolean {
  if (!Number.isFinite(localHour)) return false;
  if (start === end) return false;
  if (start < end) return localHour >= start && localHour < end;
  return localHour >= start || localHour < end;
}

const ENV_KEYS = [
  'DAILY_CHECKIN_ENABLED',
  'DAILY_CHECKIN_MORNING_LOCAL_HOUR',
  'DAILY_CHECKIN_EVENING_LOCAL_HOUR',
  'TELEGRAM_DIGEST_HOUR_LOCAL',
  'NODE_ENV',
  'LOG_LEVEL',
];

function head(title: string): void {
  process.stdout.write(`\n=== ${title} ===\n`);
}

function line(label: string, value: unknown): void {
  process.stdout.write(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
}

function weekdayOfDateLocal(dateLocal: string): string {
  const d = new Date(`${dateLocal}T12:00:00Z`);
  const idx = d.getUTCDay();
  return ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][idx] ?? '?';
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  const now = new Date();

  try {
    head('AdminSetting — фактические значения и ТИП (ядро гипотезы)');
    const rows = await prisma.adminSetting.findMany({
      where: { key: { in: SETTING_KEYS } },
      select: { key: true, value: true, updatedBy: true, updatedAt: true, schemaId: true },
    });
    const adminMap = new Map<string, unknown>();
    for (const k of SETTING_KEYS) {
      const r = rows.find((x) => x.key === k);
      if (!r) {
        line(k, 'НЕТ записи в AdminSetting → берётся ENV/дефолт');
        continue;
      }
      adminMap.set(k, r.value);
      process.stdout.write(
        `${k} = ${JSON.stringify(r.value)}  (typeof=${typeof r.value})  ` +
          `updatedBy=${r.updatedBy ?? '—'}  schemaId=${r.schemaId ?? '—'}\n`,
      );
    }

    head('ENV в контейнере backend');
    for (const k of ENV_KEYS) line(k, process.env[k] ?? '—');

    head('Вердикт по строгому сравнению часа (=== ломается на строке)');
    const effMorning =
      adminMap.get('betaOps.morningLocalHour') ??
      (process.env.DAILY_CHECKIN_MORNING_LOCAL_HOUR !== undefined
        ? Number(process.env.DAILY_CHECKIN_MORNING_LOCAL_HOUR)
        : 9);
    const effEvening =
      adminMap.get('betaOps.eveningLocalHour') ??
      (process.env.DAILY_CHECKIN_EVENING_LOCAL_HOUR !== undefined
        ? Number(process.env.DAILY_CHECKIN_EVENING_LOCAL_HOUR)
        : 18);
    for (const [name, eff] of [
      ['morning', effMorning],
      ['evening', effEvening],
    ] as const) {
      const asNum = Number(eff);
      const strictOk = asNum === eff;
      process.stdout.write(
        `${name}: значение=${JSON.stringify(eff)} typeof=${typeof eff} | ` +
          `strict (${asNum} === значение) = ${strictOk} | ` +
          `${strictOk ? 'OK' : '🔴 СЛОМАНО: localHour(number) === значение(string) всегда false → ' + name + ' не уходит НИКОГДА'}\n`,
      );
    }

    head('Сотрудники: таймзона, рабочие дни, текущий локальный час');
    const persons = await prisma.person.findMany({
      where: { relationship: 'employee', userId: { not: null }, deletedAt: null },
      select: { id: true, name: true, timezone: true, workingDays: true, tenantId: true },
      take: 100,
    });
    line('всего сотрудников (employee, userId≠null)', persons.length);
    for (const p of persons.slice(0, 30)) {
      const lh = getLocalHour(now, p.timezone);
      const wd = getLocalWeekday(now, p.timezone);
      process.stdout.write(
        `- ${p.name ?? p.id}: tz=${p.timezone ?? '—(→Europe/Moscow)'} ` +
          `workingDays=${JSON.stringify(p.workingDays)} ` +
          `сейчас localHour=${lh} (${wd}) localDate=${getLocalDate(now, p.timezone)}\n`,
      );
    }

    head('DailyCheckIn за последние записи: приходил ли MORNING и в какие дни недели');
    const checkins = await prisma.dailyCheckIn.findMany({
      select: {
        personId: true,
        kind: true,
        dateLocal: true,
        completedAt: true,
        source: true,
        notificationId: true,
      },
      orderBy: { dateLocal: 'desc' },
      take: 120,
    });
    line('всего записей выбрано', checkins.length);
    let morningCount = 0;
    let eveningCount = 0;
    let weekendCount = 0;
    for (const c of checkins) {
      if (c.kind === 'morning') morningCount++;
      if (c.kind === 'evening') eveningCount++;
      const wd = weekdayOfDateLocal(c.dateLocal);
      if (wd === 'сб' || wd === 'вс') weekendCount++;
    }
    line('из них kind=morning', morningCount);
    line('из них kind=evening', eveningCount);
    line('из них в выходные (сб/вс)', weekendCount);
    process.stdout.write('последние 40 записей (kind · дата · день · отвечено? · источник · есть notif?):\n');
    for (const c of checkins.slice(0, 40)) {
      process.stdout.write(
        `- ${c.kind} · ${c.dateLocal} (${weekdayOfDateLocal(c.dateLocal)}) · ` +
          `${c.completedAt ? 'отвечен' : 'без ответа'} · ${c.source} · ` +
          `${c.notificationId ? 'notif=' + c.notificationId.slice(0, 8) : 'notif=—'}\n`,
      );
    }

    head('Каналы Telegram (для утреннего дайджеста задач)');
    const tgBindings = await prisma.channelBinding.findMany({
      where: { verifiedAt: { not: null }, channel: { kind: 'telegram_bot', status: 'active' } },
      select: { userId: true },
    });
    line('активных verified telegram_bot биндингов', tgBindings.length);

    head('Тихие часы (почему утром Telegram молчит, а вечером нет)');
    const qhStart = Number(
      adminMap.get('notifications.quiet_hours.start') ??
        process.env.NOTIFICATIONS_QUIET_HOURS_START ??
        22,
    );
    const qhEnd = Number(
      adminMap.get('notifications.quiet_hours.end') ??
        process.env.NOTIFICATIONS_QUIET_HOURS_END ??
        8,
    );
    line('тихие часы start/end (глобальные)', `${qhStart}:00 — ${qhEnd}:00`);
    for (const h of [Number(effMorning), 12, Number(effEvening)]) {
      const q = decideQuietHours(h, qhStart, qhEnd);
      process.stdout.write(
        `  ${String(h).padStart(2, '0')}:00 → ${q ? '🔴 ТИХИЙ ЧАС: push (Telegram) подавляется, только in_app' : 'OK: push проходит'}\n`,
      );
    }
    const inAppPrefs = await prisma.channelBinding.findMany({
      where: { channel: { kind: 'in_app' } },
      select: { userId: true, preferences: true },
      take: 30,
    });
    let withOverride = 0;
    for (const b of inAppPrefs) {
      const raw = (b.preferences ?? {}) as Record<string, unknown>;
      const s = raw['notificationQuietHoursStart'];
      const e = raw['notificationQuietHoursEnd'];
      if (typeof s === 'number' || typeof e === 'number') {
        withOverride++;
        process.stdout.write(`  override user=${b.userId.slice(0, 10)}: start=${String(s)} end=${String(e)}\n`);
      }
    }
    line('из выбранных in_app-биндингов с персональным override тихих часов', withOverride);

    head('ИТОГ');
    process.stdout.write(
      'Смотри блок «Вердикт»: если morning strict=СЛОМАНО — корень найден (тип значения часа).\n' +
        'Если morning strict=OK, но в DailyCheckIn нет свежих kind=morning — копать доставку/расписание крона.\n' +
        'weekendCount>0 подтверждает: напоминания идут и в выходные (в коде нет проверки рабочего дня).\n',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ diag-checkin-reminders упал: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
