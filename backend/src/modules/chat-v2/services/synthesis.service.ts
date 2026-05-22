import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ChatV2Mode, ChatV2Scope } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { ClonesService } from '../../clones/services/clones.service';
import {
  ChatV2Service as KnowledgeCoreChatV2Service,
  type ChatV2Citation,
  type ChatV2Output,
  type ChatV2Scope as KnowledgeChatV2Scope,
} from '../../knowledge-core/services/chat-v2.service';

/**
 * SBA α-5 — SynthesisService.
 *
 * Обёртка над `ChatV2Service` из knowledge-core. Назначение:
 *   1) Пробросить mode (factual/synthetic/clone_style) — на α-5 mode влияет
 *      только на postprocessing (uncertaintyNote), полная реализация
 *      mode-prompts в γ-1.
 *   2) Передать history (последние N сообщений) — knowledge-core
 *      ChatV2Service сам подмешает в systemPrompt.
 *   3) Собрать retrievalMeta / llmMeta для записи в ChatV2Message.
 *   4) Для mode='synthetic' — если в Org есть открытые ConflictItem,
 *      релевантные к найденным блокам, добавить uncertaintyNote.
 *
 * Сам retrieval + LLM call делает knowledge-core ChatV2Service (см.
 * `chat-v2.service.ts:ask`). Этот сервис ничего не дублирует.
 */

export interface SynthesisInput {
  tenantId: string;
  userId: string;
  question: string;
  mode: ChatV2Mode;
  scope: ChatV2Scope;
  scopeRefId: string | null;
  history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
}

export interface SynthesisResult {
  text: string;
  citations: ChatV2Citation[];
  retrievalMeta: Record<string, unknown>;
  llmMeta: Record<string, unknown>;
  /** Если есть подсказка про противоречия — короткий текст для UI. */
  uncertaintyNote: string | null;
}

@Injectable()
export class SynthesisService {
  private readonly logger = new Logger(SynthesisService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeCoreChatV2Service)
    private readonly chatV2: KnowledgeCoreChatV2Service,
    @Optional() @Inject(ClonesService)
    private readonly clones?: ClonesService,
  ) {}

  async synthesize(input: SynthesisInput): Promise<SynthesisResult> {
    // SBA γ-1 — mode='clone_style' с scope='card' и scopeRefId=personId →
    // делегируем ClonesService.askPerson. Цитаты + текст приходят оттуда.
    // Сохранение в ChatV2Message происходит на стороне ChatV2OrchestrationService
    // (как и для других mode), поэтому отсюда возвращаем «результат как
    // если бы был обычный synthesize».
    if (
      input.mode === 'clone_style' &&
      input.scope === 'card' &&
      input.scopeRefId &&
      this.clones
    ) {
      try {
        const cloneResult = await this.clones.askPerson({
          tenantId: input.tenantId,
          requesterUserId: input.userId,
          // scopeRefId для clone_style — это personId, т.к. UI/диспетчер
          // ставит personId в scope='card'. Если в будущем понадобится
          // role-clone через synthesize — переключим через scopeRefKind.
          personId: input.scopeRefId,
          question: input.question,
        });
        const citations: ChatV2Citation[] = cloneResult.citations.map((c) => ({
          meetingId: c.meetingId ?? '',
          meetingTitle: c.meetingTitle ?? '',
          startMs: c.startMs ?? 0,
          endMs: c.endMs ?? 0,
          snippet: c.snippet ?? '',
        }));
        return {
          text: cloneResult.text,
          citations,
          retrievalMeta: { mode: 'clone_style', usedBlockIds: [] },
          llmMeta: { mode: 'clone_style' },
          uncertaintyNote: null,
        };
      } catch (err) {
        this.logger.warn(
          {
            scopeRefId: input.scopeRefId,
            err: err instanceof Error ? err.message : String(err),
          },
          'synthesis.clone_style: ClonesService.askPerson упал — fallback на synthetic',
        );
      }
    }

    const knowledgeScope = this.mapScope(input.scope);

    // На α-5 mode не передаётся в knowledge-core (там нет mode-prompts).
    // Mode используется выше — для пост-обработки и mode-меток в БД.
    const result: ChatV2Output = await this.chatV2.ask({
      tenantId: input.tenantId,
      userId: input.userId,
      scope: knowledgeScope,
      scopeId: input.scopeRefId,
      query: input.question,
      history: input.history,
    });

    const retrievalMeta: Record<string, unknown> = {
      usedBlockIds: result.usedBlockIds,
    };
    const llmMeta: Record<string, unknown> = {
      model: result.modelUsed,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };

    // Uncertainty note: только для synthetic mode + если есть открытые
    // конфликты в Org. Простая эвристика без проверки overlap'а конкретных
    // блоков (TODO в β: связать ConflictItem с usedBlockIds через cardId
    // → blockIds). На α-5 — общая подсказка.
    let uncertaintyNote: string | null = null;
    if (input.mode === 'synthetic' && result.usedBlockIds.length > 0) {
      const openConflicts = await this.prisma.conflictItem.count({
        where: { tenantId: input.tenantId, status: 'open' },
      });
      if (openConflicts > 0) {
        uncertaintyNote = `В организации есть открытые противоречия (${openConflicts}) — часть фактов может быть устаревшей. Проверьте раздел «Конфликты».`;
      }
    }

    if (input.mode === 'clone_style') {
      // γ-1 — если попали сюда, значит scope/scopeRefId не подошли для ClonesService.askPerson
      // (например scope='org' без scopeRefId). Дегрейдим до synthetic с пометкой.
      return {
        text: `${result.message}\n\n_(режим «в стиле сотрудника» требует выбора конкретного сотрудника — показал synthetic-ответ)_`,
        citations: result.citations,
        retrievalMeta,
        llmMeta,
        uncertaintyNote,
      };
    }

    return {
      text: result.message,
      citations: result.citations,
      retrievalMeta,
      llmMeta,
      uncertaintyNote,
    };
  }

  /**
   * Маппинг scope нашей α-5 модели → scope knowledge-core ChatV2Service.
   * 'personal' пока маппится в 'org' (нет персонального индекса блоков
   * до γ-1).
   */
  private mapScope(scope: ChatV2Scope): KnowledgeChatV2Scope {
    if (scope === 'personal') return 'org';
    return scope;
  }
}
