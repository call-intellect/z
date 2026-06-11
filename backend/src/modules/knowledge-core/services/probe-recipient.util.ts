import type { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * ТЗ 2026-05-25 «clone-reliability-hardening» Фаза 3 — единая логика выбора
 * получателей probe-уведомлений Specialist 3.2 / 3.7 (и аналогичных
 * специалистов клона).
 *
 * Cabinet-leftovers §3 (2026-06-11) — само-подтверждение субъектом за
 * kill-switch `PROBE_SUBJECT_ADDRESSING_ENABLED` (дефолт ON, Ship-On).
 *
 * Алгоритм при `subjectAddressingEnabled === true` (новое поведение):
 *   probe «про сотрудника X» (skill/expertise) идёт упорядоченным
 *   дедуплицированным списком:
 *     [subject.userId?, head.userId(если есть и != subject)?, ...admins(excl subject)]
 *   — субъект ПЕРВЫМ (само-подтверждение), затем глава его primary-отдела,
 *   затем owner/admin Org как последний fallback. Если у субъекта нет
 *   `userId` (не привязан к User) — список начинается с главы/admins.
 *
 * Алгоритм при `subjectAddressingEnabled` false/undefined (старое поведение,
 * сохраняется байт-в-байт):
 *   1. Найти primary-отдел субъекта (`Person.primaryDepartmentId`).
 *   2. Найти главу отдела (`Department.headPersonId → Person.userId`).
 *   3. Если глава найден, у него есть `userId` и он не сам субъект —
 *      probe идёт только ему (никому больше; нельзя слать админам, если
 *      есть прямой руководитель).
 *   4. Иначе — fallback к `Membership.role in (owner, admin)` Org,
 *      исключая userId самого субъекта (нельзя слать probe про человека
 *      ему же).
 *
 * Если у субъекта нет `userId` (не привязан к User) — фильтр «не себе»
 * фактически снимается.
 */

/** Добавить `userId` в список, если задан и ещё не присутствует (порядок сохраняется). */
function pushUniq(list: string[], userId: string | null | undefined): void {
  if (userId && !list.includes(userId)) list.push(userId);
}

export async function resolveProbeRecipients(args: {
  prisma: PrismaService;
  tenantId: string;
  subjectPersonId: string;
  /**
   * Cabinet-leftovers §3 — kill-switch `PROBE_SUBJECT_ADDRESSING_ENABLED`.
   * `true` → субъект первым (само-подтверждение). false/undefined → старое
   * поведение (глава-only / admin, субъекту probe не шлётся).
   */
  subjectAddressingEnabled?: boolean;
}): Promise<string[]> {
  const { prisma, tenantId, subjectPersonId, subjectAddressingEnabled } = args;

  const subject = await prisma.person.findUnique({
    where: { id: subjectPersonId },
    select: { userId: true, primaryDepartmentId: true },
  });

  // Глава primary-отдела субъекта (нужна обеим веткам).
  let headUserId: string | null = null;
  if (subject?.primaryDepartmentId) {
    const dept = await prisma.department.findUnique({
      where: { id: subject.primaryDepartmentId },
      select: {
        headPerson: { select: { id: true, userId: true } },
      },
    });
    const head = dept?.headPerson;
    if (head?.userId && head.userId !== subject.userId) {
      headUserId = head.userId;
    }
  }

  // ── Новое поведение (cabinet-leftovers §3): субъект первым ──
  if (subjectAddressingEnabled === true) {
    const recipients: string[] = [];
    // 1. Само-подтверждение: probe идёт самому субъекту первым.
    pushUniq(recipients, subject?.userId ?? null);
    // 2. Глава отдела (если найден и != субъекта).
    pushUniq(recipients, headUserId);
    // 3. Последний fallback — owner/admin Org, исключая субъекта.
    const admins = await prisma.membership.findMany({
      where: {
        orgId: tenantId,
        role: { in: ['owner', 'admin'] },
      },
      select: { userId: true },
      take: 20,
    });
    for (const a of admins) {
      if (a.userId && a.userId !== subject?.userId) pushUniq(recipients, a.userId);
    }
    return recipients;
  }

  // ── Старое поведение (флаг OFF) — сохраняется байт-в-байт ──
  // Шаг 1-3: глава-only, если найдена.
  if (headUserId) {
    return [headUserId];
  }

  // Шаг 4: fallback на owner/admin Org.
  const admins = await prisma.membership.findMany({
    where: {
      orgId: tenantId,
      role: { in: ['owner', 'admin'] },
    },
    select: { userId: true },
    take: 20,
  });
  const recipients = new Set<string>();
  for (const a of admins) {
    if (a.userId && a.userId !== subject?.userId) recipients.add(a.userId);
  }
  return [...recipients];
}
