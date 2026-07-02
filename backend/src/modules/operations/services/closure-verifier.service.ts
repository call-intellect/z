import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { tryParseJson } from '../../ai/services/json-extract.util';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import { signalTypeLabel } from '../../knowledge-core/prompts/signal-type-label';
import {
  TASK_CLOSURE_VERIFY_JSON_SCHEMA,
  TASK_CLOSURE_VERIFY_SCHEMA_NAME,
  TASK_CLOSURE_VERIFY_SYSTEM_PROMPT,
  TASK_CLOSURE_VERIFY_USER_TEMPLATE,
  TaskClosureVerifyResponseSchema,
} from '../prompts/task-closure-verify.prompt';

export interface ClosureVerdict {
  done: boolean;
  confidence: number;
  rationale: string;
  positiveSignals: string[];
  negativeSignals: string[];
}

@Injectable()
export class ClosureVerifierService {
  private readonly logger = new Logger(ClosureVerifierService.name);
  private static readonly LLM_RETRIES = 2;

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly config: TypedConfigService | null = null,
  ) {}

  async verify(args: {
    tenantId: string;
    taskTitle: string;
    signalType: string;
    quote: string;
  }): Promise<ClosureVerdict | null> {
    const userMessage = TASK_CLOSURE_VERIFY_USER_TEMPLATE({
      task: { title: args.taskTitle },
      signalLabel: signalTypeLabel(args.signalType),
      quote: args.quote,
    });

    const guardOn = this.isPromptInjectionGuardEnabled();
    const systemPrompt = guardOn
      ? withInjectionGuard(TASK_CLOSURE_VERIFY_SYSTEM_PROMPT)
      : TASK_CLOSURE_VERIFY_SYSTEM_PROMPT;
    const guardedUser = guardOn ? wrapUserData(userMessage) : userMessage;

    for (let attempt = 0; attempt < ClosureVerifierService.LLM_RETRIES; attempt++) {
      try {
        const out = await this.llm.call({
          taskType: 'task-closure-verify',
          tenantId: args.tenantId,
          systemPrompt,
          userMessage: guardedUser,
          responseFormat: {
            type: 'json_schema',
            name: TASK_CLOSURE_VERIFY_SCHEMA_NAME,
            strict: true,
            schema: TASK_CLOSURE_VERIFY_JSON_SCHEMA,
          },
          dataClass: 'internal',
          validate: (text) => this.parse(text) !== null,
        });
        const parsed = this.parse(out.text);
        if (parsed) return parsed;
      } catch (err) {
        this.logger.warn(
          {
            tenantId: args.tenantId,
            attempt,
            err: err instanceof Error ? err.message : String(err),
          },
          'closure-verify: LLM-верификатор упал — повтор',
        );
      }
    }
    return null;
  }

  private parse(text: string): ClosureVerdict | null {
    const raw = tryParseJson(text);
    const parsed = TaskClosureVerifyResponseSchema.safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data;
  }

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.config?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }
}
