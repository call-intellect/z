import type { Logger } from '@nestjs/common';
import type { DataClass } from '@prisma/client';

import { tryParseJson } from '../../ai/services/json-extract.util';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import {
  TASK_DEDUPE_JSON_SCHEMA,
  TASK_DEDUPE_SCHEMA_NAME,
  TASK_DEDUPE_SYSTEM_PROMPT,
  TASK_DEDUPE_USER_TEMPLATE,
  TaskDedupeResponseSchema,
} from '../prompts/task-dedupe.prompt';

export function normalizeTaskTitle(title: string): string {
  return title.trim().toLowerCase().replace(/ё/gu, 'е');
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function parseVerdict(text: string): 'same' | 'different' | null {
  const raw = tryParseJson(text);
  const parsed = TaskDedupeResponseSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.verdict;
}

export interface JudgeSameTaskSide {
  title: string;
  assigneeRaw?: string | null;
}

export interface JudgeSameTaskArgs {
  llm: LlmRouterService;
  tenantId: string | null;
  a: JudgeSameTaskSide;
  b: JudgeSameTaskSide;
  sourceRef: { type: 'task'; id: string };
  dataClass: DataClass;
  retries?: number;
  logger?: Logger;
  logContext?: Record<string, unknown>;
}

export async function judgeSameTask(args: JudgeSameTaskArgs): Promise<boolean> {
  const retries = args.retries ?? 2;
  const userMessage = TASK_DEDUPE_USER_TEMPLATE({
    a: { title: args.a.title, assignee: args.a.assigneeRaw ?? null },
    b: { title: args.b.title, assignee: args.b.assigneeRaw ?? null },
  });

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const out = await args.llm.call({
        taskType: 'task-dedupe',
        tenantId: args.tenantId,
        systemPrompt: withInjectionGuard(TASK_DEDUPE_SYSTEM_PROMPT),
        userMessage: wrapUserData(userMessage),
        responseFormat: {
          type: 'json_schema',
          name: TASK_DEDUPE_SCHEMA_NAME,
          strict: true,
          schema: TASK_DEDUPE_JSON_SCHEMA,
        },
        sourceRef: args.sourceRef,
        dataClass: args.dataClass,
        validate: (text) => parseVerdict(text) !== null,
      });
      const verdict = parseVerdict(out.text);
      if (verdict !== null) return verdict === 'same';
      args.logger?.warn(
        { ...args.logContext, attempt },
        'task-dedupe: невалидный JSON арбитра — повтор',
      );
    } catch (err) {
      args.logger?.warn(
        {
          ...args.logContext,
          attempt,
          err: err instanceof Error ? err.message : String(err),
        },
        'task-dedupe: LLM-арбитр упал — повтор',
      );
    }
  }
  return false;
}
