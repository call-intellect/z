import { createHash } from 'node:crypto';

import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, type ExecutablePersona } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AiChatQuotaService } from '../../ai-chat-quota/ai-chat-quota.service';
import { type LlmCallResult, LlmRouterService } from '../../ai/services/llm-router.service';
import { DialogService } from '../../dialog-layer/services/dialog.service';
import { narrowToChatIntent } from '../../dialog-layer/services/query-classifier.service';
import { SKILL_SUBJECT_SIGNAL_TYPES } from '../../knowledge-core/constants/skill-signal-types';
import {
  CLONE_RESPOND_USER_TEMPLATE,
  type CloneRespondPracticeSkill,
  type CloneRespondRegulation,
  buildCloneRespondSystemPrompt,
} from '../../knowledge-core/prompts/clone-respond.prompt';
import { KnowledgeEmbeddingService } from '../../knowledge-core/services/embedding.service';
import { ExecutablePersonaBuildService } from '../../knowledge-core/services/executable-persona-build.service';
import { ExecutablePersonaVersioningService } from '../../knowledge-core/services/executable-persona-versioning.service';
import { RoleRegulationRetrievalService } from '../../knowledge-core/services/role-regulation-retrieval.service';
import { PracticeSkillRetrievalService } from '../../practice-skills/services/practice-skill-retrieval.service';
import {
  KnowledgeAccessResolver,
  type KnowledgeAccessContext,
} from '../../rbac/knowledge-access-resolver.service';
import { RbacService } from '../../rbac/rbac.service';
import type {
  CloneConversationListItemDto,
  CloneConversationsListResponseDto,
} from '../dto/clone-conversations.dto';
import type {
  AskAllFormersAnswerDto,
  AskAllFormersResponseDto,
  AskCloneResponseDto,
  CloneCitationDto,
  CloneHistoryResponseDto,
  CloneListItemDto,
  CloneQueryLogListResponseDto,
  ClonesListQuery,
  ClonesListResponseDto,
  CloneVersionDto,
  RoleSkillProfileDto,
  SkillProfileDto,
  SkillTraitDto,
} from '../dto/clones.dto';

@Injectable()
export class ClonesService {
  private readonly logger = new Logger(ClonesService.name);

  private static readonly MIN_TRAITS_FOR_ANSWER = 3;

  static readonly TOPIC_STARVED_REFUSAL_TEXT =
    'По этой теме у меня в роли пока нет достаточной опоры, чтобы ответить как эксперт, — придумывать за носителя не стану. Если это в зоне моей должности — точнее подскажет сам носитель роли; если вопрос вне моей должности, его лучше адресовать профильному специалисту.';

