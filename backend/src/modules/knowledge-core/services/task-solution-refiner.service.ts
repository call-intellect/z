import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { type LlmCallResult, LlmRouterService } from '../../ai/services/llm-router.service';
import { applyInputGuards } from '../../ai/services/prompts/common';
import {
  TASK_SOLUTION_EXTRACT_MAX_TOKENS,
  TASK_SOLUTION_EXTRACT_TASK_TYPE,
  TASK_SOLUTION_EXTRACT_TOOL,
  TASK_SOLUTION_EXTRACT_TOOL_NAME,
  type TaskSolutionExtractBlock,
  TaskSolutionExtractOutputSchema,
  buildTaskSolutionExtractSystemPrompt,
  buildTaskSolutionExtractUserMessage,
} from '../prompts/task-solution-extract.prompt';

export interface TaskSolutionRefineResult {
  ok: boolean;
  hasConcreteMethod: boolean;
  solverNames: string[];
}

const FALLBACK: TaskSolutionRefineResult = {
  ok: false,
  hasConcreteMethod: true,
  solverNames: [],
};

@Injectable()
export class TaskSolutionRefinerService {
  private readonly logger = new Logger(TaskSolutionRefinerService.name);

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

  private isInjectionGuardEnabled(): boolean {
    try {
      return this.cfg?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  async extract(input: {
    taskTitle: string;
    assigneeName?: string | null;
    blocks: TaskSolutionExtractBlock[];
    tenantId: string | null;
    dataClass?: 'public' | 'internal' | 'sensitive' | 'private';
    sourceRef?: { type: string; id: string } | null;
    nowIso?: string | null;
  }): Promise<TaskSolutionRefineResult> {
    if (input.blocks.length === 0) return FALLBACK;

    const rawSystem = buildTaskSolutionExtractSystemPrompt();
    const rawUser = buildTaskSolutionExtractUserMessage({
      taskTitle: input.taskTitle,
      assigneeName: input.assigneeName ?? null,
      blocks: input.blocks,
    });
    const { system, user } = applyInputGuards(rawSystem, rawUser, {
      injection: true,
      enabled: this.isInjectionGuardEnabled(),
      meetingDateIso: input.nowIso ?? null,
    });

    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: TASK_SOLUTION_EXTRACT_TASK_TYPE,
        systemPrompt: system,
        userMessage: user,
        tenantId: input.tenantId,
        maxTokens: TASK_SOLUTION_EXTRACT_MAX_TOKENS,
        tools: [TASK_SOLUTION_EXTRACT_TOOL],
        sourceRef: input.sourceRef ?? null,
        dataClass: input.dataClass ?? 'internal',
      });
    } catch (err) {
      this.logger.warn(
        { taskTitle: input.taskTitle, err: err instanceof Error ? err.message : String(err) },
        'task-solution-refiner: LLM упал — fallback (не гейтим, subjects=owner)',
      );
      return FALLBACK;
    }

    try {
      const rawInput = this.pickToolInput(result.toolCalls, result.text);
      const parsed = TaskSolutionExtractOutputSchema.safeParse(rawInput);
      if (!parsed.success) return FALLBACK;
      const solverNames = [
        ...new Set(parsed.data.solverNames.map((s) => s.trim()).filter((s) => s.length > 0)),
      ];
      return { ok: true, hasConcreteMethod: parsed.data.hasConcreteMethod, solverNames };
    } catch (err) {
      this.logger.warn(
        { taskTitle: input.taskTitle, err: err instanceof Error ? err.message : String(err) },
        'task-solution-refiner: парсинг упал — fallback',
      );
      return FALLBACK;
    }
  }

  private pickToolInput(
    toolCalls: Array<{ name: string; input: unknown }> | undefined,
    fallbackText: string,
  ): unknown {
    if (toolCalls && toolCalls.length > 0) {
      const direct = toolCalls.find((tc) => tc.name === TASK_SOLUTION_EXTRACT_TOOL_NAME);
      const raw = (direct ?? toolCalls[0])?.input ?? null;
      if (raw !== null) return typeof raw === 'string' ? JSON.parse(raw) : raw;
    }
    if (fallbackText) {
      const start = fallbackText.indexOf('{');
      const end = fallbackText.lastIndexOf('}');
      if (start !== -1 && end > start) return JSON.parse(fallbackText.slice(start, end + 1));
    }
    return null;
  }
}
