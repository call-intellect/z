import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { IssueTemplateConfig } from '../dto/recurrences/issue-template-config.types';

import type { ChecklistsService } from './checklists.service';
import { IssueMaterializeService } from './issue-materialize.service';
import type { IssuesService } from './issues.service';

describe('IssueMaterializeService', () => {
  let prisma: PrismaService;
  let issues: IssuesService;
  let checklists: ChecklistsService;
  let svc: IssueMaterializeService;

  let issueCreate: ReturnType<typeof vi.fn>;
  let createChecklist: ReturnType<typeof vi.fn>;
  let bulkCreateItems: ReturnType<typeof vi.fn>;
  let labelFindMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    issueCreate = vi.fn().mockResolvedValue({ id: 'issue_1' });
    createChecklist = vi.fn().mockResolvedValue({ id: 'cl_1' });
    bulkCreateItems = vi.fn().mockResolvedValue([]);
    labelFindMany = vi.fn().mockResolvedValue([]);

    prisma = {
      label: { findMany: labelFindMany },
    } as unknown as PrismaService;
    issues = { create: issueCreate } as unknown as IssuesService;
    checklists = {
      createChecklist,
      bulkCreateItems,
    } as unknown as ChecklistsService;

    svc = new IssueMaterializeService(prisma, issues, checklists);
  });

  it('создаёт задачу из config с чек-листом', async () => {
    const config: IssueTemplateConfig = {
      title: 'Еженедельный отчёт',
      priority: 'high',
      checklist: [
        { title: 'Шаги', items: [{ text: 'Собрать цифры' }, { text: 'Свести' }] },
      ],
    };
    const res = await svc.materialize({
      tenantId: 'org_1',
      projectId: 'proj_1',
      config,
      createdById: 'user_1',
    });
    expect(res.issueId).toBe('issue_1');
    expect(issueCreate).toHaveBeenCalledTimes(1);
    const [projectId, dto, tenantId, userId] = issueCreate.mock.calls[0]!;
    expect(projectId).toBe('proj_1');
    expect(tenantId).toBe('org_1');
    expect(userId).toBe('user_1');
    expect(dto.title).toBe('Еженедельный отчёт');
    expect(dto.priority).toBe('high');
    expect(dto.skipDedup).toBe(true);
    expect(createChecklist).toHaveBeenCalledTimes(1);
    expect(bulkCreateItems).toHaveBeenCalledWith(
      'cl_1',
      { checklistId: 'cl_1', lines: ['Собрать цифры', 'Свести'] },
      'org_1',
    );
  });

  it('пустой чек-лист — задача без чек-листов', async () => {
    const config: IssueTemplateConfig = { title: 'Без чек-листа' };
    await svc.materialize({
      tenantId: 'org_1',
      projectId: 'proj_1',
      config,
      createdById: 'user_1',
    });
    expect(createChecklist).not.toHaveBeenCalled();
  });
});
