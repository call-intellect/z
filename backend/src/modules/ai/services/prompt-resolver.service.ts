import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type {
  MeetingType,
  PromptTemplate,
  PromptTemplateSection,
  PromptTemplateVersion,
} from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { PromptExperimentsService } from '../../admin/prompt-templates/prompt-experiments.service';

import { codeFallbackForMeeting } from './code-fallback.adapter';
import type {
  PromptResolverTaskType,
  ResolveForMeetingParams,
  ResolvedPrompt,
  ResolvedPromptSection,
} from './prompt-resolver.types';

@Injectable()
export class PromptResolverService {
  private readonly logger = new Logger(PromptResolverService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    @Optional()
    @Inject(PromptExperimentsService)
    private readonly experiments?: PromptExperimentsService,
  ) {}

  async resolveForMeeting(params: ResolveForMeetingParams): Promise<ResolvedPrompt> {
    const { tenantId, meetingId, meetingType, taskType } = params;

    if (this.experiments) {
      try {
        const allocation = await this.experiments.resolveAllocation({
          meetingId,
          orgId: tenantId,
          taskType,
          meetingType,
        });
        if (allocation) {
          const expPrompt = await this.loadExperimentPrompt(allocation.versionId);
          if (expPrompt) {
            const source: 'db_org' | 'db_system' =
              expPrompt.template.scope === 'org' ? 'db_org' : 'db_system';
            const result = this.toResolvedPrompt(expPrompt.template, expPrompt.version, source);
            result.experimentGroup = allocation.group;
            this.metrics?.incPromptResolver({ source });
            return result;
          }
        }
      } catch (err) {
        this.logger.warn(
          {
            tenantId,
            meetingId,
            err: err instanceof Error ? err.message : String(err),
          },
          'prompt-resolver: experiment resolve failed → обычный путь',
        );
      }
    }

    try {
      const fromDb = await this.tryResolveFromDb(tenantId, meetingType, taskType);
      if (fromDb) {
        this.metrics?.incPromptResolver({ source: fromDb.source });
        return fromDb;
      }
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          taskType,
          meetingType,
          err: err instanceof Error ? err.message : String(err),
        },
        'prompt-resolver: db error → code-fallback',
      );
      this.metrics?.incPromptResolverFallback({ reason: 'db_error' });
      const out = codeFallbackForMeeting(meetingType as MeetingType, taskType);
      this.metrics?.incPromptResolver({ source: 'code_fallback' });
      return out;
    }

    this.metrics?.incPromptResolverFallback({ reason: 'db_empty' });
    const fallback = codeFallbackForMeeting(meetingType as MeetingType, taskType);
    this.metrics?.incPromptResolver({ source: 'code_fallback' });
    return fallback;
  }

  private async tryResolveFromDb(
    tenantId: string,
    meetingType: string,
    taskType: PromptResolverTaskType,
  ): Promise<ResolvedPrompt | null> {
    const orgTemplate = await this.findActiveTemplate({
      orgId: tenantId,
      meetingType,
      taskType,
    });
    if (orgTemplate?.activeVersion) {
      return this.toResolvedPrompt(orgTemplate, orgTemplate.activeVersion, 'db_org');
    }

    const systemTemplate = await this.findActiveTemplate({
      orgId: null,
      meetingType,
      taskType,
    });
    if (systemTemplate?.activeVersion) {
      return this.toResolvedPrompt(systemTemplate, systemTemplate.activeVersion, 'db_system');
    }

    return null;
  }

  private async findActiveTemplate(args: {
    orgId: string | null;
    meetingType: string;
    taskType: PromptResolverTaskType;
  }): Promise<(PromptTemplate & { activeVersion: VersionWithSections | null }) | null> {
    const baseWhere = {
      orgId: args.orgId,
      taskType: args.taskType,
      status: 'active' as const,
      deletedAt: null,
    };

    const exact = await this.prisma.promptTemplate.findFirst({
      where: { ...baseWhere, meetingType: args.meetingType as MeetingType },
      include: { activeVersion: { include: { sections: { orderBy: { order: 'asc' } } } } },
    });
    if (exact) return exact;

    return this.prisma.promptTemplate.findFirst({
      where: { ...baseWhere, meetingType: null },
      include: { activeVersion: { include: { sections: { orderBy: { order: 'asc' } } } } },
    });
  }

  private async loadExperimentPrompt(versionId: string): Promise<{
    template: PromptTemplate;
    version: VersionWithSections;
  } | null> {
    const version = await this.prisma.promptTemplateVersion.findUnique({
      where: { id: versionId },
      include: {
        sections: { orderBy: { order: 'asc' } },
        template: true,
      },
    });
    if (!version || version.template.deletedAt) return null;
    return {
      template: version.template,
      version: { ...version, sections: version.sections },
    };
  }

  private toResolvedPrompt(
    _template: PromptTemplate,
    version: VersionWithSections,
    source: 'db_org' | 'db_system',
  ): ResolvedPrompt {
    const schema = version.outputSchema as ResolvedPrompt['outputSchema'];
    return {
      source,
      versionId: version.id,
      systemPrompt: version.systemPrompt,
      toolName: version.toolName ?? null,
      sections: version.sections.map(sectionFromDb),
      outputSchema: {
        type: 'object',
        properties: schema?.properties ?? {},
        required: schema?.required,
        additionalProperties: schema?.additionalProperties,
      },
    };
  }
}

type VersionWithSections = PromptTemplateVersion & { sections: PromptTemplateSection[] };

function sectionFromDb(s: PromptTemplateSection): ResolvedPromptSection {
  return {
    key: s.key,
    title: s.title,
    instruction: s.instruction,
    outputType: s.outputType,
    required: s.required,
    maxTokens: s.maxTokens ?? null,
  };
}
