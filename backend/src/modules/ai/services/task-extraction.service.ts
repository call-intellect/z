import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';

import { CompanyCapsuleService } from './company-capsule.service';
import { LlmRouterService } from './llm-router.service';
import { OrgContextService } from './org-context.service';
import { applyInputGuards, type DialogTurn } from './prompts/common';
import type { AiParticipantContext } from './prompts/participant-context';
import {
  type TaskExtracted,
  TASKS_STRUCTURED_TASK_TYPE,
  TasksExtractedArraySchema,
  TasksStructuredResponseSchema,
  buildTasksStructuredJsonSchema,
  buildTasksStructuredPrompt,
} from './prompts/tasks-structured';

export interface ExtractTasksInput {
  meetingId: string;
  tenantId: string | null;
  meeting: { id: string; type: string; title: string };
  dialog: DialogTurn[];
  jobId?: string | null;
  userId?: string;
  minConfidence?: number;
  participants?: readonly AiParticipantContext[];
}

@Injectable()
export class TaskExtractionService {
  private readonly logger = new Logger(TaskExtractionService.name);
  private static readonly MAX_RETRIES = 3;
  private static readonly DEFAULT_MIN_CONFIDENCE = 0.5;

  constructor(
    @Inject(LlmRouterService) private readonly router: LlmRouterService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    @Optional()
    @Inject(CompanyCapsuleService)
    private readonly capsule?: CompanyCapsuleService,
    @Optional()
    @Inject(OrgContextService)
    private readonly orgContext?: OrgContextService,
  ) {}

  async extractTasks(input: ExtractTasksInput): Promise<TaskExtracted[]> {
    const participants = input.participants ?? [];
    const companyAbout = this.capsule
      ? await this.capsule.load(input.tenantId, 'tasks')
      : '';
    const orgContext = input.tenantId
      ? await this.orgContext?.load(input.tenantId, null)
      : undefined;
    const prompt = buildTasksStructuredPrompt({
      meeting: input.meeting,
      dialog: input.dialog,
      ...(participants.length > 0 ? { participants } : {}),
      ...(companyAbout ? { companyAbout } : {}),
      ...(orgContext ? { orgContext } : {}),
      ...(orgContext?.meetingDateIso
        ? { meetingDateIso: orgContext.meetingDateIso }
        : {}),
    });
    const responseSchema = buildTasksStructuredJsonSchema(
      participants.length > 0 ? participants : null,
    );
    const minConfidence = input.minConfidence ?? TaskExtractionService.DEFAULT_MIN_CONFIDENCE;
    const guarded = applyInputGuards(prompt.system, prompt.user, {
      injection: true,
      asr: true,
    });

    let lastError: unknown = null;
    for (let attempt = 0; attempt < TaskExtractionService.MAX_RETRIES; attempt++) {
      const userMessage =
        attempt === 0
          ? guarded.user
          : `${guarded.user}\n\nПопытка ${attempt + 1}: предыдущий ответ не был валидным JSON. Верни ТОЛЬКО JSON-объект {"tasks":[...]} без markdown.`;
      const result = await this.router.call({
        taskType: TASKS_STRUCTURED_TASK_TYPE,
        systemPrompt: guarded.system,
        userMessage,
        tenantId: input.tenantId,
        meetingId: input.meetingId,
        ...(input.userId !== undefined ? { userId: input.userId } : {}),
        ...(input.jobId !== undefined && input.jobId !== null ? { jobId: input.jobId } : {}),
        responseFormat: {
          type: 'json_schema',
          name: 'tasks_structured_response',
          strict: true,
          schema: responseSchema,
        },
        sourceRef: { type: 'meeting', id: input.meetingId },
      });
      const parsed = parseJsonTasks(result.text);
      if (!parsed.success) {
        lastError = parsed.error;
        this.metrics?.incPromptInvalidResponse({
          taskType: TASKS_STRUCTURED_TASK_TYPE,
          model: result.modelUsed,
          reason: 'json_parse',
        });
        this.logger.warn(
          { meetingId: input.meetingId, attempt, modelUsed: result.modelUsed },
          'extractTasks: invalid JSON, ретрай',
        );
        continue;
      }
      const wrappedResult = TasksStructuredResponseSchema.safeParse(parsed.data);
      const validated = wrappedResult.success
        ? { success: true as const, data: wrappedResult.data.tasks }
        : TasksExtractedArraySchema.safeParse(parsed.data);
      if (!validated.success) {
        lastError = validated.error;
        this.metrics?.incPromptInvalidResponse({
          taskType: TASKS_STRUCTURED_TASK_TYPE,
          model: result.modelUsed,
          reason: 'schema',
        });
        this.logger.warn(
          { meetingId: input.meetingId, attempt, issues: validated.error.issues.length },
          'extractTasks: schema mismatch, ретрай',
        );
        continue;
      }
      return validated.data.filter((t) => t.confidence >= minConfidence);
    }
    throw new Error(
      `extractTasks: не удалось извлечь после ${TaskExtractionService.MAX_RETRIES} попыток: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
}

function parseJsonTasks(
  raw: string,
): { success: true; data: unknown } | { success: false; error: Error } {
  const stripped = stripCodeFence(raw);
  try {
    return { success: true, data: JSON.parse(stripped) };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  if (fence && typeof fence[1] === 'string') return fence[1];
  return trimmed;
}