  static readonly UNGROUNDED_REFUSAL_TEXT =
    'По этому вопросу у меня нет опоры в памяти роли — без неё отвечать не буду, чтобы не выдумывать. Точнее подскажет сам носитель роли или профильный специалист по теме.';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiChatQuotaService)
    private readonly aiChatQuota: AiChatQuotaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(ExecutablePersonaBuildService)
    private readonly personaBuilder: ExecutablePersonaBuildService,
    @Inject(ExecutablePersonaVersioningService)
    private readonly personaVersioning: ExecutablePersonaVersioningService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Optional()
    @Inject(KnowledgeAccessResolver)
    private readonly accessResolver: KnowledgeAccessResolver | null = null,
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder: KnowledgeEmbeddingService,
    @Optional()
    @Inject(DialogService)
    private readonly dialog: DialogService | null = null,
    @Optional()
    @Inject(PracticeSkillRetrievalService)
    private readonly practiceSkills: PracticeSkillRetrievalService | null = null,
    @Optional()
    @Inject(RoleRegulationRetrievalService)
    private readonly roleRegulations: RoleRegulationRetrievalService | null = null,
  ) {}

  async askPerson(args: {
    tenantId: string;
    requesterUserId: string;
    personId: string;
    question: string;
    conversationId?: string;
  }): Promise<AskCloneResponseDto> {
    if (this.isCloneV2Enabled()) {
      return this.askPersonV2(args);
    }
    const accessCheck = await this.canAccessPersonClone({
      tenantId: args.tenantId,
      requesterUserId: args.requesterUserId,
      personId: args.personId,
    });
    if (!accessCheck.allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет доступа к клону этого сотрудника',
        },
      });
    }

    await this.aiChatQuota.tryConsume({
      tenantId: args.tenantId,
      userId: args.requesterUserId,
    });

    const profile = await this.prisma.skillProfile.findUnique({
      where: { personId: args.personId },
      include: {
        person: {
          select: { id: true, name: true, userId: true, relationship: true },
        },
        traits: {
          where: { status: 'active' },
          orderBy: [{ confidence: 'desc' }, { lastConfirmedAt: 'desc' }],
        },
      },
    });
    if (!profile || profile.status !== 'active') {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'no_clone',
          message:
            'У этого сотрудника пока нет клона — недостаточно встреч с обсуждением «почему я так решил».',
        },
      });
    }
    if (profile.traits.length < ClonesService.MIN_TRAITS_FOR_ANSWER) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'starved_profile',
          message:
            'Клон ещё не сформирован — нужно больше встреч с обсуждениями подхода к решениям.',
        },
      });
    }

    let persona = await this.prisma.executablePersona.findFirst({
      where: {
        profileId: profile.id,
        scope: 'person',
        status: 'active',
      },
      orderBy: { version: 'desc' },
    });
    if (!persona) {
      this.logger.debug(
        { profileId: profile.id },
        'clones.askPerson: active Persona не найдена — пытаюсь собрать on-demand',
      );
      persona = await this.personaBuilder.buildForProfile({
        profileId: profile.id,
      });
      if (!persona) {
        throw new NotFoundException({
          ok: false,
          error: {
            code: 'persona_unavailable',
            message:
              'Клон пока недоступен — следующий snapshot собирается каждое воскресенье 06:00.',
          },
        });
      }
    }

    const enf = this.cfg.knowledgeAccess.enforcement;
    const accessCtx =
      enf !== 'off' && this.accessResolver
        ? await this.accessResolver.resolveAccessibleGroups({
            tenantId: args.tenantId,
            userId: args.requesterUserId,
          })
        : null;
    const subgraph = await this.loadPersonSubgraph({
      tenantId: args.tenantId,
      personId: args.personId,
      question: args.question,
      accessCtx,
      enforcement: enf,
    });

    const retrievedSkills = await this.retrievePracticeSkills({
      tenantId: args.tenantId,
      scope: 'person',
      scopeRefId: args.personId,
      question: args.question,
      conversationId: args.conversationId ?? null,
    });

    const topicDensity = await this.assertTopicDensity({
      question: args.question,
      reasoningBlocks: subgraph.reasoningBlocks,
    });
    if (topicDensity.refused && retrievedSkills.length === 0) {
      const refusalText = ClonesService.TOPIC_STARVED_REFUSAL_TEXT;
      const { conversationId, messageId } = await this.persistMessage({
        tenantId: args.tenantId,
        requesterUserId: args.requesterUserId,
        scope: 'card',
        scopeRefId: profile.id,
        question: args.question,
        conversationId: args.conversationId,
        answer: refusalText,
        citations: [],
        llmMeta: {
          refused: true,
          refusalReason: 'topic_starved',
          personaVersion: persona.version,
          topicMatchedBlocks: topicDensity.matchedBlocks,
          topicRequiredBlocks: topicDensity.requiredBlocks,
          topicSimilarityThreshold: topicDensity.similarityThreshold,
          topicTopCosine: topicDensity.topCosine,
        },
      });

      this.metrics.incCloneAskRefused({ reason: 'topic_starved' });
      this.metrics.incCloneAsk({ scope: 'person' });
      if (profile.person.userId && profile.person.userId === args.requesterUserId) {
        this.metrics.incCloneAskByOwner();
      }
      await this.logCloneQuery({
        tenantId: args.tenantId,
        cloneScope: 'person',
        cloneTargetId: args.personId,
        userId: args.requesterUserId,
        question: args.question,
        answeredGrounded: false,
        refusalReason: 'topic_starved',
      });

      return {
        conversationId,
        messageId,
        text: refusalText,
        citations: [],
        mode: 'clone_style',
        isOwner: profile.person.userId !== null && profile.person.userId === args.requesterUserId,
        refused: true,
        refusalReason: 'topic_starved',
      };
    }

    const llmResult = await this.callCloneRespond({
      tenantId: args.tenantId,
      persona,
      question: args.question,
      subgraph,
      roleName: null,
      bearerName: profile.person.name,
      practiceSkills: toPromptSkills(retrievedSkills),
    });

    const citations = this.parseCitations(llmResult.text, subgraph);

    if (this.isUngrounded(citations, 'factual', topicDensity.matchedBlocks >= 1)) {
      return this.persistUngroundedRefusal({
        tenantId: args.tenantId,
        requesterUserId: args.requesterUserId,
        scopeRefId: profile.id,
        cloneTargetId: args.personId,
        question: args.question,
        conversationId: args.conversationId,
        persona,
        scopeKind: 'person',
        isOwner: profile.person.userId !== null && profile.person.userId === args.requesterUserId,
        cloneV2: false,
      });
    }

    const { conversationId, messageId } = await this.persistMessage({
      tenantId: args.tenantId,
      requesterUserId: args.requesterUserId,
      scope: 'card',
      scopeRefId: profile.id,
      question: args.question,
      conversationId: args.conversationId,
      answer: llmResult.text,
      citations,
      llmMeta: {
        model: llmResult.modelUsed,
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens,
        tier: llmResult.tier ?? null,
        personaVersion: persona.version,
        practiceSkillsCount: retrievedSkills.length,
        usedBlockIds: subgraph.reasoningBlocks.map((b) => b.id),
        usedSkillIds: retrievedSkills.map((s) => s.id),
        usedRegulationNames: [],
        topicMatchedBlocks: topicDensity.matchedBlocks,
        topicTopCosine: topicDensity.topCosine,
      },
    });

    await this.recordPracticeSkillUsages({
      tenantId: args.tenantId,
      conversationId,
      messageId,
      skills: retrievedSkills,
    });

    this.metrics.incCloneAsk({ scope: 'person' });
    if (profile.person.userId && profile.person.userId === args.requesterUserId) {
      this.metrics.incCloneAskByOwner();
    }

    await this.logCloneQuery({
      tenantId: args.tenantId,
      cloneScope: 'person',
      cloneTargetId: args.personId,
      userId: args.requesterUserId,
      question: args.question,
      answeredGrounded: citations.length > 0,
      refusalReason: null,
    });

    return {
      conversationId,
      messageId,
      text: llmResult.text,
      citations,
      mode: 'clone_style',
      isOwner: profile.person.userId !== null && profile.person.userId === args.requesterUserId,
    };
  }

  async askRole(args: {
    tenantId: string;
    requesterUserId: string;
    roleId: string;
    question: string;
    conversationId?: string;
    roleVersion?: number;
  }): Promise<AskCloneResponseDto> {
    if (this.isCloneV2Enabled()) {
      return this.askRoleV2(args);
    }
    const allowed = await this.rbac.check({
      userId: args.requesterUserId,
      tenantId: args.tenantId,
      obj: 'role',
      act: 'read',
      resourceOwnerId: null,
    });
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет доступа к клону роли',
        },
      });
    }

    await this.aiChatQuota.tryConsume({
      tenantId: args.tenantId,
      userId: args.requesterUserId,
    });

    const role = await this.prisma.role.findUnique({
      where: { id: args.roleId },
      select: { id: true, name: true, tenantId: true, deletedAt: true },
    });
    if (!role || role.deletedAt || role.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'role_not_found', message: 'Роль не найдена' },
      });
    }

    let persona =
      args.roleVersion != null
        ? await this.prisma.executablePersona.findFirst({
            where: {
              tenantId: args.tenantId,
              scope: 'role',
              scopeRefId: args.roleId,
              roleVersion: args.roleVersion,
              status: { in: ['active', 'frozen'] },
            },
            orderBy: { version: 'desc' },
          })
        : await this.prisma.executablePersona.findFirst({
            where: {
              tenantId: args.tenantId,
              scope: 'role',
              scopeRefId: args.roleId,
              status: 'active',
            },
            orderBy: { version: 'desc' },
          });
    if (!persona && args.roleVersion == null) {
      persona = await this.personaBuilder.buildForRole({
        tenantId: args.tenantId,
        roleId: args.roleId,
      });
    }
    if (!persona) {
      throw new NotFoundException({
        ok: false,
        error: {
          code:
            args.roleVersion != null
              ? 'role_persona_version_not_found'
              : 'role_persona_unavailable',
          message:
            args.roleVersion != null
              ? 'Запрошенная версия клона роли не найдена.'
              : 'Клон роли пока недоступен — нужно больше сотрудников с накопленными профилями.',
        },
      });
    }

    const enf = this.cfg.knowledgeAccess.enforcement;
    const accessCtx =
      enf !== 'off' && this.accessResolver
        ? await this.accessResolver.resolveAccessibleGroups({
            tenantId: args.tenantId,
            userId: args.requesterUserId,
          })
        : null;
    const subgraph = await this.loadRoleSubgraph({
      tenantId: args.tenantId,
      roleId: args.roleId,
      question: args.question,
      accessCtx,
      enforcement: enf,
    });

    const retrievedSkills = await this.retrievePracticeSkills({
      tenantId: args.tenantId,
      scope: 'role',
      scopeRefId: args.roleId,
      question: args.question,
      conversationId: args.conversationId ?? null,
    });

    const applicableRegulations = await this.retrieveRoleRegulations({
      tenantId: args.tenantId,
      roleId: args.roleId,
      question: args.question,
    });

    const topicDensity = await this.assertTopicDensity({
      question: args.question,
      reasoningBlocks: subgraph.reasoningBlocks,
    });
    if (
      topicDensity.refused &&
      applicableRegulations.length === 0 &&
      retrievedSkills.length === 0
    ) {
      const refusalText = ClonesService.TOPIC_STARVED_REFUSAL_TEXT;
      const { conversationId, messageId } = await this.persistMessage({
        tenantId: args.tenantId,
        requesterUserId: args.requesterUserId,
        scope: 'card',
        scopeRefId: args.roleId,
        question: args.question,
        conversationId: args.conversationId,
        answer: refusalText,
        citations: [],
        llmMeta: {
          refused: true,
          refusalReason: 'topic_starved',
          personaVersion: persona.version,
          scopeKind: 'role',
          roleId: args.roleId,
          topicMatchedBlocks: topicDensity.matchedBlocks,
          topicRequiredBlocks: topicDensity.requiredBlocks,
          topicSimilarityThreshold: topicDensity.similarityThreshold,
        },
      });

      this.metrics.incCloneAskRefused({ reason: 'topic_starved' });
      this.metrics.incCloneAsk({ scope: 'role' });
      await this.logCloneQuery({
        tenantId: args.tenantId,
        cloneScope: 'role',
        cloneTargetId: args.roleId,
        userId: args.requesterUserId,
        question: args.question,
        answeredGrounded: false,
        refusalReason: 'topic_starved',
      });

      return {
        conversationId,
        messageId,
        text: refusalText,
        citations: [],
        mode: 'clone_style',
        isOwner: false,
        refused: true,
        refusalReason: 'topic_starved',
      };
    }

    const bearerName: string | null =
      persona.publicName ?? `Клон ${role.name} v${persona.roleVersion ?? 1}`;

    const llmResult = await this.callCloneRespond({
      tenantId: args.tenantId,
      persona,
      question: args.question,
      subgraph,
      roleName: role.name,
      bearerName,
      practiceSkills: toPromptSkills(retrievedSkills),
      applicableRegulations,
    });

    const citations = this.parseCitations(llmResult.text, subgraph);

    if (this.isUngrounded(citations, 'factual', topicDensity.matchedBlocks >= 1)) {
      return this.persistUngroundedRefusal({
        tenantId: args.tenantId,
        requesterUserId: args.requesterUserId,
        scopeRefId: args.roleId,
        cloneTargetId: args.roleId,
        question: args.question,
        conversationId: args.conversationId,
        persona,
        scopeKind: 'role',
        isOwner: false,
        cloneV2: false,
      });
    }

    const { conversationId, messageId } = await this.persistMessage({
      tenantId: args.tenantId,
      requesterUserId: args.requesterUserId,
      scope: 'card',
      scopeRefId: args.roleId,
      question: args.question,
      conversationId: args.conversationId,
      answer: llmResult.text,
      citations,
      llmMeta: {
        model: llmResult.modelUsed,
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens,
        tier: llmResult.tier ?? null,
        personaVersion: persona.version,
        scopeKind: 'role',
        roleId: args.roleId,
        practiceSkillsCount: retrievedSkills.length,
        usedBlockIds: subgraph.reasoningBlocks.map((b) => b.id),
        usedSkillIds: retrievedSkills.map((s) => s.id),
        usedRegulationNames: applicableRegulations.map((r) => r.name),
        topicMatchedBlocks: topicDensity.matchedBlocks,
        topicTopCosine: topicDensity.topCosine,
      },
    });

    await this.recordPracticeSkillUsages({
      tenantId: args.tenantId,
      conversationId,
      messageId,
      skills: retrievedSkills,
    });

    this.metrics.incCloneAsk({ scope: 'role' });

    await this.logCloneQuery({
      tenantId: args.tenantId,
      cloneScope: 'role',
      cloneTargetId: args.roleId,
      userId: args.requesterUserId,
      question: args.question,
      answeredGrounded: citations.length > 0,
      refusalReason: null,
    });

    return {
      conversationId,
      messageId,
      text: llmResult.text,
      citations,
      mode: 'clone_style',
      isOwner: false,
    };
  }

  private isCloneV2Enabled(): boolean {
    try {
      return this.cfg.resolveSync<boolean>('clone.v2.enabled', 'CLONE_V2_ENABLED', true);
    } catch {
      return true;
    }
  }

  private async askPersonV2(args: {
    tenantId: string;
    requesterUserId: string;
    personId: string;
    question: string;
    conversationId?: string;
  }): Promise<AskCloneResponseDto> {
    const accessCheck = await this.rbac.canAccessPersonClone({
      tenantId: args.tenantId,
      requesterUserId: args.requesterUserId,
      personId: args.personId,
      cloneV2Enabled: true,
    });
    if (!accessCheck.allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет доступа к клону этого сотрудника. Запросите галочку у админа Org.',
        },
      });
    }

    await this.aiChatQuota.tryConsume({
      tenantId: args.tenantId,
      userId: args.requesterUserId,
    });

    const profile = await this.prisma.skillProfile.findUnique({
      where: { personId: args.personId },
      include: {
        person: {
          select: { id: true, name: true, userId: true, relationship: true },
        },
        traits: {
          where: { status: 'active' },
          orderBy: [{ confidence: 'desc' }, { lastConfirmedAt: 'desc' }],
        },
      },
    });
    if (!profile || profile.status !== 'active') {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'no_clone',
          message:
            'У этого сотрудника пока нет клона — недостаточно встреч с обсуждением «почему я так решил».',
        },
      });
    }
    if (profile.traits.length < ClonesService.MIN_TRAITS_FOR_ANSWER) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'starved_profile',
          message:
            'Клон ещё не сформирован — нужно больше встреч с обсуждениями подхода к решениям.',
        },
      });
    }
    let persona = await this.prisma.executablePersona.findFirst({
      where: { profileId: profile.id, scope: 'person', status: 'active' },
      orderBy: { version: 'desc' },
    });
    if (!persona) {
      persona = await this.personaBuilder.buildForProfile({
        profileId: profile.id,
      });
      if (!persona) {
        throw new NotFoundException({
          ok: false,
          error: {
            code: 'persona_unavailable',
            message:
              'Клон пока недоступен — следующий snapshot собирается каждое воскресенье 06:00.',
          },
        });
      }
    }

    const dialog = await this.runDialogLayer({
      tenantId: args.tenantId,
      userId: args.requesterUserId,
      userMessage: args.question,
      conversationId: args.conversationId ?? null,
      scope: 'clone',
      scopeRefId: profile.id,
    });

    const mode = ClonesService.intentToMode(dialog.intent);

    const enf = this.cfg.knowledgeAccess.enforcement;
    const accessCtx =
      enf !== 'off' && this.accessResolver
        ? await this.accessResolver.resolveAccessibleGroups({
            tenantId: args.tenantId,
            userId: args.requesterUserId,
          })
        : null;
    const subgraph = await this.loadPersonSubgraph({
      tenantId: args.tenantId,
      personId: args.personId,
      question: dialog.standaloneQuestion,
      accessCtx,
      enforcement: enf,
    });

    const retrievedSkillsV2 = await this.retrievePracticeSkills({
      tenantId: args.tenantId,
      scope: 'person',
      scopeRefId: args.personId,
      question: dialog.standaloneQuestion,
      conversationId: args.conversationId ?? null,
    });

    const topicDensity = await this.assertTopicDensity({
      question: dialog.standaloneQuestion,
      reasoningBlocks: subgraph.reasoningBlocks,
      requiredBlocksOverride: null,
      mode,
    });
    if (topicDensity.refused && retrievedSkillsV2.length === 0) {
      return this.persistTopicStarvedRefusal({
        tenantId: args.tenantId,
        requesterUserId: args.requesterUserId,
        scopeRefId: profile.id,
        cloneTargetId: args.personId,
        question: args.question,
        conversationId: args.conversationId,
        persona,
        topicDensity,
        scopeKind: 'person',
        isOwner: profile.person.userId !== null && profile.person.userId === args.requesterUserId,
      });
    }

    const llmResult = await this.callCloneRespond({
      tenantId: args.tenantId,
      persona,
      question: dialog.standaloneQuestion,
      subgraph,
      roleName: null,
      bearerName: profile.person.name,
      mode,
      practiceSkills: toPromptSkills(retrievedSkillsV2),
    });

    const citations = this.parseCitations(llmResult.text, subgraph);

    if (this.isUngrounded(citations, mode, topicDensity.matchedBlocks >= 1)) {
      return this.persistUngroundedRefusal({
        tenantId: args.tenantId,
        requesterUserId: args.requesterUserId,
        scopeRefId: profile.id,
        cloneTargetId: args.personId,
        question: args.question,
        conversationId: args.conversationId,
        persona,
        scopeKind: 'person',
        isOwner: profile.person.userId !== null && profile.person.userId === args.requesterUserId,
        cloneV2: true,
      });
    }

    const finalText =
      mode === 'judgmental' ? ClonesService.stripCitationsFromText(llmResult.text) : llmResult.text;

    const { conversationId, messageId } = await this.persistMessage({
      tenantId: args.tenantId,
      requesterUserId: args.requesterUserId,
      scope: 'card',
      scopeRefId: profile.id,
      question: args.question,
      conversationId: args.conversationId,
      answer: finalText,
      citations,
      llmMeta: {
        model: llmResult.modelUsed,
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens,
        tier: llmResult.tier ?? null,
        personaVersion: persona.version,
        cloneV2: true,
        mode,
        dialogIntent: dialog.intent,
        dialogConfidence: dialog.confidence,
        dialogQueriesCount: dialog.queries.length,
        practiceSkillsCount: retrievedSkillsV2.length,
        usedBlockIds: subgraph.reasoningBlocks.map((b) => b.id),
        usedSkillIds: retrievedSkillsV2.map((s) => s.id),
        usedRegulationNames: [],
        topicMatchedBlocks: topicDensity.matchedBlocks,
        topicTopCosine: topicDensity.topCosine,
      },
    });

    await this.recordPracticeSkillUsages({
      tenantId: args.tenantId,
      conversationId,
      messageId,
      skills: retrievedSkillsV2,
    });

    this.metrics.incCloneAsk({ scope: 'person' });
    if (profile.person.userId && profile.person.userId === args.requesterUserId) {
      this.metrics.incCloneAskByOwner();
    }

    await this.logCloneQuery({
      tenantId: args.tenantId,
      cloneScope: 'person',
      cloneTargetId: args.personId,
      userId: args.requesterUserId,
      question: args.question,
      answeredGrounded: citations.length > 0,
      refusalReason: null,
    });

    return {
      conversationId,
      messageId,
      text: finalText,
      citations,
      mode: 'clone_style',
      isOwner: profile.person.userId !== null && profile.person.userId === args.requesterUserId,
    };
  }

  private async askRoleV2(args: {
    tenantId: string;
    requesterUserId: string;
    roleId: string;
    question: string;
    conversationId?: string;
    roleVersion?: number;
  }): Promise<AskCloneResponseDto> {
    const accessCheck = await this.rbac.canAccessRoleClone({
      tenantId: args.tenantId,
      requesterUserId: args.requesterUserId,
      roleId: args.roleId,
      cloneV2Enabled: true,
    });
    if (!accessCheck.allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет доступа к клону этой роли. Запросите галочку у админа Org.',
        },
      });
    }
    await this.aiChatQuota.tryConsume({
      tenantId: args.tenantId,
      userId: args.requesterUserId,
    });

    const role = await this.prisma.role.findUnique({
      where: { id: args.roleId },
      select: { id: true, name: true, tenantId: true, deletedAt: true },
    });
    if (!role || role.deletedAt || role.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'role_not_found', message: 'Роль не найдена' },
      });
    }

    let persona =
      args.roleVersion != null
        ? await this.prisma.executablePersona.findFirst({
            where: {
              tenantId: args.tenantId,
              scope: 'role',
              scopeRefId: args.roleId,
              roleVersion: args.roleVersion,
              status: { in: ['active', 'frozen'] },
            },
            orderBy: { version: 'desc' },
          })
        : await this.prisma.executablePersona.findFirst({
            where: {
              tenantId: args.tenantId,
              scope: 'role',
              scopeRefId: args.roleId,
              status: 'active',
            },
            orderBy: { version: 'desc' },
          });
    if (!persona && args.roleVersion == null) {
      persona = await this.personaBuilder.buildForRole({
        tenantId: args.tenantId,
        roleId: args.roleId,
      });
    }
    if (!persona) {
      throw new NotFoundException({
        ok: false,
        error: {
          code:
            args.roleVersion != null
              ? 'role_persona_version_not_found'
              : 'role_persona_unavailable',
          message:
            args.roleVersion != null
              ? 'Запрошенная версия клона роли не найдена.'
              : 'Клон роли пока недоступен — нужно больше сотрудников с накопленными профилями.',
        },
      });
    }

    const dialog = await this.runDialogLayer({
      tenantId: args.tenantId,
      userId: args.requesterUserId,
      userMessage: args.question,
      conversationId: args.conversationId ?? null,
      scope: 'clone',
      scopeRefId: args.roleId,
    });

    const mode = ClonesService.intentToMode(dialog.intent);

    const enf = this.cfg.knowledgeAccess.enforcement;
    const accessCtx =
      enf !== 'off' && this.accessResolver
        ? await this.accessResolver.resolveAccessibleGroups({
            tenantId: args.tenantId,
            userId: args.requesterUserId,
          })
        : null;
    const subgraph = await this.loadRoleSubgraph({
      tenantId: args.tenantId,
      roleId: args.roleId,
      question: dialog.standaloneQuestion,
      accessCtx,
      enforcement: enf,
    });

    const retrievedSkillsV2Role = await this.retrievePracticeSkills({
      tenantId: args.tenantId,
      scope: 'role',
      scopeRefId: args.roleId,
      question: dialog.standaloneQuestion,
      conversationId: args.conversationId ?? null,
    });

    const applicableRegulationsV2 = await this.retrieveRoleRegulations({
      tenantId: args.tenantId,
      roleId: args.roleId,
      question: dialog.standaloneQuestion,
    });

    const topicDensity = await this.assertTopicDensity({
      question: dialog.standaloneQuestion,
      reasoningBlocks: subgraph.reasoningBlocks,
      requiredBlocksOverride: null,
      mode,
    });
    if (
      topicDensity.refused &&
      applicableRegulationsV2.length === 0 &&
      retrievedSkillsV2Role.length === 0
    ) {
      return this.persistTopicStarvedRefusal({
        tenantId: args.tenantId,
        requesterUserId: args.requesterUserId,
        scopeRefId: args.roleId,
        cloneTargetId: args.roleId,
        question: args.question,
        conversationId: args.conversationId,
        persona,
        topicDensity,
        scopeKind: 'role',
        isOwner: false,
      });
    }

    const bearerName: string | null =
      persona.publicName ?? `Клон ${role.name} v${persona.roleVersion ?? 1}`;

    const llmResult = await this.callCloneRespond({
      tenantId: args.tenantId,
      persona,
      question: dialog.standaloneQuestion,
      subgraph,
      roleName: role.name,
      bearerName,
      mode,
      practiceSkills: toPromptSkills(retrievedSkillsV2Role),
      applicableRegulations: applicableRegulationsV2,
    });

    const citations = this.parseCitations(llmResult.text, subgraph);

    if (this.isUngrounded(citations, mode, topicDensity.matchedBlocks >= 1)) {
      return this.persistUngroundedRefusal({
        tenantId: args.tenantId,
        requesterUserId: args.requesterUserId,
        scopeRefId: args.roleId,
        cloneTargetId: args.roleId,
        question: args.question,
        conversationId: args.conversationId,
        persona,
        scopeKind: 'role',
        isOwner: false,
        cloneV2: true,
      });
    }

    const finalText =
      mode === 'judgmental' ? ClonesService.stripCitationsFromText(llmResult.text) : llmResult.text;

    const { conversationId, messageId } = await this.persistMessage({
      tenantId: args.tenantId,
      requesterUserId: args.requesterUserId,
      scope: 'card',
      scopeRefId: args.roleId,
      question: args.question,
      conversationId: args.conversationId,
      answer: finalText,
      citations,
      llmMeta: {
        model: llmResult.modelUsed,
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens,
        tier: llmResult.tier ?? null,
        personaVersion: persona.version,
        scopeKind: 'role',
        roleId: args.roleId,
        cloneV2: true,
        mode,
        dialogIntent: dialog.intent,
        dialogConfidence: dialog.confidence,
        dialogQueriesCount: dialog.queries.length,
        practiceSkillsCount: retrievedSkillsV2Role.length,
        usedBlockIds: subgraph.reasoningBlocks.map((b) => b.id),
        usedSkillIds: retrievedSkillsV2Role.map((s) => s.id),
        usedRegulationNames: applicableRegulationsV2.map((r) => r.name),
        topicMatchedBlocks: topicDensity.matchedBlocks,
        topicTopCosine: topicDensity.topCosine,
      },
    });

    await this.recordPracticeSkillUsages({
      tenantId: args.tenantId,
      conversationId,
      messageId,
      skills: retrievedSkillsV2Role,
    });

    this.metrics.incCloneAsk({ scope: 'role' });

    await this.logCloneQuery({
      tenantId: args.tenantId,
      cloneScope: 'role',
      cloneTargetId: args.roleId,
      userId: args.requesterUserId,
      question: args.question,
      answeredGrounded: citations.length > 0,
      refusalReason: null,
    });

    return {
      conversationId,
      messageId,
      text: finalText,
      citations,
      mode: 'clone_style',
      isOwner: false,
    };
  }

  private async retrievePracticeSkills(args: {
    tenantId: string;
    scope: 'person' | 'role' | 'org';
    scopeRefId: string;
    question: string;
    conversationId: string | null;
  }): Promise<
    Array<{ id: string; status: string; trigger: string; steps: unknown; redFlags: unknown }>
  > {
    if (!this.practiceSkills) return [];
    try {
      const skills = await this.practiceSkills.retrieveForCloneRespond(args);
      return skills.map((s) => ({
        id: s.id,
        status: s.status,
        trigger: s.trigger,
        steps: s.steps,
        redFlags: s.redFlags,
      }));
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "clones.retrievePracticeSkills: retrieval упал — продолжаю без skill'ов",
      );
      return [];
    }
  }

  private async retrieveRoleRegulations(args: {
    tenantId: string;
    roleId: string;
    question: string;
  }): Promise<CloneRespondRegulation[]> {
    if (!this.roleRegulations) return [];
    try {
      const rules = await this.roleRegulations.retrieveForRole({
        tenantId: args.tenantId,
        roleId: args.roleId,
        query: args.question,
      });
      return rules.map((r) => ({
        kind: r.kind,
        name: r.name,
        text: r.text,
        severity: r.severity,
        scope: r.scope,
      }));
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'clones.retrieveRoleRegulations: retrieval упал — продолжаю без регламентов',
      );
      return [];
    }
  }

  private async recordPracticeSkillUsages(args: {
    tenantId: string;
    conversationId: string;
    messageId: string;
    skills: ReadonlyArray<{ id: string; status: string }>;
  }): Promise<void> {
    if (!this.practiceSkills || args.skills.length === 0) return;
    try {
      await this.practiceSkills.recordUsages({
        tenantId: args.tenantId,
        conversationId: args.conversationId,
        messageId: args.messageId,
        skills: args.skills,
      });
    } catch (err) {
      this.logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        'clones.recordPracticeSkillUsages: запись skill_usages упала — skip',
      );
    }
  }

  private async runDialogLayer(input: {
    tenantId: string;
    userId: string;
    userMessage: string;
    conversationId: string | null;
    scope: string;
    scopeRefId: string;
  }): Promise<{
    standaloneQuestion: string;
    intent: 'factual' | 'exploratory' | 'analytical' | 'clone_roleplay';
    queries: string[];
    confidence: number;
  }> {
    if (!this.dialog) {
      return {
        standaloneQuestion: input.userMessage,
        intent: 'factual',
        queries: [input.userMessage],
        confidence: 1.0,
      };
    }
    const r = await this.dialog.process({
      tenantId: input.tenantId,
      userId: input.userId,
      userMessage: input.userMessage,
      conversationId: input.conversationId,
      scope: input.scope,
      scopeRefId: input.scopeRefId,
      validAt: null,
    });
    return {
      standaloneQuestion: r.standaloneQuestion,
      intent: narrowToChatIntent(r.intent),
      queries: r.queries,
      confidence: r.confidence,
    };
  }

  private static intentToMode(
    intent: 'factual' | 'exploratory' | 'analytical' | 'clone_roleplay',
  ): 'factual' | 'judgmental' {
    if (intent === 'exploratory' || intent === 'analytical') return 'judgmental';
    return 'factual';
  }

  private static stripCitationsFromText(text: string): string {
    return text
      .replace(/\[BLOCK:[a-zA-Z0-9_-]+(?:\s*[—-][^\]]*)?\]/gu, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  private async persistTopicStarvedRefusal(args: {
    tenantId: string;
    requesterUserId: string;
    scopeRefId: string;
    cloneTargetId: string;
    question: string;
    conversationId: string | undefined;
    persona: ExecutablePersona;
    topicDensity: {
      matchedBlocks: number;
      requiredBlocks: number;
      similarityThreshold: number;
      topCosine?: number | null;
    };
    scopeKind: 'person' | 'role';
    isOwner: boolean;
  }): Promise<AskCloneResponseDto> {
    const refusalText = ClonesService.TOPIC_STARVED_REFUSAL_TEXT;
    const { conversationId, messageId } = await this.persistMessage({
      tenantId: args.tenantId,
      requesterUserId: args.requesterUserId,
      scope: 'card',
      scopeRefId: args.scopeRefId,
      question: args.question,
      conversationId: args.conversationId,
      answer: refusalText,
      citations: [],
      llmMeta: {
        refused: true,
        refusalReason: 'topic_starved',
        personaVersion: args.persona.version,
        cloneV2: true,
        scopeKind: args.scopeKind,
        topicMatchedBlocks: args.topicDensity.matchedBlocks,
        topicRequiredBlocks: args.topicDensity.requiredBlocks,
        topicSimilarityThreshold: args.topicDensity.similarityThreshold,
        topicTopCosine: args.topicDensity.topCosine ?? null,
      },
    });
    this.metrics.incCloneAskRefused({ reason: 'topic_starved' });
    this.metrics.incCloneAsk({ scope: args.scopeKind });
    if (args.isOwner) this.metrics.incCloneAskByOwner();
    await this.logCloneQuery({
      tenantId: args.tenantId,
      cloneScope: args.scopeKind,
      cloneTargetId: args.cloneTargetId,
      userId: args.requesterUserId,
      question: args.question,
      answeredGrounded: false,
      refusalReason: 'topic_starved',
    });
    return {
      conversationId,
      messageId,
      text: refusalText,
      citations: [],
      mode: 'clone_style',
      isOwner: args.isOwner,
      refused: true,
      refusalReason: 'topic_starved',
    };
  }

  private isUngrounded(
    citations: CloneCitationDto[],
    mode: 'factual' | 'judgmental',
    topicMatched: boolean,
  ): boolean {
    if (mode === 'judgmental') return false;
    if (!this.cfg.skill.cloneRespondGroundingEnabled) return false;
    if (citations.length > 0) return false;
    const acceptTopicMatch = this.cfg.resolveSync<boolean>(
      'clone.grounding.accept_topic_match',
      undefined,
      true,
    );
    return !(acceptTopicMatch && topicMatched);
  }

  private async persistUngroundedRefusal(args: {
    tenantId: string;
    requesterUserId: string;
    scopeRefId: string;
    cloneTargetId: string;
    question: string;
    conversationId: string | undefined;
    persona: ExecutablePersona;
    scopeKind: 'person' | 'role';
    isOwner: boolean;
    cloneV2: boolean;
  }): Promise<AskCloneResponseDto> {
    const refusalText = ClonesService.UNGROUNDED_REFUSAL_TEXT;
    const { conversationId, messageId } = await this.persistMessage({
      tenantId: args.tenantId,
      requesterUserId: args.requesterUserId,
      scope: 'card',
      scopeRefId: args.scopeRefId,
      question: args.question,
      conversationId: args.conversationId,
      answer: refusalText,
      citations: [],
      llmMeta: {
        refused: true,
        refusalReason: 'ungrounded',
        personaVersion: args.persona.version,
        scopeKind: args.scopeKind,
        ...(args.scopeKind === 'role' ? { roleId: args.cloneTargetId } : {}),
        ...(args.cloneV2 ? { cloneV2: true } : {}),
      },
    });
    this.metrics.incCloneAskRefused({ reason: 'ungrounded' });
    this.metrics.incCloneAsk({ scope: args.scopeKind });
    if (args.isOwner) this.metrics.incCloneAskByOwner();
    await this.logCloneQuery({
      tenantId: args.tenantId,
      cloneScope: args.scopeKind,
      cloneTargetId: args.cloneTargetId,
      userId: args.requesterUserId,
      question: args.question,
      answeredGrounded: false,
      refusalReason: 'ungrounded',
    });
    return {
      conversationId,
      messageId,
      text: refusalText,
      citations: [],
      mode: 'clone_style',
      isOwner: args.isOwner,
      refused: true,
      refusalReason: 'ungrounded',
    };
  }

  async createCloneConversation(args: {
    tenantId: string;
    requesterUserId: string;
    cloneType: 'person' | 'role';
    cloneRefId: string;
  }): Promise<{ conversationId: string }> {
    const v2 = this.isCloneV2Enabled();
    const access =
      args.cloneType === 'person'
        ? await this.rbac.canAccessPersonClone({
            tenantId: args.tenantId,
            requesterUserId: args.requesterUserId,
            personId: args.cloneRefId,
            cloneV2Enabled: v2,
          })
        : await this.rbac.canAccessRoleClone({
            tenantId: args.tenantId,
            requesterUserId: args.requesterUserId,
            roleId: args.cloneRefId,
            cloneV2Enabled: v2,
          });
    if (!access.allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет доступа к клону',
        },
      });
    }
    await this.assertCloneRefExists(args.tenantId, args.cloneType, args.cloneRefId);
    const created = await this.prisma.chatV2Conversation.create({
      data: {
        tenantId: args.tenantId,
        userId: args.requesterUserId,
        scope: 'card',
        scopeRefId: args.cloneRefId,
        channelKindOrigin: 'web',
      },
      select: { id: true },
    });
    return { conversationId: created.id };
  }

  private async assertCloneRefExists(
    tenantId: string,
    cloneType: 'person' | 'role',
    cloneRefId: string,
  ): Promise<void> {
    if (cloneType === 'role') {
      const role = await this.prisma.role.findFirst({
        where: { id: cloneRefId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!role) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'role_not_found', message: 'Роль не найдена' },
        });
      }
      return;
    }
    const person = await this.prisma.person.findFirst({
      where: { id: cloneRefId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!person) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'person_not_found', message: 'Сотрудник не найден' },
      });
    }
  }

  async listMyCloneConversations(args: {
    tenantId: string;
    requesterUserId: string;
    cloneType: 'person' | 'role';
    cloneRefId: string;
    limit: number;
    cursor?: string;
  }): Promise<CloneConversationsListResponseDto> {
    if (args.cloneType === 'role') {
      const role = await this.prisma.role.findFirst({
        where: { id: args.cloneRefId, tenantId: args.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!role) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'role_not_found', message: 'Роль не найдена' },
        });
      }
    } else {
      const person = await this.prisma.person.findFirst({
        where: { id: args.cloneRefId, tenantId: args.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!person) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'person_not_found', message: 'Сотрудник не найден' },
        });
      }
    }

    const v2 = this.isCloneV2Enabled();
    const access =
      args.cloneType === 'role'
        ? await this.rbac.canAccessRoleClone({
            tenantId: args.tenantId,
            requesterUserId: args.requesterUserId,
            roleId: args.cloneRefId,
            cloneV2Enabled: v2,
          })
        : await this.rbac.canAccessPersonClone({
            tenantId: args.tenantId,
            requesterUserId: args.requesterUserId,
            personId: args.cloneRefId,
            cloneV2Enabled: v2,
          });
    if (!access.allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'clone_access_denied',
          message: 'Нет доступа к диалогам с этим клоном',
        },
      });
    }

    const conversations = await this.prisma.chatV2Conversation.findMany({
      where: {
        tenantId: args.tenantId,
        userId: args.requesterUserId,
        scope: 'card',
        scopeRefId: args.cloneRefId,
        status: 'active',
      },
      orderBy: { updatedAt: 'desc' },
      take: args.limit + 1,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        title: true,
        updatedAt: true,
        createdAt: true,
        _count: { select: { messages: true } },
      },
    });

    const hasMore = conversations.length > args.limit;
    const sliced = hasMore ? conversations.slice(0, args.limit) : conversations;
    const items: CloneConversationListItemDto[] = sliced.map((c) => ({
      id: c.id,
      title: c.title,
      lastMessageAt: c.updatedAt.toISOString(),
      messageCount: c._count.messages,
      createdAt: c.createdAt.toISOString(),
    }));
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]!.id : null;

    return { items, nextCursor };
  }

  async getPersonSkillProfile(args: {
    tenantId: string;
    requesterUserId: string;
    personId: string;
  }): Promise<SkillProfileDto> {
    const access = await this.canAccessPersonClone({
      tenantId: args.tenantId,
      requesterUserId: args.requesterUserId,
      personId: args.personId,
    });
    if (!access.allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет доступа к навыковому профилю этого сотрудника',
        },
      });
    }

    const person = await this.prisma.person.findUnique({
      where: { id: args.personId },
      select: { id: true, name: true, userId: true, tenantId: true },
    });
    if (!person || person.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'person_not_found',
          message: 'Сотрудник не найден',
        },
      });
    }

    const profile = await this.prisma.skillProfile.findUnique({
      where: { personId: args.personId },
      include: {
        traits: {
          where: { status: 'active' },
          orderBy: [{ confidence: 'desc' }, { lastConfirmedAt: 'desc' }],
        },
      },
    });

    if (!profile) {
      return {
        profileId: '',
        personId: person.id,
        personName: person.name,
        status: 'paused_relationship',
        buildVersion: 0,
        lastBuildAt: null,
        isEmpty: true,
        canMarkMisleading: access.relation === 'owner_admin' || access.relation === 'manager',
        isSelf: access.relation === 'self',
        traits: [],
        personaSnapshots: [],
      };
    }

    const personaSnapshots = await this.prisma.executablePersona.findMany({
      where: { profileId: profile.id, scope: 'person' },
      orderBy: { version: 'desc' },
      take: 10,
      select: {
        id: true,
        version: true,
        snapshotAt: true,
        builtFromTraitsCount: true,
        status: true,
      },
    });

    return {
      profileId: profile.id,
      personId: person.id,
      personName: person.name,
      status: profile.status,
      buildVersion: profile.buildVersion,
      lastBuildAt: profile.lastBuildAt?.toISOString() ?? null,
      isEmpty: profile.traits.length === 0,
      canMarkMisleading: access.relation === 'owner_admin' || access.relation === 'manager',
      isSelf: access.relation === 'self',
      traits: profile.traits.map((t) => this.serializeTrait(t)),
      personaSnapshots: personaSnapshots.map((p) => ({
        id: p.id,
        version: p.version,
        snapshotAt: p.snapshotAt.toISOString(),
        builtFromTraitsCount: p.builtFromTraitsCount,
        status: p.status,
      })),
    };
  }

  async getRoleSkillProfile(args: {
    tenantId: string;
    requesterUserId: string;
    roleId: string;
  }): Promise<RoleSkillProfileDto> {
    const allowed = await this.rbac.check({
      userId: args.requesterUserId,
      tenantId: args.tenantId,
      obj: 'role',
      act: 'read',
      resourceOwnerId: null,
    });
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет доступа к роли',
        },
      });
    }

    const role = await this.prisma.role.findUnique({
      where: { id: args.roleId },
      select: { id: true, name: true, tenantId: true, deletedAt: true },
    });
    if (!role || role.deletedAt || role.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'role_not_found', message: 'Роль не найдена' },
      });
    }

    const personRoles = await this.prisma.personRole.findMany({
      where: { tenantId: args.tenantId, roleId: args.roleId, validTo: null },
      select: { personId: true },
      take: 100,
    });
    const personIds = [...new Set(personRoles.map((p) => p.personId))];

    const people: RoleSkillProfileDto['people'] = [];
    const topTraitsMap = new Map<string, { statement: string; count: number }>();

    if (personIds.length > 0) {
      const profiles = await this.prisma.skillProfile.findMany({
        where: {
          tenantId: args.tenantId,
          personId: { in: personIds },
          status: 'active',
        },
        include: {
          person: { select: { id: true, name: true, relationship: true } },
          traits: {
            where: { status: 'active' },
            select: {
              category: true,
              statement: true,
              observationCount: true,
            },
          },
        },
      });
      for (const p of profiles) {
        if (p.person.relationship !== 'employee') continue;
        people.push({
          personId: p.person.id,
          personName: p.person.name,
          activeTraitsCount: p.traits.length,
          profileBuildVersion: p.buildVersion,
        });
        for (const t of p.traits) {
          const key = t.category.toLowerCase();
          const ex = topTraitsMap.get(key);
          if (ex) {
            ex.count += t.observationCount;
          } else {
            topTraitsMap.set(key, {
              statement: t.statement,
              count: t.observationCount,
            });
          }
        }
      }
    }
    const topTraits = [...topTraitsMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([category, v]) => ({
        category,
        statement: v.statement,
        observationCount: v.count,
      }));

    const hasRolePersona =
      (await this.prisma.executablePersona.count({
        where: {
          tenantId: args.tenantId,
          scope: 'role',
          scopeRefId: args.roleId,
          status: 'active',
        },
      })) > 0;

    return {
      roleId: role.id,
      roleName: role.name,
      topTraits,
      people,
      hasRolePersona,
    };
  }

  async listClones(args: {
    tenantId: string;
    requesterUserId: string;
    query: ClonesListQuery;
  }): Promise<ClonesListResponseDto> {
    const allowed = await this.rbac.check({
      userId: args.requesterUserId,
      tenantId: args.tenantId,
      obj: 'role',
      act: 'read',
      resourceOwnerId: null,
    });
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет доступа к списку клонов ролей',
        },
      });
    }

    const { status, q, confidenceMin, page, pageSize } = args.query;

    const allCandidates = await this.prisma.executablePersona.findMany({
      where: {
        tenantId: args.tenantId,
        scope: 'role',
        status,
      },
      orderBy: { snapshotAt: 'desc' },
      select: {
        id: true,
        scopeRefId: true,
        version: true,
        roleVersion: true,
        publicName: true,
        status: true,
        currentBearerPersonId: true,
        builtFromTraitsCount: true,
        snapshotAt: true,
        includedTraitIds: true,
      },
    });

    if (allCandidates.length === 0) {
      return { items: [], total: 0, page, pageSize };
    }

    const roleIds = [
      ...new Set(allCandidates.map((c) => c.scopeRefId).filter((id): id is string => Boolean(id))),
    ];
    const bearerIds = [
      ...new Set(
        allCandidates.map((c) => c.currentBearerPersonId).filter((id): id is string => Boolean(id)),
      ),
    ];

    const [roles, bearers] = await Promise.all([
      roleIds.length > 0
        ? this.prisma.role.findMany({
            where: { id: { in: roleIds }, tenantId: args.tenantId },
            select: {
              id: true,
              name: true,
              departmentId: true,
              department: { select: { id: true, name: true } },
            },
          })
        : Promise.resolve([]),
      bearerIds.length > 0
        ? this.prisma.person.findMany({
            where: { id: { in: bearerIds }, tenantId: args.tenantId },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    const roleById = new Map(roles.map((r) => [r.id, r]));
    const bearerById = new Map(bearers.map((p) => [p.id, p]));

    const qLower = q?.toLowerCase();
    const mapped: CloneListItemDto[] = [];
    for (const c of allCandidates) {
      if (!c.scopeRefId) continue;
      const role = roleById.get(c.scopeRefId);
      if (!role) continue;
      if (qLower && !role.name.toLowerCase().includes(qLower)) continue;

      const confidence = Math.min(1, c.builtFromTraitsCount / 10);
      if (confidenceMin !== undefined && confidence < confidenceMin) continue;

      const bearer = c.currentBearerPersonId ? bearerById.get(c.currentBearerPersonId) : undefined;

      mapped.push({
        personaId: c.id,
        roleId: role.id,
        roleName: role.name,
        departmentName: role.department?.name ?? null,
        departmentId: role.department?.id ?? null,
        version: c.roleVersion ?? 1,
        publicName: c.publicName ?? `Клон ${role.name} v${c.roleVersion ?? 1}`,
        status: c.status as 'active' | 'superseded' | 'pending_rebuild' | 'frozen',
        currentBearer: bearer ? { personId: bearer.id, personName: bearer.name } : null,
        confidence,
        traitsCount: c.includedTraitIds.length,
        lastBuildAt: c.snapshotAt.toISOString(),
      });
    }

    const total = mapped.length;
    const offset = (page - 1) * pageSize;
    const items = mapped.slice(offset, offset + pageSize);

    return { items, total, page, pageSize };
  }

  async getCloneHistory(args: {
    tenantId: string;
    requesterUserId: string;
    roleId: string;
  }): Promise<CloneHistoryResponseDto> {
    const allowed = await this.rbac.check({
      userId: args.requesterUserId,
      tenantId: args.tenantId,
      obj: 'role',
      act: 'read',
      resourceOwnerId: null,
    });
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет доступа к истории клона роли',
        },
      });
    }

    const role = await this.prisma.role.findUnique({
      where: { id: args.roleId },
      select: { id: true, name: true, tenantId: true, deletedAt: true },
    });
    if (!role || role.deletedAt || role.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'role_not_found', message: 'Роль не найдена' },
      });
    }

    const personas = await this.prisma.executablePersona.findMany({
      where: {
        tenantId: args.tenantId,
        scope: 'role',
        scopeRefId: args.roleId,
      },
      orderBy: [{ roleVersion: 'desc' }, { snapshotAt: 'desc' }],
      select: {
        id: true,
        roleVersion: true,
        version: true,
        publicName: true,
        status: true,
        currentBearerPersonId: true,
        builtFromTraitsCount: true,
        snapshotAt: true,
        includedTraitIds: true,
      },
    });

    if (personas.length === 0) {
      return { roleId: role.id, roleName: role.name, versions: [] };
    }

    const byTimeAsc = [...personas].sort((a, b) => a.snapshotAt.getTime() - b.snapshotAt.getTime());
    const validUntilByPersonaId = new Map<string, string | null>();
    for (let i = 0; i < byTimeAsc.length; i += 1) {
      const next = byTimeAsc[i + 1];
      validUntilByPersonaId.set(byTimeAsc[i]!.id, next ? next.snapshotAt.toISOString() : null);
    }

    try {
      this.metrics.setCloneRoleVersionsTotal({
        roleId: args.roleId,
        value: personas.length,
      });
    } catch {}

    const versions: CloneVersionDto[] = personas.map((p) => {
      return {
        personaId: p.id,
        roleId: role.id,
        version: p.roleVersion ?? 1,
        publicName: p.publicName ?? `Клон ${role.name} v${p.roleVersion ?? 1}`,
        status: p.status as 'active' | 'superseded' | 'pending_rebuild' | 'frozen',
        bearer: null,
        validFrom: p.snapshotAt.toISOString(),
        validUntil: validUntilByPersonaId.get(p.id) ?? null,
        confidence: Math.min(1, p.builtFromTraitsCount / 10),
        traitsCount: p.includedTraitIds.length,
      };
    });

    return { roleId: role.id, roleName: role.name, versions };
  }

  async askAllFormers(args: {
    tenantId: string;
    requesterUserId: string;
    roleId: string;
    question: string;
  }): Promise<AskAllFormersResponseDto> {
    const accessCheck = await this.rbac.canAccessRoleClone({
      tenantId: args.tenantId,
      requesterUserId: args.requesterUserId,
      roleId: args.roleId,
      cloneV2Enabled: true,
    });
    if (!accessCheck.allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Нет доступа к клону этой роли.' },
      });
    }
    const role = await this.prisma.role.findUnique({
      where: { id: args.roleId },
      select: { id: true, name: true, tenantId: true, deletedAt: true },
    });
    if (!role || role.deletedAt || role.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'role_not_found', message: 'Роль не найдена' },
      });
    }

    const versions = await this.prisma.executablePersona.findMany({
      where: {
        tenantId: args.tenantId,
        scope: 'role',
        scopeRefId: args.roleId,
        status: { in: ['active', 'frozen'] },
      },
      orderBy: [{ roleVersion: 'desc' }, { snapshotAt: 'desc' }],
      take: 8,
      select: { id: true, roleVersion: true, publicName: true, status: true },
    });

    const answers: AskAllFormersAnswerDto[] = [];
    for (const v of versions) {
      const version = v.roleVersion ?? 1;
      const base = {
        personaId: v.id,
        version,
        publicName: v.publicName ?? `Клон ${role.name} v${version}`,
        status: v.status as 'active' | 'frozen',
      };
      try {
        const response = await this.askRoleV2({
          tenantId: args.tenantId,
          requesterUserId: args.requesterUserId,
          roleId: args.roleId,
          question: args.question,
          roleVersion: v.roleVersion ?? undefined,
        });
        answers.push({ ...base, response, error: null });
      } catch (err) {
        answers.push({
          ...base,
          response: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return {
      roleId: role.id,
      roleName: role.name,
      question: args.question,
      answers,
    };
  }

  async markTraitMisleading(args: {
    tenantId: string;
    requesterUserId: string;
    traitId: string;
    reason: string;
  }): Promise<void> {
    const trait = await this.prisma.skillTrait.findUnique({
      where: { id: args.traitId },
      include: {
        profile: {
          select: { id: true, tenantId: true, personId: true },
        },
      },
    });
    if (!trait || trait.profile.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'trait_not_found', message: 'Черта не найдена' },
      });
    }
    const access = await this.canAccessPersonClone({
      tenantId: args.tenantId,
      requesterUserId: args.requesterUserId,
      personId: trait.profile.personId,
    });
    if (!access.allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет доступа к навыковому профилю этого сотрудника',
        },
      });
    }
    if (access.relation !== 'owner_admin' && access.relation !== 'manager') {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden_self_mark',
          message: 'Пометить черту неверной может только direct manager или admin',
        },
      });
    }
    const reason = (args.reason || '').trim().slice(0, 2_000);
    if (reason.length < 5) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'reason_required',
          message: 'Укажите обоснование (минимум 5 символов)',
        },
      });
    }
    await this.prisma.skillTrait.update({
      where: { id: trait.id },
      data: {
        status: 'misleading',
        misleadingReason: reason,
        misleadingFlaggedByUserId: args.requesterUserId,
        misleadingFlaggedAt: new Date(),
      },
    });
    this.metrics.incSkillTraitsMarkedMisleading({ category: trait.category });
  }

  async triggerManualPersonaSnapshot(args: {
    tenantId: string;
    requesterUserId: string;
    personId: string;
  }): Promise<{
    built: boolean;
    personaId: string | null;
    reason: string | null;
  }> {
    const access = await this.canAccessPersonClone({
      tenantId: args.tenantId,
      requesterUserId: args.requesterUserId,
      personId: args.personId,
    });
    if (!access.allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет доступа к навыковому профилю этого сотрудника',
        },
      });
    }
    if (access.relation !== 'owner_admin' && access.relation !== 'self') {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden_manual_snapshot',
          message: 'Manual snapshot может запросить только сам носитель или admin/owner Org',
        },
      });
    }
    const profile = await this.prisma.skillProfile.findUnique({
      where: { personId: args.personId },
      select: { id: true, tenantId: true },
    });
    if (!profile || profile.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'skill_profile_not_found',
          message: 'Навыковый профиль не найден',
        },
      });
    }
    const result = await this.personaVersioning.triggerRebuild({
      profileId: profile.id,
      reason: 'manual',
      triggerEventAt: new Date(),
      bypassLock: true,
    });
    return result.built
      ? { built: true, personaId: result.personaId, reason: null }
      : { built: false, personaId: null, reason: result.reason };
  }

  private serializeTrait(t: {
    id: string;
    category: string;
    statement: string;
    confidence: 'low' | 'medium' | 'high';
    observationCount: number;
    sourceBlockIds: string[];
    firstObservedAt: Date;
    lastConfirmedAt: Date;
    status: 'active' | 'superseded_by' | 'archived' | 'misleading' | 'pending_verification';
  }): SkillTraitDto {
    return {
      id: t.id,
      category: t.category,
      statement: t.statement,
      confidence: t.confidence,
      observationCount: t.observationCount,
      sourceBlockIds: t.sourceBlockIds,
      firstObservedAt: t.firstObservedAt.toISOString(),
      lastConfirmedAt: t.lastConfirmedAt.toISOString(),
      status: t.status,
    };
  }

  private async canAccessPersonClone(args: {
    tenantId: string;
    requesterUserId: string;
    personId: string;
  }): Promise<{ allowed: boolean; relation: 'owner_admin' | 'self' | 'manager' | 'none' }> {
    const adminAllowed = await this.rbac.check({
      userId: args.requesterUserId,
      tenantId: args.tenantId,
      obj: 'knowledge_profile',
      act: 'read',
      resourceOwnerId: null,
    });
    if (adminAllowed) {
      const ctx = await this.rbac.loadContext(args.requesterUserId, args.tenantId);
      const role = ctx?.isSuperAdmin ? 'owner' : ctx?.role;
      if (role === 'owner' || role === 'admin') {
        return { allowed: true, relation: 'owner_admin' };
      }
    }

    const target = await this.prisma.person.findUnique({
      where: { id: args.personId },
      select: { id: true, userId: true, primaryDepartmentId: true, tenantId: true },
    });
    if (!target || target.tenantId !== args.tenantId) {
      return { allowed: false, relation: 'none' };
    }
    if (target.userId && target.userId === args.requesterUserId) {
      return { allowed: true, relation: 'self' };
    }

    if (target.primaryDepartmentId) {
      const requesterPerson = await this.prisma.person.findFirst({
        where: {
          tenantId: args.tenantId,
          userId: args.requesterUserId,
          deletedAt: null,
        },
        select: { id: true, primaryDepartmentId: true },
      });
      if (requesterPerson?.primaryDepartmentId === target.primaryDepartmentId) {
        const isManager = await this.prisma.membership.findFirst({
          where: {
            orgId: args.tenantId,
            userId: args.requesterUserId,
            role: 'manager',
          },
          select: { id: true },
        });
        if (isManager) return { allowed: true, relation: 'manager' };
      }
    }

    return { allowed: false, relation: 'none' };
  }

  private async loadPersonSubgraph(args: {
    tenantId: string;
    personId: string;
    question: string;
    accessCtx?: KnowledgeAccessContext | null;
    enforcement?: 'off' | 'shadow' | 'enforce';
  }): Promise<CloneSubgraph> {
    const accessCtx = args.accessCtx ?? null;
    const enforcement = args.enforcement ?? 'off';
    const accessEnforce = enforcement === 'enforce' && !!accessCtx && !accessCtx.isBypass;

    const person = await this.prisma.person.findUnique({
      where: { id: args.personId },
      select: {
        id: true,
        entityId: true,
        knowledgeProfile: true,
      },
    });
    if (!person) return emptySubgraph();

    const reasoningBlocks: CloneBlock[] = [];
    if (person.entityId) {
      const mentions = await this.prisma.ideaBlockEntity.findMany({
        where: {
          entityId: person.entityId,
          role: 'subject',
          block: {
            tenantId: args.tenantId,
            status: 'canonical',
            signalType: { in: [...SKILL_SUBJECT_SIGNAL_TYPES] },
            ...(accessEnforce && accessCtx ? this.accessResolver!.buildAccessWhere(accessCtx) : {}),
          },
        },
        select: { blockId: true },
        take: 40,
      });
      const blockIds = [...new Set(mentions.map((m) => m.blockId))];
      if (blockIds.length > 0) {
        const topK = await this.cfg.getDynamic<number>('clone.retrieval.topK', undefined, 20);
        const rankedIds = await this.rankBlockIdsByQuestion(blockIds, args.question, topK);
        const blocks = await this.prisma.ideaBlock.findMany({
          where: { id: { in: rankedIds } },
          select: {
            id: true,
            name: true,
            trustedAnswer: true,
            evidence: {
              select: {
                quote: true,
                rawEventId: true,
                sourceTimestamp: true,
              },
              take: 1,
            },
          },
        });
        const byId = new Map(blocks.map((b) => [b.id, b]));
        for (const id of rankedIds) {
          const b = byId.get(id);
          if (!b) continue;
          const evidence = b.evidence[0];
          reasoningBlocks.push({
            id: b.id,
            text: b.trustedAnswer ?? b.name,
            meetingId: null,
            meetingTitle: null,
            startMs: null,
            endMs: null,
            snippet: evidence?.quote ?? null,
          });
        }
      }
    }

    await this.applyAccessToReasoningBlocks(reasoningBlocks, accessCtx, enforcement);

    const knowledgeProfileSummary = this.serializeKnowledgeProfile(person.knowledgeProfile);

    let decisions = await this.prisma.decision.findMany({
      where: {
        tenantId: args.tenantId,
        deletedAt: null,
        decidedByPersonIds: { has: args.personId },
        status: { notIn: ['rejected', 'cancelled', 'superseded'] },
      },
      select: {
        id: true,
        statement: true,
        rationale: true,
        decidedAt: true,
        sourceBlockIds: true,
      },
      orderBy: { decidedAt: 'desc' },
      take: 10,
    });

    if (
      enforcement !== 'off' &&
      accessCtx &&
      !accessCtx.isBypass &&
      this.accessResolver &&
      decisions.length > 0
    ) {
      const { accessibleIds, denied } = await this.accessResolver.partitionProjectionsByAccess(
        accessCtx,
        decisions.map((d) => ({ id: d.id, sourceBlockIds: d.sourceBlockIds })),
      );
      if (enforcement === 'enforce') {
        decisions = decisions.filter((d) => accessibleIds.has(d.id));
        this.metrics.incAccessDenied({ surface: 'clone' }, denied);
      } else {
        this.metrics.incAccessShadowDiff({ surface: 'clone' }, denied);
      }
    }

    return {
      reasoningBlocks,
      knowledgeProfileSummary,
      decisions: decisions.map((d) => ({
        id: d.id,
        statement: d.statement ?? '',
        rationale: d.rationale,
      })),
    };
  }

  private async loadRoleSubgraph(args: {
    tenantId: string;
    roleId: string;
    question: string;
    accessCtx?: KnowledgeAccessContext | null;
    enforcement?: 'off' | 'shadow' | 'enforce';
  }): Promise<CloneSubgraph> {
    const accessCtx = args.accessCtx ?? null;
    const enforcement = args.enforcement ?? 'off';
    const accessEnforce = enforcement === 'enforce' && !!accessCtx && !accessCtx.isBypass;

    const personRoles = await this.prisma.personRole.findMany({
      where: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        validTo: null,
      },
      select: { personId: true },
      take: 50,
    });
    const personIds = [...new Set(personRoles.map((p) => p.personId))];
    if (personIds.length === 0) return emptySubgraph();

    const persons = await this.prisma.person.findMany({
      where: {
        tenantId: args.tenantId,
        id: { in: personIds },
        relationship: 'employee',
        deletedAt: null,
      },
      select: { id: true, entityId: true },
    });
    const entityIds = persons.map((p) => p.entityId).filter((id): id is string => Boolean(id));

    const topK = await this.cfg.getDynamic<number>('clone.retrieval.topK', undefined, 20);
    let narrowRanked: string[] = [];
    if (entityIds.length > 0) {
      const mentions = await this.prisma.ideaBlockEntity.findMany({
        where: {
          entityId: { in: entityIds },
          role: 'subject',
          block: {
            tenantId: args.tenantId,
            status: 'canonical',
            signalType: { in: [...SKILL_SUBJECT_SIGNAL_TYPES] },
            ...(accessEnforce && accessCtx ? this.accessResolver!.buildAccessWhere(accessCtx) : {}),
          },
        },
        select: { blockId: true },
        take: 60,
      });
      const blockIds = [...new Set(mentions.map((m) => m.blockId))];
      if (blockIds.length > 0) {
        narrowRanked = await this.rankBlockIdsByQuestion(blockIds, args.question, topK);
      }
    }

    const floorEnabled = await this.cfg.getDynamic<boolean>(
      'clone.retrieval.base_recall_floor',
      undefined,
      true,
    );
    const floorIds = floorEnabled
      ? await this.fetchBaseRecallFloor(args.tenantId, args.question, topK)
      : [];
    const fusedIds = this.fuseBlockLists([narrowRanked, floorIds]).slice(0, topK);

    const reasoningBlocks: CloneBlock[] = [];
    if (fusedIds.length > 0) {
      const blocks = await this.prisma.ideaBlock.findMany({
        where: { id: { in: fusedIds } },
        select: {
          id: true,
          name: true,
          trustedAnswer: true,
          evidence: { select: { quote: true }, take: 1 },
        },
      });
      const byId = new Map(blocks.map((b) => [b.id, b]));
      for (const id of fusedIds) {
        const b = byId.get(id);
        if (!b) continue;
        const evidence = b.evidence[0];
        reasoningBlocks.push({
          id: b.id,
          text: b.trustedAnswer ?? b.name,
          meetingId: null,
          meetingTitle: null,
          startMs: null,
          endMs: null,
          snippet: evidence?.quote ?? null,
        });
      }
    }

    await this.applyAccessToReasoningBlocks(reasoningBlocks, accessCtx, enforcement);

    return {
      reasoningBlocks,
      knowledgeProfileSummary: null,
      decisions: [],
    };
  }

  private async applyAccessToReasoningBlocks(
    reasoningBlocks: CloneBlock[],
    accessCtx: KnowledgeAccessContext | null,
    enforcement: 'off' | 'shadow' | 'enforce',
  ): Promise<void> {
    if (
      enforcement === 'off' ||
      !accessCtx ||
      accessCtx.isBypass ||
      !this.accessResolver ||
      reasoningBlocks.length === 0
    ) {
      return;
    }
    const ids = reasoningBlocks.map((b) => b.id);
    const { accessible, denied } = await this.accessResolver.partitionBlockIdsByAccess(
      accessCtx,
      ids,
    );
    if (enforcement === 'enforce') {
      const allow = new Set(accessible);
      let write = 0;
      for (let read = 0; read < reasoningBlocks.length; read++) {
        if (allow.has(reasoningBlocks[read]!.id)) {
          reasoningBlocks[write++] = reasoningBlocks[read]!;
        }
      }
      reasoningBlocks.length = write;
      this.metrics.incAccessDenied({ surface: 'clone' }, denied);
    } else {
      this.metrics.incAccessShadowDiff({ surface: 'clone' }, denied);
    }
  }

  private serializeKnowledgeProfile(raw: Prisma.JsonValue | null): string | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;
    const categoriesRaw = Array.isArray(obj.categories) ? obj.categories : [];
    if (categoriesRaw.length === 0) return null;
    const parts: string[] = [];
    for (const c of categoriesRaw.slice(0, 8)) {
      if (!c || typeof c !== 'object') continue;
      const cat = c as Record<string, unknown>;
      const name = typeof cat.name === 'string' ? cat.name : '';
      const conf = typeof cat.confidence === 'string' ? cat.confidence : 'low';
      if (name) parts.push(`${name} (${conf})`);
    }
    return parts.length > 0 ? parts.join('; ') : null;
  }

  private async assertTopicDensity(args: {
    question: string;
    reasoningBlocks: ReadonlyArray<{ id: string; text: string }>;
    requiredBlocksOverride?: number | null;
    mode?: 'factual' | 'judgmental';
  }): Promise<{
    refused: boolean;
    matchedBlocks: number;
    requiredBlocks: number;
    similarityThreshold: number;
    topCosine: number | null;
  }> {
    const similarityThreshold =
      args.mode === 'judgmental'
        ? await this.cfg.getDynamic<number>(
            'clone.topic.similarityThresholdJudgmental',
            undefined,
            0.33,
          )
        : await this.cfg.getDynamic<number>(
            'clone.topic.similarityThreshold',
            'CLONE_TOPIC_SIMILARITY_THRESHOLD',
            0.5,
          );
    const requiredBlocks =
      args.requiredBlocksOverride !== undefined && args.requiredBlocksOverride !== null
        ? args.requiredBlocksOverride
        : await this.cfg.getDynamic<number>('clone.topic.minBlocks', 'CLONE_TOPIC_MIN_BLOCKS', 2);

    if (requiredBlocks <= 0) {
      return {
        refused: false,
        matchedBlocks: args.reasoningBlocks.length,
        requiredBlocks,
        similarityThreshold,
        topCosine: null,
      };
    }

    if (args.reasoningBlocks.length < requiredBlocks) {
      return {
        refused: true,
        matchedBlocks: 0,
        requiredBlocks,
        similarityThreshold,
        topCosine: null,
      };
    }

    let questionEmbedding: number[] | null;
    try {
      questionEmbedding = await this.embedder.embedQuery(args.question);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'clones.assertTopicDensity: embedQuery упал — пропускаю анти-deepfake проверку',
      );
      return {
        refused: false,
        matchedBlocks: args.reasoningBlocks.length,
        requiredBlocks,
        similarityThreshold,
        topCosine: null,
      };
    }
    if (!questionEmbedding) {
      this.logger.warn(
        'clones.assertTopicDensity: embedQuery вернул null — пропускаю анти-deepfake проверку',
      );
      return {
        refused: false,
        matchedBlocks: args.reasoningBlocks.length,
        requiredBlocks,
        similarityThreshold,
        topCosine: null,
      };
    }

    const blockEmbeddings = await this.loadBlockEmbeddings(args.reasoningBlocks.map((b) => b.id));

    let matched = 0;
    let topCosine: number | null = null;
    for (const block of args.reasoningBlocks) {
      const vec = blockEmbeddings.get(block.id);
      if (!vec) continue;
      const sim = cosineSim(questionEmbedding, vec);
      if (topCosine === null || sim > topCosine) topCosine = sim;
      if (sim >= similarityThreshold) matched += 1;
    }

    return {
      refused: matched < requiredBlocks,
      matchedBlocks: matched,
      requiredBlocks,
      similarityThreshold,
      topCosine,
    };
  }

  private async loadBlockEmbeddings(blockIds: string[]): Promise<Map<string, number[]>> {
    if (blockIds.length === 0) return new Map();
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ id: string; emb: string | null }>
      >`SELECT "id", "embedding"::text AS "emb" FROM "IdeaBlock" WHERE "id" IN (${Prisma.join(blockIds)}) AND "embedding" IS NOT NULL`;
      const map = new Map<string, number[]>();
      for (const r of rows) {
        if (!r.emb) continue;
        const inner = r.emb.replace(/^\[|\]$/g, '');
        if (!inner) continue;
        const vec = inner.split(',').map((s) => Number(s));
        if (vec.every((n) => Number.isFinite(n))) {
          map.set(r.id, vec);
        }
      }
      return map;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'clones.loadBlockEmbeddings: упал — fallback на пустую мапу (консервативно)',
      );
      return new Map();
    }
  }

  private async rankBlockIdsByQuestion(
    candidateIds: string[],
    question: string,
    topK: number,
  ): Promise<string[]> {
    if (candidateIds.length === 0) return [];
    let qvec: number[] | null;
    try {
      qvec = await this.embedder.embedQuery(question);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'clones.rankBlockIdsByQuestion: embedQuery упал — fallback на исходный порядок',
      );
      return candidateIds.slice(0, topK);
    }
    if (!qvec || qvec.length === 0 || !qvec.every((n) => Number.isFinite(n))) {
      return candidateIds.slice(0, topK);
    }
    try {
      const literal = `[${qvec.join(',')}]`;
      const params: unknown[] = [literal, ...candidateIds];
      const placeholders = candidateIds.map((_, i) => `$${i + 2}`).join(',');
      const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "IdeaBlock"
         WHERE "id" IN (${placeholders}) AND "embedding" IS NOT NULL
         ORDER BY "embedding" <=> $1::vector
         LIMIT ${Math.max(1, Math.floor(topK))}`,
        ...params,
      );
      const ranked = rows.map((r) => r.id);
      if (ranked.length >= topK) return ranked;
      const seen = new Set(ranked);
      for (const id of candidateIds) {
        if (ranked.length >= topK) break;
        if (!seen.has(id)) ranked.push(id);
      }
      return ranked;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'clones.rankBlockIdsByQuestion: pgvector-ранжирование упало — fallback на исходный порядок',
      );
      return candidateIds.slice(0, topK);
    }
  }

  private async fetchBaseRecallFloor(
    tenantId: string,
    question: string,
    topK: number,
  ): Promise<string[]> {
    const trimmed = (question ?? '').trim();
    if (!trimmed) return [];
    let qvec: number[] | null;
    try {
      qvec = await this.embedder.embedQuery(trimmed);
    } catch {
      return [];
    }
    if (!qvec || qvec.length === 0 || !qvec.every((n) => Number.isFinite(n))) return [];
    try {
      const literal = `[${qvec.join(',')}]`;
      const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "IdeaBlock"
         WHERE "tenantId" = $2 AND "status"::text = 'canonical' AND "embedding" IS NOT NULL
         ORDER BY "embedding" <=> $1::vector
         LIMIT ${Math.max(1, Math.floor(topK))}`,
        literal,
        tenantId,
      );
      return rows.map((r) => r.id);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'clones.fetchBaseRecallFloor: pgvector-поиск упал — fail-open (без floor)',
      );
      return [];
    }
  }

  private fuseBlockLists(lists: ReadonlyArray<ReadonlyArray<string>>, rrfK = 60): string[] {
    const score = new Map<string, number>();
    for (const list of lists) {
      for (let rank = 0; rank < list.length; rank++) {
        const id = list[rank]!;
        score.set(id, (score.get(id) ?? 0) + 1 / (rrfK + rank + 1));
      }
    }
    return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }

  private async callCloneRespond(args: {
    tenantId: string;
    persona: ExecutablePersona;
    question: string;
    subgraph: CloneSubgraph;
    roleName: string | null;
    bearerName: string | null;
    mode?: 'factual' | 'judgmental';
    practiceSkills?: ReadonlyArray<CloneRespondPracticeSkill>;
    applicableRegulations?: ReadonlyArray<CloneRespondRegulation>;
  }): Promise<LlmCallResult> {
    const mode = args.mode ?? 'factual';
    const systemPrompt = buildCloneRespondSystemPrompt({ mode });
    return this.llm.call({
      taskType: 'clone-respond',
      systemPrompt,
      userMessage: CLONE_RESPOND_USER_TEMPLATE({
        question: args.question,
        roleName: args.roleName,
        bearerName: args.bearerName,
        personaPrompt: args.persona.personaPrompt,
        subgraph: {
          reasoningBlocks: args.subgraph.reasoningBlocks.map((b) => ({
            id: b.id,
            text: b.text,
          })),
          knowledgeProfileSummary: args.subgraph.knowledgeProfileSummary,
          decisions: args.subgraph.decisions,
        },
        practiceSkills: args.practiceSkills,
        applicableRegulations: args.applicableRegulations,
      }),
      tenantId: args.tenantId,
      sourceRef: { type: 'executable_persona', id: args.persona.id },
      dataClass: 'internal',
    });
  }

  private parseCitations(answerText: string, subgraph: CloneSubgraph): CloneCitationDto[] {
    const blockMap = new Map<string, CloneBlock>(subgraph.reasoningBlocks.map((b) => [b.id, b]));
    const decisionMap = new Map<
      string,
      { id: string; statement: string; rationale: string | null }
    >(subgraph.decisions.map((d) => [d.id, d]));
    const seen = new Set<string>();
    const out: CloneCitationDto[] = [];

    const blockRegex = /\[BLOCK:([a-zA-Z0-9_-]+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = blockRegex.exec(answerText)) !== null) {
      const id = m[1];
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      const b = blockMap.get(id);
      if (!b) continue;
      out.push({
        blockId: b.id,
        meetingId: b.meetingId ?? undefined,
        meetingTitle: b.meetingTitle ?? undefined,
        startMs: b.startMs ?? undefined,
        endMs: b.endMs ?? undefined,
        snippet: b.snippet ?? undefined,
      });
    }

    const decisionRegex = /\[DECISION:([a-zA-Z0-9_-]+)\]/g;
    while ((m = decisionRegex.exec(answerText)) !== null) {
      const id = m[1];
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      const d = decisionMap.get(id);
      if (!d) continue;
      out.push({
        blockId: id,
        snippet: d.statement ?? undefined,
      });
    }

    return out;
  }

  private async persistMessage(args: {
    tenantId: string;
    requesterUserId: string;
    scope: 'card' | 'personal';
    scopeRefId: string;
    question: string;
    conversationId?: string;
    answer: string;
    citations: CloneCitationDto[];
    llmMeta: Record<string, unknown>;
  }): Promise<{ conversationId: string; messageId: string }> {
    let conversationId: string;
    if (args.conversationId) {
      const existing = await this.prisma.chatV2Conversation.findFirst({
        where: {
          id: args.conversationId,
          tenantId: args.tenantId,
          userId: args.requesterUserId,
        },
        select: { id: true },
      });
      if (!existing) {
        throw new NotFoundException({
          ok: false,
          error: {
            code: 'conversation_not_found',
            message: 'Диалог не найден',
          },
        });
      }
      conversationId = existing.id;
    } else {
      const created = await this.prisma.chatV2Conversation.create({
        data: {
          tenantId: args.tenantId,
          userId: args.requesterUserId,
          scope: args.scope,
          scopeRefId: args.scopeRefId,
          channelKindOrigin: 'web',
        },
      });
      conversationId = created.id;
    }

    await this.prisma.chatV2Message.create({
      data: {
        conversationId,
        role: 'user',
        text: args.question.slice(0, 4_000),
      },
    });
    const assistantMessage = await this.prisma.chatV2Message.create({
      data: {
        conversationId,
        role: 'assistant',
        mode: 'clone_style',
        text: args.answer,
        citations:
          args.citations.length > 0
            ? (args.citations as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        llmMeta: args.llmMeta as Prisma.InputJsonValue,
      },
    });
    return { conversationId, messageId: assistantMessage.id };
  }

  private async logCloneQuery(args: {
    tenantId: string;
    cloneScope: 'person' | 'role';
    cloneTargetId: string;
    userId: string;
    question: string;
    answeredGrounded: boolean;
    refusalReason?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.cloneQueryLog.create({
        data: {
          tenantId: args.tenantId,
          cloneScope: args.cloneScope,
          cloneTargetId: args.cloneTargetId,
          userId: args.userId,
          questionPreview: args.question.slice(0, 200),
          questionHash: createHash('sha256').update(args.question).digest('hex'),
          answeredGrounded: args.answeredGrounded,
          refusalReason: args.refusalReason ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'clones.logCloneQuery: запись журнала упала — ответ клона не задет',
      );
    }
  }

  async getCloneImpactSummary(args: { tenantId: string; userId: string }): Promise<{
    totalAsked: number;
    answeredGroundedCount: number;
    refusedCount: number;
    recentQuestions: Array<{ questionPreview: string; createdAt: string; answeredGrounded: boolean }>;
  }> {
    const person = await this.prisma.person.findFirst({
      where: { tenantId: args.tenantId, userId: args.userId, deletedAt: null },
      select: { id: true },
    });
    if (!person) {
      return { totalAsked: 0, answeredGroundedCount: 0, refusedCount: 0, recentQuestions: [] };
    }

    const where = {
      tenantId: args.tenantId,
      cloneScope: 'person' as const,
      cloneTargetId: person.id,
    };
    const [grouped, recent] = await Promise.all([
      this.prisma.cloneQueryLog.groupBy({
        by: ['answeredGrounded'],
        where,
        _count: { _all: true },
      }),
      this.prisma.cloneQueryLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { questionPreview: true, createdAt: true, answeredGrounded: true },
      }),
    ]);
    let answeredGroundedCount = 0;
    let refusedCount = 0;
    for (const g of grouped) {
      if (g.answeredGrounded) answeredGroundedCount += g._count._all;
      else refusedCount += g._count._all;
    }
    return {
      totalAsked: answeredGroundedCount + refusedCount,
      answeredGroundedCount,
      refusedCount,
      recentQuestions: recent.map((r) => ({
        questionPreview: r.questionPreview,
        createdAt: r.createdAt.toISOString(),
        answeredGrounded: r.answeredGrounded,
      })),
    };
  }

  async listQueryLog(args: {
    tenantId: string;
    cloneTargetId?: string;
    limit: number;
    offset: number;
  }): Promise<CloneQueryLogListResponseDto> {
    const where = {
      tenantId: args.tenantId,
      ...(args.cloneTargetId ? { cloneTargetId: args.cloneTargetId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.cloneQueryLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: args.limit,
        skip: args.offset,
      }),
      this.prisma.cloneQueryLog.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        cloneScope: r.cloneScope,
        cloneTargetId: r.cloneTargetId,
        userId: r.userId,
        questionPreview: r.questionPreview,
        answeredGrounded: r.answeredGrounded,
        refusalReason: r.refusalReason,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
    };
  }
}

