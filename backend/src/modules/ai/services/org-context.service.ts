import { Inject, Injectable } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';

import type { TasksOrgContext } from './prompts/tasks-unified';

export type OrgContext = TasksOrgContext & { meetingDateIso: string };

@Injectable()
export class OrgContextService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async load(tenantId: string, meetingStartedAt: Date | null): Promise<OrgContext> {
    const [projects, goals, people] = await Promise.all([
      this.prisma.project.findMany({
        where: { tenantId, deletedAt: null, archivedAt: null },
        select: { identifier: true, name: true },
        take: 40,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.goal.findMany({
        where: {
          tenantId,
          archivedAt: null,
          status: 'active',
        },
        select: { name: true },
        take: 30,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.person.findMany({
        where: { tenantId, deletedAt: null, relationship: 'employee' },
        select: {
          name: true,
          personRoles: {
            where: { validTo: null },
            select: { role: { select: { name: true } } },
            take: 1,
          },
          appointments: {
            where: { validTo: null, status: { not: 'former' } },
            select: { role: { select: { name: true } } },
            take: 1,
          },
        },
        take: 60,
        orderBy: { name: 'asc' },
      }),
    ]);
    const useAppointment = this.cfg.persons.useAppointment;
    return {
      projects,
      goals,
      people: people.map((p) => {
        const role = useAppointment
          ? (p.appointments[0]?.role?.name ?? null)
          : (p.personRoles[0]?.role?.name ?? null);
        return { name: p.name, role };
      }),
      meetingDateIso: meetingStartedAt
        ? meetingStartedAt.toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
    };
  }
}
