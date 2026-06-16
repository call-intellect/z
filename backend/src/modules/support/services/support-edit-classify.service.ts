import { Inject, Injectable, Logger } from '@nestjs/common';

import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  SUPPORT_EDIT_CLASSIFY_JSON_SCHEMA,
  SUPPORT_EDIT_CLASSIFY_SYSTEM_PROMPT,
  buildSupportEditClassifyUserPrompt,
} from '../prompts/support-edit-classify.prompt';

export type SupportEditType = 'factual' | 'tone' | 'policy' | 'empty';

@Injectable()
export class SupportEditClassifyService {
  private readonly logger = new Logger(SupportEditClassifyService.name);

  constructor(@Inject(LlmRouterService) private readonly llm: LlmRouterService) {}

  async classify(args: {
    tenantId: string;
    userId?: string;
    draft: string;
    final: string;
  }): Promise<SupportEditType> {
    try {
      const result = await this.llm.call({
        taskType: 'support-edit-classify',
        tenantId: args.tenantId,
        userId: args.userId,
        systemPrompt: SUPPORT_EDIT_CLASSIFY_SYSTEM_PROMPT,
        userMessage: buildSupportEditClassifyUserPrompt({
          draft: args.draft,
          final: args.final,
        }),
        maxTokens: 200,
        responseFormat: {
          type: 'json_schema',
          name: 'support_edit_classify_response',
          strict: true,
          schema: SUPPORT_EDIT_CLASSIFY_JSON_SCHEMA,
        },
      });

      const editType = parseEditType(result.text);
      if (editType === null) {
        this.logger.warn(
          { tenantId: args.tenantId, model: result.modelUsed },
          'support-edit-classify: непарсимый JSON — fallback factual',
        );
        return 'factual';
      }
      return editType;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'support-edit-classify: LLM упал — fallback factual (консервативно)',
      );
      return 'factual';
    }
  }
}

function parseEditType(text: string): SupportEditType | null {
  try {
    const cleaned = stripCodeFence(text).trim();
    const parsed = JSON.parse(cleaned) as { editType?: unknown };
    const raw = parsed.editType;
    if (raw === 'factual' || raw === 'tone' || raw === 'policy' || raw === 'empty') {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}

function stripCodeFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
}
