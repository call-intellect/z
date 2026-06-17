import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Entity, IdeaBlock, ThemeBranch } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { LlmRouterService, maxDataClass } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import {
  THEME_BRANCH_VALUES as THEME_BRANCH_VALUES_FROM_PROMPT,
  THEME_CLASSIFY_JSON_SCHEMA,
  THEME_CLASSIFY_SYSTEM_PROMPT,
  ThemeClassifyResponseSchema,
} from '../prompts/theme-classify.prompt';

export const THEME_BRANCH_VALUES = THEME_BRANCH_VALUES_FROM_PROMPT;

const SYSTEM_PROMPT = THEME_CLASSIFY_SYSTEM_PROMPT;

export interface ThemeClassificationInput {
  tenantId: string;
  blocks: Pick<
    IdeaBlock,
    'id' | 'name' | 'criticalQuestion' | 'trustedAnswer' | 'signalType' | 'tags' | 'dataClass'
  >[];
  entities: Pick<Entity, 'id' | 'canonicalName' | 'type'>[];
}

export interface ThemeClassificationResult {
  name: string;
  description: string;
  branch: ThemeBranch | null;
  tags: string[];
  weight: number;
  confidence: number;
}

@Injectable()
export class ThemeClassificationService {
  private readonly logger = new Logger(ThemeClassificationService.name);

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  async classifyTheme(input: ThemeClassificationInput): Promise<ThemeClassificationResult | null> {
    const { tenantId, blocks, entities } = input;
    if (blocks.length === 0) return null;

    const userPayload = {
      blocks: blocks.map((b) => ({
        id: b.id,
        name: b.name,
        criticalQuestion: b.criticalQuestion,
        trustedAnswer: b.trustedAnswer,
        signalType: b.signalType,
        tags: b.tags,
      })),
      entities: entities.map((e) => ({
        id: e.id,
        type: e.type,
        canonicalName: e.canonicalName,
      })),
    };
    const userMessage = `Кластер из ${blocks.length} блоков:\n\n${JSON.stringify(userPayload, null, 2)}`;

    const guardOn = this.isPromptInjectionGuardEnabled();
    const out = await this.llm.call({
      taskType: 'theme-classify',
      tenantId,
      systemPrompt: guardOn ? withInjectionGuard(SYSTEM_PROMPT) : SYSTEM_PROMPT,
      userMessage: guardOn ? wrapUserData(userMessage) : userMessage,
      responseFormat: {
        type: 'json_schema',
        name: 'ThemeClassification',
        strict: true,
        schema: THEME_CLASSIFY_JSON_SCHEMA,
      },
      sourceRef: { type: 'theme-classify', id: tenantId },
      dataClass: maxDataClass(blocks.map((b) => b.dataClass)),
    });

    return this.parse(out.text);
  }

  private parse(text: string): ThemeClassificationResult | null {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      this.logger.warn('theme-classify: ответ LLM не валидный JSON');
      return null;
    }
    const parsed = ThemeClassifyResponseSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        { issues: parsed.error.issues.map((i) => i.message) },
        'theme-classify: ответ LLM не прошёл schema',
      );
      return null;
    }
    const branch: ThemeBranch | null =
      parsed.data.branch === 'none' ? null : (parsed.data.branch as ThemeBranch);
    return {
      name: parsed.data.name,
      description: parsed.data.description,
      branch,
      tags: parsed.data.tags,
      weight: parsed.data.weight,
      confidence: parsed.data.confidence,
    };
  }
}
