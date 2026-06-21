import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { CreateIssueDto } from '../dto/issues/create-issue.dto';
import type { IssueTemplateConfig } from '../dto/recurrences/issue-template-config.types';

import { ChecklistsService } from './checklists.service';
import { IssuesService } from './issues.service';

@Injectable()
export class IssueMaterializeService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(ChecklistsService) private readonly checklists: ChecklistsService,
  ) {}

  async materialize(args: {
    tenantId: string;
    projectId: string;
    config: IssueTemplateConfig;
    createdById: string;
  }): Promise<{ issueId: string }> {
    const { tenantId, projectId, config, createdById } = args;

    const labelIds = await this.validLabelIds(tenantId, config.labelIds ?? []);
    const assigneeUserIds = config.assigneeUserIds ?? [];

    const dto: CreateIssueDto = {
      title: config.title,
      description: config.description ?? null,
      priority: config.priority ?? 'none',
      estimatePoints: config.estimatePoints ?? null,
      sortOrder: 0,
      assigneeUserIds,
      labelIds,
      externalSource: 'recurrence',
      skipDedup: true,
    };

    const issue = await this.issues.create(projectId, dto, tenantId, createdById);

    for (const checklist of config.checklist ?? []) {
      if (checklist.items.length === 0) continue;
      const created = await this.checklists.createChecklist(
        issue.id,
        { title: checklist.title ?? 'Чек-лист' },
        tenantId,
      );
      await this.checklists.bulkCreateItems(
        created.id,
        {
          checklistId: created.id,
          lines: checklist.items.map((i) => i.text.slice(0, 500)),
        },
        tenantId,
      );
    }

    return { issueId: issue.id };
  }

  private async validLabelIds(
    tenantId: string,
    labelIds: string[],
  ): Promise<string[]> {
    if (labelIds.length === 0) return [];
    const rows = await this.prisma.label.findMany({
      where: { id: { in: labelIds }, tenantId },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
