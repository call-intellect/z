import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { MeetingActionItemsService } from '../meetings/meeting-action-items.service';

export type SearchTypeKey =
  | 'cards'
  | 'meetings'
  | 'tasks'
  | 'role'
  | 'department'
  | 'person'
  | 'document'
  | 'role-profile'
  | 'process'
  | 'regulation'
  | 'policy'
  | 'metric'
  | 'decision';

export interface SearchResultCardItem {
  id: string;
  name: string;
  kind: string;
  lastMeetingAt: string | null;
  meetingCount: number;
}

export interface SearchResultMeetingItem {
  id: string;
  title: string;
  type: string;
  cardId: string | null;
  createdAt: string;
}

export interface SearchResultTaskItem {
  id: string;
  title: string;
  status: string;
  meetingId: string | null;
}

export interface UnifiedSearchResult {
  type: SearchTypeKey;
  id: string;
  title: string;
  snippet: string;
  relevance: number;
  url: string;
  context?: Record<string, unknown>;
}

export interface SearchResult {
  cards: SearchResultCardItem[];
  meetings: SearchResultMeetingItem[];
  tasks: SearchResultTaskItem[];
  results: UnifiedSearchResult[];
  total: number;
}

@Injectable()
export class SearchService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MeetingActionItemsService)
    private readonly actionItems: MeetingActionItemsService,
  ) {}

  async search(args: {
    userId: string;
    tenantId?: string | null;
    query: string;
    types: SearchTypeKey[];
    limit: number;
  }): Promise<SearchResult> {
    const limit = Math.min(50, Math.max(1, args.limit));
    const q = args.query.trim();
    if (!q) {
      return { cards: [], meetings: [], tasks: [], results: [], total: 0 };
    }

    const wantsCards = args.types.includes('cards');
    const wantsMeetings = args.types.includes('meetings');
    const wantsTasks = args.types.includes('tasks');

    const tenantId = args.tenantId ?? null;
    const tenantWants = (k: SearchTypeKey) => tenantId && args.types.includes(k);

    const [
      cards,
      meetings,
      tasks,
      roles,
      departments,
      persons,
      documents,
      roleProfiles,
      processes,
      regulations,
      policies,
      metrics,
      decisions,
    ] = await Promise.all([
      wantsCards ? this.searchCards(args.userId, q, limit) : Promise.resolve([]),
      wantsMeetings ? this.searchMeetings(args.userId, q, limit) : Promise.resolve([]),
      wantsTasks ? this.searchTasks(args.userId, tenantId, q, limit) : Promise.resolve([]),
      tenantWants('role') ? this.searchRoles(tenantId!, q, limit) : Promise.resolve([]),
      tenantWants('department') ? this.searchDepartments(tenantId!, q, limit) : Promise.resolve([]),
      tenantWants('person') ? this.searchPersons(tenantId!, q, limit) : Promise.resolve([]),
      tenantWants('document') ? this.searchDocuments(tenantId!, q, limit) : Promise.resolve([]),
      tenantWants('role-profile')
        ? this.searchRoleProfiles(tenantId!, q, limit)
        : Promise.resolve([]),
      tenantWants('process') ? this.searchProcesses(tenantId!, q, limit) : Promise.resolve([]),
      tenantWants('regulation') ? this.searchRegulations(tenantId!, q, limit) : Promise.resolve([]),
      tenantWants('policy') ? this.searchPolicies(tenantId!, q, limit) : Promise.resolve([]),
      tenantWants('metric') ? this.searchMetrics(tenantId!, q, limit) : Promise.resolve([]),
      tenantWants('decision') ? this.searchDecisions(tenantId!, q, limit) : Promise.resolve([]),
    ]);

    const results: UnifiedSearchResult[] = [
      ...cards.map((c) => ({
        type: 'cards' as const,
        id: c.id,
        title: c.name,
        snippet: `Карточка · встреч: ${c.meetingCount}`,
        relevance: 0.8,
        url: `/cards/${c.id}`,
      })),
      ...meetings.map((m) => ({
        type: 'meetings' as const,
        id: m.id,
        title: m.title,
        snippet: `Встреча · тип: ${m.type}`,
        relevance: 0.8,
        url: `/m/${m.id}`,
      })),
      ...tasks.map((t) => ({
        type: 'tasks' as const,
        id: t.id,
        title: t.title,
        snippet: `Задача · статус: ${t.status}`,
        relevance: 0.7,
        url: `/m/${t.meetingId}#tasks`,
      })),
      ...roles,
      ...departments,
      ...persons,
      ...documents,
      ...roleProfiles,
      ...processes,
      ...regulations,
      ...policies,
      ...metrics,
      ...decisions,
    ];

    return {
      cards,
      meetings,
      tasks,
      results,
      total: results.length,
    };
  }

  private async searchCards(
    userId: string,
    q: string,
    limit: number,
  ): Promise<SearchResultCardItem[]> {
    const rows = await this.prisma.card.findMany({
      where: {
        ownerId: userId,
        deletedAt: null,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { contactName: { contains: q, mode: 'insensitive' } },
          { contactEmail: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ pinned: 'desc' }, { lastMeetingAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        name: true,
        kind: true,
        lastMeetingAt: true,
        meetingCount: true,
      },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      lastMeetingAt: c.lastMeetingAt?.toISOString() ?? null,
      meetingCount: c.meetingCount,
    }));
  }

  private async searchMeetings(
    userId: string,
    q: string,
    limit: number,
  ): Promise<SearchResultMeetingItem[]> {
    const rows = await this.prisma.meeting.findMany({
      where: {
        ownerId: userId,
        deletedAt: null,
        title: { contains: q, mode: 'insensitive' },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        type: true,
        cardId: true,
        createdAt: true,
      },
    });
    return rows.map((m) => ({
      id: m.id,
      title: m.title,
      type: m.type,
      cardId: m.cardId,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  private async searchTasks(
    userId: string,
    tenantId: string | null,
    q: string,
    limit: number,
  ): Promise<SearchResultTaskItem[]> {
    const rows = await this.actionItems.searchTitlesForUser({
      tenantId: tenantId ?? '',
      userId,
      query: q,
      limit,
    });
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      meetingId: t.meetingId,
    }));
  }

  private async searchRoles(
    tenantId: string,
    q: string,
    limit: number,
  ): Promise<UnifiedSearchResult[]> {
    const rows = await this.prisma.role.findMany({
      where: {
        tenantId,
        deletedAt: null,
        name: { contains: q, mode: 'insensitive' },
      },
      orderBy: { name: 'asc' },
      take: limit,
      select: {
        id: true,
        name: true,
        department: { select: { id: true, name: true } },
      },
    });
    return rows.map((r) => ({
      type: 'role',
      id: r.id,
      title: r.name,
      snippet: r.department ? `Отдел: ${r.department.name}` : 'Должность',
      relevance: 0.85,
      url: `/structure/roles/${r.id}`,
      context: {
        departmentId: r.department?.id ?? null,
        departmentName: r.department?.name ?? null,
      },
    }));
  }

  private async searchDepartments(
    tenantId: string,
    q: string,
    limit: number,
  ): Promise<UnifiedSearchResult[]> {
    const rows = await this.prisma.department.findMany({
      where: {
        tenantId,
        deletedAt: null,
        name: { contains: q, mode: 'insensitive' },
      },
      orderBy: { name: 'asc' },
      take: limit,
      select: { id: true, name: true },
    });
    return rows.map((d) => ({
      type: 'department',
      id: d.id,
      title: d.name,
      snippet: 'Отдел',
      relevance: 0.85,
      url: `/structure/departments/${d.id}`,
    }));
  }

  private async searchPersons(
    tenantId: string,
    q: string,
    limit: number,
  ): Promise<UnifiedSearchResult[]> {
    const rows = await this.prisma.person.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { name: 'asc' },
      take: limit,
      select: { id: true, name: true, email: true },
    });
    return rows.map((p) => ({
      type: 'person',
      id: p.id,
      title: p.name,
      snippet: p.email,
      relevance: 0.85,
      url: `/structure/persons/${p.id}`,
    }));
  }

  private async searchDocuments(
    tenantId: string,
    q: string,
    limit: number,
  ): Promise<UnifiedSearchResult[]> {
    const rows = await this.prisma.document.findMany({
      where: {
        tenantId,
        deletedAt: null,
        name: { contains: q, mode: 'insensitive' },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true, name: true, kind: true, status: true },
    });
    return rows.map((d) => ({
      type: 'document',
      id: d.id,
      title: d.name,
      snippet: `Документ · ${d.kind} · ${d.status}`,
      relevance: 0.75,
      url: `/documents/${d.id}`,
    }));
  }

  private async searchRoleProfiles(
    tenantId: string,
    q: string,
    limit: number,
  ): Promise<UnifiedSearchResult[]> {
    const rows = await this.prisma.roleProfile.findMany({
      where: {
        tenantId,
        role: {
          deletedAt: null,
          name: { contains: q, mode: 'insensitive' },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: { role: { select: { id: true, name: true } } },
    });
    return rows.map((rp) => ({
      type: 'role-profile',
      id: rp.id,
      title: `Карта должности «${rp.role.name}»`,
      snippet: `Статус: ${rp.status} · версия ${rp.buildVersion}`,
      relevance: 0.7,
      url: `/role-profiles/${rp.roleId}`,
      context: { roleId: rp.roleId, status: rp.status },
    }));
  }

  private async searchProcesses(
    tenantId: string,
    q: string,
    limit: number,
  ): Promise<UnifiedSearchResult[]> {
    const rows = await this.prisma.process.findMany({
      where: {
        tenantId,
        name: { contains: q, mode: 'insensitive' },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true, name: true, status: true },
    });
    return rows.map((p) => ({
      type: 'process',
      id: p.id,
      title: p.name,
      snippet: `Процесс · ${p.status}`,
      relevance: 0.7,
      url: `/processes/${p.id}`,
    }));
  }

  private async searchRegulations(
    tenantId: string,
    q: string,
    limit: number,
  ): Promise<UnifiedSearchResult[]> {
    const rows = await this.prisma.regulation.findMany({
      where: {
        tenantId,
        name: { contains: q, mode: 'insensitive' },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true, name: true, category: true, status: true },
    });
    return rows.map((r) => ({
      type: 'regulation',
      id: r.id,
      title: r.name,
      snippet: `Регламент · ${r.category} · ${r.status}`,
      relevance: 0.7,
      url: `/regulations/${r.id}`,
    }));
  }

  private async searchPolicies(
    tenantId: string,
    q: string,
    limit: number,
  ): Promise<UnifiedSearchResult[]> {
    const rows = await this.prisma.policy.findMany({
      where: {
        tenantId,
        name: { contains: q, mode: 'insensitive' },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true, name: true, severity: true, status: true },
    });
    return rows.map((p) => ({
      type: 'policy',
      id: p.id,
      title: p.name,
      snippet: `Политика · ${p.severity} · ${p.status}`,
      relevance: 0.7,
      url: `/policies/${p.id}`,
    }));
  }

  private async searchMetrics(
    tenantId: string,
    q: string,
    limit: number,
  ): Promise<UnifiedSearchResult[]> {
    const rows = await this.prisma.metric.findMany({
      where: {
        tenantId,
        name: { contains: q, mode: 'insensitive' },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true, name: true, unit: true },
    });
    return rows.map((m) => ({
      type: 'metric',
      id: m.id,
      title: m.name,
      snippet: `Метрика · ${m.unit}`,
      relevance: 0.65,
      url: `/metrics/${m.id}`,
    }));
  }

  private async searchDecisions(
    tenantId: string,
    q: string,
    limit: number,
  ): Promise<UnifiedSearchResult[]> {
    const rows = await this.prisma.decision.findMany({
      where: {
        tenantId,
        OR: [
          { statement: { contains: q, mode: 'insensitive' } },
          { text: { contains: q, mode: 'insensitive' } },
          { rationale: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        text: true,
        statement: true,
        status: true,
        decidedAt: true,
        createdAt: true,
      },
    });
    return rows.map((d) => {
      const title = (d.statement ?? d.text ?? '').slice(0, 120);
      const dt = (d.decidedAt ?? d.createdAt).toISOString().slice(0, 10);
      return {
        type: 'decision' as const,
        id: d.id,
        title,
        snippet: `Решение · ${d.status} · ${dt}`,
        relevance: 0.7,
        url: `/decisions/${d.id}`,
      };
    });
  }
}
