import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import type { CleanedSegment, CleanerRemovedItem } from './deterministic-cleaner';
import {
  LlmRouterAllProvidersFailedError,
  LlmRouterService,
  NoEligibleProviderError,
} from './llm-router.service';
import { withAsrNote, withInjectionGuard, wrapUserData } from './prompts/common';
import { PromptResolverService } from './prompt-resolver.service';
import {
  buildTranscriptCleanRefineUserMessage,
  TRANSCRIPT_CLEAN_REFINE_OUTPUT_SCHEMA,
  TRANSCRIPT_CLEAN_REFINE_SYSTEM_PROMPT,
  TRANSCRIPT_CLEAN_REFINE_TOOL_NAME,
} from './prompts/transcript-clean-refine';

@Injectable()
export class TranscriptCleanLlmRefineService {
  private readonly logger = new Logger(TranscriptCleanLlmRefineService.name);

  private static readonly CHUNK_SIZE = 8;

  constructor(
    @Inject(LlmRouterService) private readonly router: LlmRouterService,
    @Inject(PromptResolverService) private readonly resolver: PromptResolverService,
  ) {}

  async refine(args: {
    segments: CleanedSegment[];
    tenantId: string | null;
    meetingId: string;
    meetingType: string;
    jobId?: string;
  }): Promise<{
    segments: CleanedSegment[];
    refined: number;
    llmRefineSkipped: boolean;
  }> {
    const { segments, tenantId, meetingId, meetingType, jobId } = args;

    const candidates = segments.filter((s) => s.cleanedText.length > 0);
    if (candidates.length === 0) {
      return { segments, refined: 0, llmRefineSkipped: false };
    }

    let systemPrompt = TRANSCRIPT_CLEAN_REFINE_SYSTEM_PROMPT;
    try {
      const resolved = await (
        this.resolver as unknown as {
          resolveForMeeting: (p: {
            tenantId: string;
            meetingId: string;
            meetingType: string;
            taskType: string;
          }) => Promise<{ systemPrompt: string } | null>;
        }
      ).resolveForMeeting({
        tenantId: tenantId ?? '',
        meetingId,
        meetingType,
        taskType: 'transcript-clean-refine',
      });
      if (resolved?.systemPrompt) {
        systemPrompt = resolved.systemPrompt;
      }
    } catch (err) {
      this.logger.debug(
        { meetingId, err: err instanceof Error ? err.message : String(err) },
        'transcript-clean-refine: resolveForMeeting failed → code-fallback',
      );
    }

    const guardedSystem = withAsrNote(withInjectionGuard(systemPrompt));

    const out = segments.slice();
    let refinedCount = 0;
    let anyChunkFailed = false;
    let anyChunkSucceeded = false;

    const chunks = chunk(candidates, TranscriptCleanLlmRefineService.CHUNK_SIZE);
    for (const ch of chunks) {
      try {
        const userMessage = wrapUserData(
          buildTranscriptCleanRefineUserMessage(
            ch.map((s) => ({
              originalIndex: s.originalIndex,
              speaker: s.participantIdentity,
              text: s.cleanedText,
            })),
          ),
        );
        const result = await this.router.call({
          taskType: 'transcript-clean-refine',
          systemPrompt: guardedSystem,
          userMessage,
          tenantId,
          meetingId,
          ...(jobId !== undefined ? { jobId } : {}),
          responseFormat: {
            type: 'json_schema',
            name: TRANSCRIPT_CLEAN_REFINE_TOOL_NAME,
            schema: TRANSCRIPT_CLEAN_REFINE_OUTPUT_SCHEMA,
            strict: true,
          },
          dataClass: 'internal',
        });
        const parsed = this.parseResponse(result.text);
        if (!parsed) {
          anyChunkFailed = true;
          continue;
        }
        anyChunkSucceeded = true;
        for (const item of parsed.items) {
          const idx = out.findIndex((s) => s.originalIndex === item.originalIndex);
          if (idx < 0) continue;
          const seg = out[idx]!;
          if (
            item.cleanedText.trim().length === 0 ||
            item.cleanedText.length < Math.max(0, Math.floor(seg.cleanedText.length * 0.2))
          ) {
            this.logger.debug(
              { meetingId, originalIndex: item.originalIndex },
              'transcript-clean-refine: LLM вернул слишком короткий cleanedText — игнорируем',
            );
            continue;
          }
          const mergedRemoved: CleanerRemovedItem[] = [
            ...seg.removed,
            ...item.removed.map((r) => ({ type: r.type, text: r.text })),
          ];
          out[idx] = {
            ...seg,
            cleanedText: item.cleanedText,
            removed: mergedRemoved,
          };
          refinedCount += 1;
        }
      } catch (err) {
        anyChunkFailed = true;
        if (
          err instanceof LlmRouterAllProvidersFailedError ||
          err instanceof NoEligibleProviderError
        ) {
          this.logger.warn(
            {
              meetingId,
              taskType: 'transcript-clean-refine',
              err: err.message,
            },
            'transcript-clean-refine: LLM-вызов упал, продолжаем на уровне 1',
          );
        } else {
          this.logger.warn(
            { meetingId, err: err instanceof Error ? err.message : String(err) },
            'transcript-clean-refine: непредвиденная ошибка',
          );
        }
      }
    }

    const llmRefineSkipped = !anyChunkSucceeded && (anyChunkFailed || chunks.length > 0);

    return {
      segments: out,
      refined: refinedCount,
      llmRefineSkipped,
    };
  }

  private parseResponse(text: string): { items: RefinedItem[] } | null {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      const m = text.match(/```(?:json)?\s*([\s\S]+?)```/);
      if (!m || !m[1]) return null;
      try {
        json = JSON.parse(m[1]);
      } catch {
        return null;
      }
    }
    const parsed = ResponseSchema.safeParse(json);
    if (!parsed.success) {
      this.logger.debug(
        { issues: parsed.error.issues.slice(0, 3) },
        'transcript-clean-refine: JSON не соответствует схеме',
      );
      return null;
    }
    return parsed.data;
  }
}

const RemovedItemSchema = z
  .object({
    type: z.enum(['filler', 'repeat', 'false_start']),
    text: z.string(),
  })
  .strict();

const RefinedItemSchema = z
  .object({
    originalIndex: z.number().int().nonnegative(),
    cleanedText: z.string(),
    removed: z.array(RemovedItemSchema),
  })
  .strict();

type RefinedItem = z.infer<typeof RefinedItemSchema>;

const ResponseSchema = z
  .object({
    items: z.array(RefinedItemSchema),
  })
  .strict();

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
