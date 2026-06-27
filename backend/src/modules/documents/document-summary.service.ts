import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataClass } from '@prisma/client';
import { z } from 'zod';

import { TypedConfigService } from '../../common/config/index';
import { LlmRouterService } from '../ai/services/llm-router.service';
import {
  buildDocumentSummarizePrompt,
  type DocumentSummarizeResult,
} from '../ai/services/prompts/document-summarize.prompt';

@Injectable()
export class DocumentSummaryService {
  private readonly logger = new Logger(DocumentSummaryService.name);

  private static readonly DEFAULT_INPUT_CHARS = 12000;

  private static readonly MAX_TITLE_CHARS = 200;

  private static readonly MAX_SUMMARY_CHARS = 4000;

  private static readonly LlmResultSchema = z.object({
    title: z.string().optional().nullable(),
    summary: z.string().optional().nullable(),
  });

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async summarize(args: {
    tenantId: string;
    documentId: string;
    fileName: string;
    parsedText: string;
    dataClass?: DataClass;
  }): Promise<DocumentSummarizeResult> {
    const fallbackTitle = this.fallbackTitle(args.fileName);
    const text = (args.parsedText ?? '').trim();
    if (text.length === 0) {
      return { title: fallbackTitle, summary: '' };
    }

    try {
      const inputChars = await this.cfg.getDynamic<number>(
        'knowledge.document_summary_input_chars',
        undefined,
        DocumentSummaryService.DEFAULT_INPUT_CHARS,
      );
      const prompt = buildDocumentSummarizePrompt({
        fileName: args.fileName,
        textExcerpt: text.slice(0, Math.max(1, inputChars)),
      });

      const res = await this.llm.call({
        taskType: 'document-summarize',
        systemPrompt: prompt.system,
        userMessage: prompt.user,
        tenantId: args.tenantId,
        responseFormat: { type: 'json_object' },
        dataClass: args.dataClass ?? 'internal',
        maxTokens: 700,
        sourceRef: { type: 'document', id: args.documentId },
      });

      const parsed = this.parseLlmJson(res.text);
      const title =
        parsed?.title && parsed.title.trim().length > 0
          ? parsed.title.trim().slice(0, DocumentSummaryService.MAX_TITLE_CHARS)
          : fallbackTitle;
      const summary =
        parsed?.summary && parsed.summary.trim().length > 0
          ? parsed.summary.trim().slice(0, DocumentSummaryService.MAX_SUMMARY_CHARS)
          : '';
      return { title, summary };
    } catch (err) {
      this.logger.warn(
        {
          documentId: args.documentId,
          err: err instanceof Error ? err.message : String(err),
        },
        'document-summary: AI-заголовок/резюме не построены — fallback на имя файла',
      );
      return { title: fallbackTitle, summary: '' };
    }
  }

  private fallbackTitle(fileName: string): string {
    const trimmed = (fileName ?? '').trim();
    if (trimmed.length === 0) return 'Документ';
    const withoutExt = trimmed.replace(/\.[a-z0-9]{1,8}$/i, '');
    const name = withoutExt.length > 0 ? withoutExt : trimmed;
    return name.slice(0, DocumentSummaryService.MAX_TITLE_CHARS);
  }

  private parseLlmJson(text: string): { title: string | null; summary: string | null } | null {
    if (!text) return null;
    let candidate = text.trim();
    const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1]) candidate = fence[1].trim();
    if (!candidate.startsWith('{')) {
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      if (start >= 0 && end > start) {
        candidate = candidate.slice(start, end + 1);
      }
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      return null;
    }
    const result = DocumentSummaryService.LlmResultSchema.safeParse(parsed);
    if (!result.success) return null;
    return {
      title: result.data.title ?? null,
      summary: result.data.summary ?? null,
    };
  }
}
