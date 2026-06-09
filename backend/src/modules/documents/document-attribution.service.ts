import { Inject, Injectable, Logger } from '@nestjs/common';
import { DocumentType } from '@prisma/client';
import { z } from 'zod';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LlmRouterService } from '../ai/services/llm-router.service';
import { buildDocumentAttributionPrompt } from '../ai/services/prompts/document-attribution-suggest.prompt';

/**
 * ТЗ-4 Ф10 (manual-document-upload) — LLM-подсказка атрибуции документа.
 *
 * Для распарсенного документа БЕЗ явной атрибуции (`docType` И `attachedThemeId`
 * оба null) вызывает дешёвый классификатор `document-attribution-suggest`:
 *   - SYSTEM (стабилен, cache-friendly): инструкция + фиксированный enum
 *     `DocumentType` + JSON-форма вывода;
 *   - user (переменное в КОНЦЕ): первые ~2000 символов parsedText + список тем Org;
 *   - результат пишется в `Document.suggestedDocType` + `Document.suggestedThemeId`
 *     (НЕ в docType/attachedThemeId — те ставит ТОЛЬКО человек при подтверждении).
 *
 * Авто-применения НЕТ (Р3): подсказка — для UI accept/edit (отдельный фронт).
 *
 * Гейт — kill-switch `documents.ai_attribution.enabled` (DEFAULT ON). Best-effort:
 * любой сбой LLM/парсинга/записи НЕ ломает ingest (вызывается из адаптера в
 * try/catch). Идемпотентно: если `suggestedDocType` уже заполнен — skip.
 *
 * ── Совместимость с prompt caching ──
 * Prompt-builder держит стабильный SYSTEM (инструкция + каталог типов + JSON-форма),
 * переменные данные (темы Org + фрагмент текста) — в КОНЦЕ user. Это даёт стабильный
 * prefix и высокий cache-hit у DeepSeek/OpenAI-proxy.
 */
@Injectable()
export class DocumentAttributionService {
  private readonly logger = new Logger(DocumentAttributionService.name);

  /** Сколько символов parsedText отдаём модели (хватает для классификации, экономит токены). */
  private static readonly TEXT_EXCERPT_CHARS = 2000;

  /** Сколько тем Org показываем модели (top-N свежих; не раздуваем user). */
  private static readonly MAX_THEMES = 60;

  /** Допустимые значения docType (для безопасного маппинга строки enum'а). */
  private static readonly DOC_TYPE_VALUES = new Set<string>(
    Object.values(DocumentType),
  );

  /** Zod-схема ответа LLM (мягкая — невалидные поля просто отбрасываем). */
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

  /**
   * Предлагает атрибуцию для документа. Best-effort: возвращает void и НИКОГДА
   * не бросает (caller — адаптер ingest — не должен падать из-за подсказки).
   *
   * @param documentId id уже распарсенного Document'а.
   * @param tenantId   Org документа (для tenant-scope тем и LLM-биллинга).
   */
  async suggestForDocument(args: {
    documentId: string;
    tenantId: string;
  }): Promise<void> {
    const { documentId, tenantId } = args;
    try {
      // 0. Kill-switch (DEFAULT ON). Выключен → ничего не делаем.
      const enabled = await this.cfg.getDynamic<boolean>(
        'documents.ai_attribution.enabled',
        undefined,
        true,
      );
      if (!enabled) {
        this.logger.debug(
          { documentId },
          'document-attribution: kill-switch выключен — skip',
        );
        return;
      }

      // 1. Загружаем документ (с tenant-проверкой) + проверяем условия запуска.
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

      // Запускаем ТОЛЬКО для распарсенных документов без явной атрибуции.
      if (doc.docType !== null || doc.attachedThemeId !== null) {
        this.logger.debug(
          { documentId },
          'document-attribution: документ уже атрибутирован вручную — skip',
        );
        return;
      }
      // Идемпотентность: подсказка уже посчитана → не дёргаем LLM повторно.
      if (doc.suggestedDocType !== null) {
        this.logger.debug(
          { documentId },
          'document-attribution: подсказка уже есть — skip (идемпотентно)',
        );
        return;
      }
      const text = (doc.parsedText ?? '').trim();
      if (text.length === 0) {
        this.logger.debug(
          { documentId },
          'document-attribution: пустой parsedText — skip',
        );
        return;
      }

      // 2. Темы Org (id + name) — варианты для themeId. Пустой список допустим
      //    (модель вернёт themeId: null).
      const themes = await this.prisma.theme.findMany({
        where: { tenantId },
        select: { id: true, name: true },
        orderBy: { createdAt: 'desc' },
        take: DocumentAttributionService.MAX_THEMES,
      });

      // 3. LLM-вызов (cheap classifier, json_object).
      const prompt = buildDocumentAttributionPrompt({
        textExcerpt: text.slice(
          0,
          DocumentAttributionService.TEXT_EXCERPT_CHARS,
        ),
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

      // 4. Нормализуем: docType только из enum'а; themeId только если он реально
      //    существует в переданном списке (защита от выдуманного id).
      const suggestedDocType =
        parsed.docType &&
        DocumentAttributionService.DOC_TYPE_VALUES.has(parsed.docType)
          ? (parsed.docType as DocumentType)
          : null;
      const validThemeIds = new Set(themes.map((t) => t.id));
      const suggestedThemeId =
        parsed.themeId && validThemeIds.has(parsed.themeId)
          ? parsed.themeId
          : null;

      // Нечего предложить (модель не дала ни типа, ни темы) → не пишем мусор.
      if (suggestedDocType === null && suggestedThemeId === null) {
        this.logger.debug(
          { documentId },
          'document-attribution: модель не дала валидной подсказки — skip',
        );
        return;
      }

      // 5. Записываем подсказку. Условие в where защищает от гонок (заполняем
      //    ТОЛЬКО пока ни docType, ни suggestedDocType не выставлены) — это и
      //    идемпотентность, и защита от перезаписи ручной атрибуции.
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
      // Best-effort: подсказка не должна валить ingest.
      this.logger.warn(
        {
          documentId,
          err: err instanceof Error ? err.message : String(err),
        },
        'document-attribution: подсказка не построена (не критично)',
      );
    }
  }

  // ──────────────────────────── private ──────────────────────────────────

  /** Достаёт `{ docType, themeId, confidence }` из ответа LLM (срезает markdown). */
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
