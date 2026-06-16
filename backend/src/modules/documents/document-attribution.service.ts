import { Inject, Injectable, Logger } from '@nestjs/common';
import { DocumentType } from '@prisma/client';
import { z } from 'zod';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LlmRouterService } from '../ai/services/llm-router.service';
import { buildDocumentAttributionPrompt } from '../ai/services/prompts/document-attribution-suggest.prompt';

@Injectable()
export class DocumentAttributionService {
  private readonly logger = new Logger(DocumentAttributionService.name);

  private static readonly TEXT_EXCERPT_CHARS = 2000;

  private static readonly MAX_THEMES = 60;

  private static readonly DOC_TYPE_VALUES = new Set<string>(Object.values(DocumentType));

  private static readonly LlmResultSchema = z.object({
    docType: z.string().optional().nullable(),
    themeId: z.string().optional().nullable(),
    confidence: z.number().optional().nullable(),
  });

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async suggestForDocument(args: { documentId: string; tenantId: string }): Promise<void> {
    const { documentId, tenantId } = args;
    try {
      const enabled = await this.cfg.getDynamic<boolean>(
        'documents.ai_attribution.enabled',
        undefined,
        true,
      );
      if (!enabled) {
        this.logger.debug({ documentId }, 'document-attribution: kill-switch выключен — skip');
        return;
      }

      const doc = await this.prisma.document.findUnique({
        where: { id: documentId },
        select: {
          tenantId: true,
          status: true,
          parsedText: true,
          docType: true,
          attachedThemeId: true,
          suggestedDocType: true,
        },
      });
      if (!doc || doc.tenantId !== tenantId) return;

      if (doc.docType !== null || doc.attachedThemeId !== null) {
        this.logger.debug(
          { documentId },
          'document-attribution: документ уже атрибутирован вручную — skip',
        );
        return;
      }
      if (doc.suggestedDocType !== null) {
        this.logger.debug(
          { documentId },
          'document-attribution: подсказка уже есть — skip (идемпотентно)',
        );
        return;
      }
      const text = (doc.parsedText ?? '').trim();
      if (text.length === 0) {
        this.logger.debug({ documentId }, 'document-attribution: пустой parsedText — skip');
        return;
      }

      const themes = await this.prisma.theme.findMany({
        where: { tenantId },
        select: { id: true, name: true },
        orderBy: { createdAt: 'desc' },
        take: DocumentAttributionService.MAX_THEMES,
      });

      const prompt = buildDocumentAttributionPrompt({
        textExcerpt: text.slice(0, DocumentAttributionService.TEXT_EXCERPT_CHARS),
        themes: themes.map((t) => ({ id: t.id, name: t.name })),
      });

      const res = await this.llm.call({
        taskType: 'document-attribution-suggest',
        systemPrompt: prompt.system,
        userMessage: prompt.user,
        tenantId,
        responseFormat: { type: 'json_object' },
        dataClass: 'internal',
        maxTokens: 200,
        sourceRef: { type: 'document', id: documentId },
      });

      const parsed = this.parseLlmJson(res.text);
      if (!parsed) {
        this.logger.warn(
          { documentId },
          'document-attribution: LLM вернул нераспознаваемый ответ — подсказка не записана',
        );
        return;
      }

      const suggestedDocType =
        parsed.docType && DocumentAttributionService.DOC_TYPE_VALUES.has(parsed.docType)
          ? (parsed.docType as DocumentType)
          : null;
      const validThemeIds = new Set(themes.map((t) => t.id));
      const suggestedThemeId =
        parsed.themeId && validThemeIds.has(parsed.themeId) ? parsed.themeId : null;

      if (suggestedDocType === null && suggestedThemeId === null) {
        this.logger.debug(
          { documentId },
          'document-attribution: модель не дала валидной подсказки — skip',
        );
        return;
      }

      const updated = await this.prisma.document.updateMany({
        where: {
          id: documentId,
          tenantId,
          docType: null,
          attachedThemeId: null,
          suggestedDocType: null,
        },
        data: {
          suggestedDocType,
          suggestedThemeId,
        },
      });

      this.logger.log(
        {
          documentId,
          suggestedDocType,
          suggestedThemeId,
          written: updated.count,
        },
        'document-attribution: подсказка атрибуции записана (human-in-the-loop)',
      );
    } catch (err) {
      this.logger.warn(
        {
          documentId,
          err: err instanceof Error ? err.message : String(err),
        },
        'document-attribution: подсказка не построена (не критично)',
      );
    }
  }

  private parseLlmJson(text: string): {
    docType: string | null;
    themeId: string | null;
    confidence: number | null;
  } | null {
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
    const result = DocumentAttributionService.LlmResultSchema.safeParse(parsed);
    if (!result.success) return null;
    return {
      docType: result.data.docType ?? null,
      themeId: result.data.themeId ?? null,
      confidence: result.data.confidence ?? null,
    };
  }
}