interface CloneBlock {
  id: string;
  text: string;
  meetingId: string | null;
  meetingTitle: string | null;
  startMs: number | null;
  endMs: number | null;
  snippet: string | null;
}

export interface CloneSubgraph {
  reasoningBlocks: CloneBlock[];
  knowledgeProfileSummary: string | null;
  decisions: Array<{ id: string; statement: string; rationale: string | null }>;
}

function emptySubgraph(): CloneSubgraph {
  return {
    reasoningBlocks: [],
    knowledgeProfileSummary: null,
    decisions: [],
  };
}

function toPromptSkills(
  retrieved: ReadonlyArray<{
    trigger: string;
    steps: unknown;
    redFlags: unknown;
  }>,
): CloneRespondPracticeSkill[] {
  if (retrieved.length === 0) return [];
  const out: CloneRespondPracticeSkill[] = [];
  for (const s of retrieved) {
    const stepsArr = Array.isArray(s.steps) ? s.steps : [];
    const steps = stepsArr
      .filter((st): st is Record<string, unknown> => !!st && typeof st === 'object')
      .map((st, i) => {
        const order = typeof st.order === 'number' && Number.isInteger(st.order) ? st.order : i + 1;
        const action = typeof st.action === 'string' ? st.action : '';
        const er = typeof st.emotionalRegister === 'string' ? st.emotionalRegister : null;
        return { order, action, emotionalRegister: er };
      })
      .filter((st) => st.action.length > 0);
    if (steps.length === 0) continue;
    const flags = Array.isArray(s.redFlags)
      ? (s.redFlags as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
    out.push({
      trigger: typeof s.trigger === 'string' ? s.trigger : '',
      steps,
      redFlags: flags,
    });
  }
  return out;
}

function cosineSim(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
