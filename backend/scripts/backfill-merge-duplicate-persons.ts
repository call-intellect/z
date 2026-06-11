/**
 * Backfill слияния дублей Person по email внутри Org (2026-06-10, Ф3).
 *
 * Контекст:
 *   ТЗ `plans/tz/2026-06-10-meeting-stuck-and-team-roster-fixes.md` (Ф3).
 *   Источник дублей — раздел «Команда»: на один email внутри Org появляется
 *   две карточки Person — аккаунтная (с userId, имя часто = логин/локальная
 *   часть email) и ручная (userId=null, человеческое имя + jobTitle + отдел).
 *   Это ломает атрибуцию и мешает установить partial unique
 *   `persons_tenant_email_active_uniq`.
 *
 *   Скрипт сливает группы активных Person с одинаковым lower(email) внутри
 *   одного tenant: выбирает каноническую (аккаунтную, иначе — старейшую),
 *   обогащает её пустые поля непустыми из дублей (отдел/компания/должность,
 *   а «слабое» имя-логин заменяет первым человеческим), переносит активную
 *   должность/роль на каноническую (только если у канонической своей нет),
 *   а дубли soft-delete'ит (`deletedAt`). Работает на автономном prisma —
 *   агрегатор apply-prod-deploy запускает скрипт дочерним процессом, без Nest DI.
 *
 * Идемпотентность:
 *   Повторный прогон → дубли уже soft-deleted → нет групп >1 → 0 изменений.
 *
 * РИСК:
 *   Трогает прод-карточки людей. Поэтому: удаление строго soft (deletedAt),
 *   обогащение — только в пустые поля канонической (данные не перезатираются),
 *   перенос должности/роли — поштучно с ловлей P2002 (unique-конфликт → skip),
 *   а дефолтный режим — dry-run (предпросмотр плана без записи).
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/backfill-merge-duplicate-persons.ts            # dry-run
 *   docker compose exec backend bun run scripts/backfill-merge-duplicate-persons.ts --apply     # запись
 *   docker compose exec backend bun run scripts/backfill-merge-duplicate-persons.ts --tenant=<id> # скоуп по Org (опц.)
 *
 * Регистрация: backend/scripts/apply-prod-deploy.ts (phase: 'backfill', skipBootstrap).
 */

import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

export interface MergePersonInput {
  id: string;
  userId: string | null;
  name: string;
  email: string;
  primaryDepartmentId: string | null;
  company: string | null;
  jobTitle: string | null;
  createdAt: Date;
  hasActiveAppointment: boolean;
  hasActivePersonRole: boolean;
}

/** «Слабое» имя = логин/локальная часть email (ASCII без пробелов) → заменяемо человеческим (Р4). */
export function isWeakName(name: string, email: string): boolean {
  const n = name.trim();
  if (!n) return true;
  const local = email.split('@')[0].trim().toLowerCase();
  if (local && n.toLowerCase() === local) return true;
  return /^[A-Za-z0-9._+\-]+$/.test(n);
}

export type MergePlan =
  | { skip: 'multiple_accounts'; reason: string }
  | {
      canonicalId: string;
      duplicateIds: string[];
      // патч в каноническую: только непустые поля из дублей, КУДА у канонической пусто;
      // name — заменить, если у канонической слабое, а у дубля человеческое.
      enrich: {
        name?: string;
        primaryDepartmentId?: string;
        company?: string;
        jobTitle?: string;
      };
      // id дублей, чью активную должность/роль нужно перенести на каноническую
      // (только если у канонической своей активной НЕТ).
      moveAppointmentFrom: string[];
      movePersonRoleFrom: string[];
    };

function isEmpty(v: string | null | undefined): boolean {
  return v === null || v === undefined || v === '';
}

