import type { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * ТЗ 2026-05-25 «clone-reliability-hardening» Фаза 3 — единая логика выбора
 * получателей probe-уведомлений Specialist 3.2 / 3.7 (и аналогичных
 * специалистов клона).
 *
 * Алгоритм:
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
export async function resolveProbeRecipients(args: {
  prisma: PrismaService;
  tenantId: string;
  subjectPersonId: string;
}): Promise<string[]> {
  const { prisma, tenantId, subjectPersonId } = args;

  const subject = await prisma.person.findUnique({
    where: { id: subjectPersonId },
    select: { userId: true, primaryDepartmentId: true },
  });

  // Шаг 1-3: ищем главу primary-отдела.
  if (subject?.primaryDepartmentId) {
    const dept = await prisma.department.findUnique({
      where: { id: subject.primaryDepartmentId },
      select: {
        headPerson: { select: { id: true, userId: true } },
      },
    });
    const head = dept?.headPerson;
    if (head?.userId && head.userId !== subject.userId) {
      return [head.userId];
    }
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
