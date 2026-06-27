import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ChatV2Mode, ChatV2Scope, DataClass } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { BrandVoiceService } from '../../brand-voice/services/brand-voice.service';
import { ClonesService } from '../../clones/services/clones.service';
import type { QueryClass } from '../../dialog-layer/services/query-classifier.service';
import type { StructuralRetrievalFilters } from '../../dialog-layer/services/query-plan-extractor.service';
import { RetrievalCacheService } from '../../dialog-layer/services/retrieval-cache.service';
import {
  ChatV2Service as KnowledgeCoreChatV2Service,
  type ChatV2Citation,
  type ChatV2Output,
  type ChatV2Scope as KnowledgeChatV2Scope,
  type ChatV2Stage,
} from '../../knowledge-core/services/chat-v2.service';

export interface SynthesisInput {
  tenantId: string;
  userId: string;
  question: string;
  mode: ChatV2Mode;
  scope: ChatV2Scope;
  scopeRefId: string | null;
  history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  standaloneQuestion?: string | null;
  queries?: ReadonlyArray<string>;
  validAt?: Date | null;
  structuralFilters?: StructuralRetrievalFilters | null;
  tableEntityHints?: ReadonlyArray<string>;
  tableEntityIds?: ReadonlyArray<string>;
  tableAggregation?: boolean;
  conversationSummary?: string | null;
  intent?: 'factual' | 'exploratory' | 'analytical' | 'clone_roleplay' | null;
  queryClass?: QueryClass | null;
  queryClassConfidence?: number | null;
  onStage?: (stage: ChatV2Stage) => void;
}

export interface SynthesisResult {
  text: string;
  citations: ChatV2Citation[];
  retrievalMeta: Record<string, unknown>;
  llmMeta: Record<string, unknown>;
  uncertaintyNote: string | null;
  dataClass: DataClass;
  needsClarification: boolean;
}