/** Решение по группе (>1 запись, один lower(email), один tenant). Без БД — для теста. */
export function planMerge(group: MergePersonInput[]): MergePlan {
  // 1. Два и более аккаунта на email — не сливаем автоматически (ручной разбор).
  const accounts = group.filter((g) => g.userId);
  if (accounts.length >= 2) {
    return {
      skip: 'multiple_accounts',
      reason: `email привязан к ${accounts.length} аккаунтам (userId) — нужен ручной разбор`,
    };
  }

  // 2. Каноническая = единственный аккаунт, иначе старейшая по createdAt.
  const canonical =
    accounts.length === 1
      ? accounts[0]
      : [...group].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

  // 3. Дубли — все, кроме канонической.
  const duplicates = group.filter((g) => g.id !== canonical.id);

  // 4. Обогащение: непустые поля дублей в пустые поля канонической; слабое имя → человеческое.
  const enrich: {
    name?: string;
    primaryDepartmentId?: string;
    company?: string;
    jobTitle?: string;
  } = {};

  const canonicalNameWeak = isWeakName(canonical.name, canonical.email);

  for (const dup of duplicates) {
    if (
      isEmpty(canonical.primaryDepartmentId) &&
      enrich.primaryDepartmentId === undefined &&
      !isEmpty(dup.primaryDepartmentId)
    ) {
      enrich.primaryDepartmentId = dup.primaryDepartmentId as string;
    }
    if (isEmpty(canonical.company) && enrich.company === undefined && !isEmpty(dup.company)) {
      enrich.company = dup.company as string;
    }
    if (isEmpty(canonical.jobTitle) && enrich.jobTitle === undefined && !isEmpty(dup.jobTitle)) {
      enrich.jobTitle = dup.jobTitle as string;
    }
    if (
      canonicalNameWeak &&
      enrich.name === undefined &&
      !isWeakName(dup.name, dup.email)
    ) {
      enrich.name = dup.name;
    }
  }

  // 5/6. Перенос активной должности/роли — только если у канонической своей нет.
  const moveAppointmentFrom = canonical.hasActiveAppointment
    ? []
    : duplicates.filter((d) => d.hasActiveAppointment).map((d) => d.id);
  const movePersonRoleFrom = canonical.hasActivePersonRole
    ? []
    : duplicates.filter((d) => d.hasActivePersonRole).map((d) => d.id);

  return {
    canonicalId: canonical.id,
    duplicateIds: duplicates.map((d) => d.id),
    enrich,
    moveAppointmentFrom,
    movePersonRoleFrom,
  };
}

export interface Stats {
  groupsScanned: number; // групп с >1 активной карточкой
  groupsMerged: number;
  groupsSkippedMultiAccount: number;
  duplicatesSoftDeleted: number;
  appointmentsMoved: number;
  personRolesMoved: number;
  appointmentMovesSkippedConflict: number;
  fieldsEnriched: number; // суммарно полей (вкл. name)
}

