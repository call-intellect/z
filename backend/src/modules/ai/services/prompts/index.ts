import type { MeetingType } from '@prisma/client';
import type { z } from 'zod';

import type { LlmTool } from '../llm.types';

import type { PromptInput, PromptOutput } from './common';
import * as customDev from './type-custdev';
import * as customerSuccess from './type-customer_success';
import * as interview from './type-interview';
import * as partner from './type-partner';
import * as planFact from './type-plan_fact';
import * as project from './type-project';
import * as sales from './type-sales';
import * as standup from './type-standup';
import * as team from './type-team';

export type {
  DialogTurn,
  PromptInput,
  PromptOutput,
} from './common';

/**
 * Дескриптор промпта по типу встречи. Возвращается из `getPromptForType`.
 *
 *   buildPrompt(input)  — собирает {system,user} с диалогом.
 *   tool                — Anthropic tool с JSON-Schema для extract.
 *   toolName            — для парсинга `toolCalls[].name`.
 *   schema              — Zod-схема для валидации `toolCalls[0].input`.
 */
export interface PromptDescriptor {
  buildPrompt: (input: PromptInput) => PromptOutput;
  tool: LlmTool;
  toolName: string;
  schema: z.ZodType<unknown>;
}

const REGISTRY: Record<MeetingType, PromptDescriptor> = {
  team: { buildPrompt: team.buildPrompt, tool: team.TOOL, toolName: team.TOOL_NAME, schema: team.SCHEMA },
  standup: {
    buildPrompt: standup.buildPrompt,
    tool: standup.TOOL,
    toolName: standup.TOOL_NAME,
    schema: standup.SCHEMA,
  },
  plan_fact: {
    buildPrompt: planFact.buildPrompt,
    tool: planFact.TOOL,
    toolName: planFact.TOOL_NAME,
    schema: planFact.SCHEMA,
  },
  project: {
    buildPrompt: project.buildPrompt,
    tool: project.TOOL,
    toolName: project.TOOL_NAME,
    schema: project.SCHEMA,
  },
  sales: {
    buildPrompt: sales.buildPrompt,
    tool: sales.TOOL,
    toolName: sales.TOOL_NAME,
    schema: sales.SCHEMA,
  },
  custdev: {
    buildPrompt: customDev.buildPrompt,
    tool: customDev.TOOL,
    toolName: customDev.TOOL_NAME,
    schema: customDev.SCHEMA,
  },
  partner: {
    buildPrompt: partner.buildPrompt,
    tool: partner.TOOL,
    toolName: partner.TOOL_NAME,
    schema: partner.SCHEMA,
  },
  interview: {
    buildPrompt: interview.buildPrompt,
    tool: interview.TOOL,
    toolName: interview.TOOL_NAME,
    schema: interview.SCHEMA,
  },
  customer_success: {
    buildPrompt: customerSuccess.buildPrompt,
    tool: customerSuccess.TOOL,
    toolName: customerSuccess.TOOL_NAME,
    schema: customerSuccess.SCHEMA,
  },
};

export function getPromptForType(type: MeetingType): PromptDescriptor {
  const descriptor = REGISTRY[type];
  if (!descriptor) {
    // noUncheckedIndexedAccess делает это полезной защитой.
    throw new Error(`Нет промпта для типа встречи: ${type}`);
  }
  return descriptor;
}

/**
 * Тип имеет потребность в follow-up email?
 */
export function typeNeedsFollowUp(type: MeetingType): boolean {
  return type === 'sales' || type === 'customer_success';
}

/**
 * Тип имеет потребность в извлечении задач?
 */
export function typeNeedsTasks(type: MeetingType): boolean {
  return (
    type === 'team' ||
    type === 'standup' ||
    type === 'plan_fact' ||
    type === 'project'
  );
}