@Injectable()
export class SynthesisService {
  private readonly logger = new Logger(SynthesisService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeCoreChatV2Service)
    private readonly chatV2: KnowledgeCoreChatV2Service,
    @Inject(RetrievalCacheService)
    private readonly retrievalCache: RetrievalCacheService,
    @Optional()
    @Inject(ClonesService)
    private readonly clones?: ClonesService,
    @Optional()
    @Inject(BrandVoiceService)
    private readonly brandVoice?: BrandVoiceService,
  ) {}

  async synthesize(input: SynthesisInput): Promise<SynthesisResult> {
    if (input.mode === 'clone_style' && input.scope === 'card' && input.scopeRefId && this.clones) {
      try {
        const cloneResult = await this.clones.askPerson({
          tenantId: input.tenantId,
          requesterUserId: input.userId,
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
          dataClass: 'sensitive',
          needsClarification: false,
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

    const effectiveQuery = input.standaloneQuestion ?? input.question;
    const validAtIso = input.validAt ? input.validAt.toISOString() : null;
    const cacheKeyArgs = {
      tenantId: input.tenantId,
      standaloneQuestion: effectiveQuery,
      scope: input.scope,
      scopeRefId: input.scopeRefId,
      validAt: validAtIso,
    } as const;
    const cachedRetrieval = await this.retrievalCache.get(cacheKeyArgs);
    let systemPromptOverride: string | null = null;

    if (
      input.mode === 'clone_style' &&
      input.scope === 'org' &&
      !input.scopeRefId &&
      this.brandVoice
    ) {
      try {
        const profile = await this.brandVoice.getOrCreate(input.tenantId);
        const injected = buildClonedCompanyPrompt(profile);
        if (injected) {
          systemPromptOverride = injected;
        }
      } catch (err) {
        this.logger.warn(
          {
            tenantId: input.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'synthesis.clone_style[scope=org]: BrandVoice load упал — fallback',
        );
      }
    }

    const result: ChatV2Output = await this.chatV2.ask({
      tenantId: input.tenantId,
      userId: input.userId,
      scope: knowledgeScope,
      scopeId: input.scopeRefId,
      query: effectiveQuery,
      history: input.history,
      conversationSummary: input.conversationSummary ?? null,
      queries: input.queries ?? undefined,
      validAt: input.validAt ?? null,
      structuralFilters: input.structuralFilters ?? null,
      tableEntityHints: input.tableEntityHints,
      tableEntityIds: input.tableEntityIds,
      tableAggregation: input.tableAggregation,
      intent: input.intent ?? undefined,
      queryClass: input.queryClass ?? undefined,
      queryClassConfidence: input.queryClassConfidence ?? undefined,
      systemPromptOverride,
      precomputedBlockIds: cachedRetrieval?.blockIds,
      onStage: input.onStage,
    });

    if (!cachedRetrieval && result.usedBlockIds.length > 0) {
      await this.retrievalCache.set(cacheKeyArgs, {
        blockIds: result.usedBlockIds,
        cachedAt: new Date().toISOString(),
      });
    }

    const retrievalMeta: Record<string, unknown> = {
      usedBlockIds: result.usedBlockIds,
    };
    const llmMeta: Record<string, unknown> = {
      model: result.modelUsed,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };

    let uncertaintyNote: string | null = null;
    if (input.mode === 'synthetic' && result.usedBlockIds.length > 0) {
      const openConflicts = await this.prisma.conflictItem.count({
        where: { tenantId: input.tenantId, status: 'open' },
      });
      if (openConflicts > 0) {
        uncertaintyNote = `В организации есть открытые противоречия (${openConflicts}) — часть фактов может быть устаревшей. Проверьте раздел «Конфликты».`;
      }
    }

    return {
      text: result.message,
      citations: result.citations,
      retrievalMeta,
      llmMeta,
      uncertaintyNote,
      dataClass: result.dataClass,
      needsClarification: result.needsClarification,
    };
  }

  private mapScope(scope: ChatV2Scope): KnowledgeChatV2Scope {
    if (scope === 'personal') return 'org';
    if (scope === 'issue') return 'card';
    return scope;
  }
}

interface BrandVoiceProfileForPrompt {
  tone: Record<string, number> | null;
  values: Array<{ value: string; weight: number }> | null;
  taboos: Array<{ phrase: string; alternative?: string; reason: string }> | null;
  belowCorpusThreshold: boolean;
}

function buildClonedCompanyPrompt(profile: BrandVoiceProfileForPrompt): string | null {
  if (
    profile.belowCorpusThreshold ||
    (profile.tone === null && profile.values === null && profile.taboos === null)
  ) {
    return null;
  }
  const lines: string[] = [
    'Ты — AI-помощник, который пишет от лица компании в её фирменном голосе бренда.',
    '',
    'Контекст: ниже извлечённый «голос бренда» (BrandVoiceProfile). Используй его как стилевую рамку — НЕ пересказывай его, а соблюдай.',
    '',
  ];

  if (profile.tone) {
    const toneEntries = Object.entries(profile.tone)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${TONE_LABEL_RU[k] ?? k}: ${v.toFixed(2)}`);
    if (toneEntries.length > 0) {
      lines.push('Тон (0..1):');
      for (const t of toneEntries) {
        lines.push(`- ${t}`);
      }
      lines.push('');
    }
  }
  if (profile.values && profile.values.length > 0) {
    lines.push('Ценности бренда (weight 0..1):');
    for (const v of profile.values.slice(0, 8)) {
      lines.push(`- ${v.value} (${v.weight.toFixed(2)})`);
    }
    lines.push('');
  }
  if (profile.taboos && profile.taboos.length > 0) {
    lines.push('Табу (НЕ использовать):');
    for (const t of profile.taboos.slice(0, 15)) {
      const alt = t.alternative ? ` → лучше: «${t.alternative}»` : '';
      lines.push(`- «${t.phrase}»${alt}. Причина: ${t.reason}`);
    }
    lines.push('');
  }
  lines.push(
    'Правила:',
    '- Отвечай на русском.',
    '- Соблюдай tone/values/taboos. Не пересказывай их в ответе.',
    '- Все ключевые утверждения помечай [BLOCK:<id>] из найденного контекста.',
    '- В конце ответа курсивом «(в фирменном голосе бренда)».',
  );
  return lines.join('\n');
}

const TONE_LABEL_RU: Record<string, string> = {
  formal: 'формальность',
  technical: 'техничность',
  casual: 'непринуждённость',
  energetic: 'энергичность',
  authoritative: 'авторитетность',
  friendly: 'дружелюбность',
  playful: 'игривость',
  minimalist: 'минимализм',
  expressive: 'выразительность',
  inclusive: 'инклюзивность',
};