export async function backfillMergeDuplicatePersons(
  prisma: PrismaClient,
  opts: { apply: boolean; tenant?: string },
): Promise<Stats> {
  const stats: Stats = {
    groupsScanned: 0,
    groupsMerged: 0,
    groupsSkippedMultiAccount: 0,
    duplicatesSoftDeleted: 0,
    appointmentsMoved: 0,
    personRolesMoved: 0,
    appointmentMovesSkippedConflict: 0,
    fieldsEnriched: 0,
  };

  console.log(
    `=== backfill-merge-duplicate-persons START (apply=${opts.apply}${
      opts.tenant ? `, tenant=${opts.tenant}` : ''
    }) ===`,
  );

  // 1. Загрузить активные Person (таблица небольшая — целиком в память).
  const persons = await prisma.person.findMany({
    where: {
      deletedAt: null,
      email: { not: '' },
      ...(opts.tenant ? { tenantId: opts.tenant } : {}),
    },
    select: {
      id: true,
      tenantId: true,
      userId: true,
      name: true,
      email: true,
      primaryDepartmentId: true,
      company: true,
      jobTitle: true,
      createdAt: true,
      appointments: { where: { validTo: null }, select: { id: true } },
      personRoles: { where: { validTo: null }, select: { id: true } },
    },
  });

  // 2. Сгруппировать по (tenantId, lower(email)).
  const groups = new Map<string, typeof persons>();
  for (const p of persons) {
    const key = `${p.tenantId}::${p.email.trim().toLowerCase()}`;
    const arr = groups.get(key);
    if (arr) arr.push(p);
    else groups.set(key, [p]);
  }

  // 3. Обработка групп >1.
  for (const [, members] of groups) {
    if (members.length <= 1) continue;
    stats.groupsScanned++;

    const input: MergePersonInput[] = members.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.name,
      email: m.email,
      primaryDepartmentId: m.primaryDepartmentId,
      company: m.company,
      jobTitle: m.jobTitle,
      createdAt: m.createdAt,
      hasActiveAppointment: m.appointments.length > 0,
      hasActivePersonRole: m.personRoles.length > 0,
    }));

    const plan = planMerge(input);

    if ('skip' in plan) {
      stats.groupsSkippedMultiAccount++;
      console.warn(
        `[skip multi-account] tenant=${members[0].tenantId} email=${members[0].email
          .trim()
          .toLowerCase()} ids=[${members.map((m) => m.id).join(',')}] — ${plan.reason}`,
      );
      continue;
    }

    if (!opts.apply) {
      // dry-run: логируем план и оцениваем статистику.
      console.log(
        `[DRY-RUN] merge canonical=${plan.canonicalId} duplicates=[${plan.duplicateIds.join(
          ',',
        )}] enrich=${Object.keys(plan.enrich).join('|') || '∅'} moveAppt=[${plan.moveAppointmentFrom.join(
          ',',
        )}] movePR=[${plan.movePersonRoleFrom.join(',')}]`,
      );
      stats.groupsMerged++;
      stats.duplicatesSoftDeleted += plan.duplicateIds.length;
      stats.fieldsEnriched += Object.keys(plan.enrich).length;
      // Оценка переносов по hasActive у дублей из плана (по 1 активной на дубль).
      stats.appointmentsMoved += plan.moveAppointmentFrom.length;
      stats.personRolesMoved += plan.movePersonRoleFrom.length;
      continue;
    }

    // apply: всё в одной транзакции.
    await prisma.$transaction(async (tx) => {
      // a. Обогащение канонической.
      if (Object.keys(plan.enrich).length > 0) {
        await tx.person.update({ where: { id: plan.canonicalId }, data: plan.enrich });
        stats.fieldsEnriched += Object.keys(plan.enrich).length;
      }

      // b. Перенос активных appointments дублей на каноническую (поштучно, P2002 → skip).
      for (const dupId of plan.moveAppointmentFrom) {
        const appts = await tx.appointment.findMany({
          where: { personId: dupId, validTo: null },
          select: { id: true },
        });
        for (const a of appts) {
          try {
            await tx.appointment.update({
              where: { id: a.id },
              data: { personId: plan.canonicalId },
            });
            stats.appointmentsMoved++;
          } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
              stats.appointmentMovesSkippedConflict++;
            } else {
              throw err;
            }
          }
        }
      }

      // c. Перенос активных personRoles дублей на каноническую (поштучно, P2002 → skip).
      for (const dupId of plan.movePersonRoleFrom) {
        const roles = await tx.personRole.findMany({
          where: { personId: dupId, validTo: null },
          select: { id: true },
        });
        for (const r of roles) {
          try {
            await tx.personRole.update({
              where: { id: r.id },
              data: { personId: plan.canonicalId },
            });
            stats.personRolesMoved++;
          } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
              stats.appointmentMovesSkippedConflict++;
            } else {
              throw err;
            }
          }
        }
      }

      // d. Soft-delete дублей.
      for (const dupId of plan.duplicateIds) {
        await tx.person.update({ where: { id: dupId }, data: { deletedAt: new Date() } });
        stats.duplicatesSoftDeleted++;
      }
    });

    stats.groupsMerged++;
  }

  // 4. Итоги.
  console.log('=== Итоги backfill-merge-duplicate-persons ===');
  console.log(`  groupsScanned                   : ${stats.groupsScanned}`);
  console.log(`  groupsMerged                    : ${stats.groupsMerged}`);
  console.log(`  groupsSkippedMultiAccount        : ${stats.groupsSkippedMultiAccount}`);
  console.log(`  duplicatesSoftDeleted           : ${stats.duplicatesSoftDeleted}`);
  console.log(`  appointmentsMoved               : ${stats.appointmentsMoved}`);
  console.log(`  personRolesMoved                : ${stats.personRolesMoved}`);
  console.log(`  appointmentMovesSkippedConflict : ${stats.appointmentMovesSkippedConflict}`);
  console.log(`  fieldsEnriched                  : ${stats.fieldsEnriched}`);
  console.log(`  mode                            : ${opts.apply ? 'APPLY' : 'DRY-RUN'}`);

  return stats;
}

// CLI-враппер.
if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
  const tenant = tenantArg ? tenantArg.slice('--tenant='.length) : undefined;
  const prisma = createPrismaClient();
  backfillMergeDuplicatePersons(prisma, { apply, tenant })
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('backfill-merge-duplicate-persons FAILED:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
