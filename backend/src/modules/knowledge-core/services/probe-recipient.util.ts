import type { PrismaService } from '../../../common/prisma/prisma.service';

function pushUniq(list: string[], userId: string | null | undefined): void {
  if (userId && !list.includes(userId)) list.push(userId);
}

export async function resolveProbeRecipients(args: {
  prisma: PrismaService;
  tenantId: string;
  subjectPersonId: string;
  subjectAddressingEnabled?: boolean;
}): Promise<string[]> {
  const { prisma, tenantId, subjectPersonId, subjectAddressingEnabled } = args;

  const subject = await prisma.person.findUnique({
    where: { id: subjectPersonId },
    select: { userId: true, primaryDepartmentId: true },
  });

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

  if (subjectAddressingEnabled === true) {
    const recipients: string[] = [];
    pushUniq(recipients, subject?.userId ?? null);
    pushUniq(recipients, headUserId);
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

  if (headUserId) {
    return [headUserId];
  }

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
