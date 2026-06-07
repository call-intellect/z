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
import {
  type LlmCallResult,
  LlmRouterService,
} from '../../ai/services/llm-router.service';
import { DialogService } from '../../dialog-layer/services/dialog.service';
import { narrowToChatIntent } from '../../dialog-layer/services/query-classifier.service';
import {
  CLONE_RESPOND_USER_TEMPLATE,
  type CloneRespondPracticeSkill,
  buildCloneRespondSystemPrompt,
} from '../../knowledge-core/prompts/clone-respond.prompt';
import { KnowledgeEmbeddingService } from '../../knowledge-core/services/embedding.service';
import { ExecutablePersonaBuildService } from '../../knowledge-core/services/executable-persona-build.service';
import { ExecutablePersonaVersioningService } from '../../knowledge-core/services/executable-persona-versioning.service';
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
  AskCloneResponseDto,
  CloneCitationDto,
  CloneHistoryResponseDto,
  CloneListItemDto,
  ClonesListQuery,
  ClonesListResponseDto,
  CloneVersionDto,
  RoleSkillProfileDto,
  SkillProfileDto,
  SkillTraitDto,
} from '../dto/clones.dto';

/**
 * SBA γ-1 — ClonesService (Clone API).
 *
 * Главные методы:
 *   - askPerson — ответ в стиле конкретного сотрудника.
 *   - askRole   — ответ в стиле роли (агрегат по employee'ям этой роли).
 *
 * Контракт:
 *   - RBAC: owner/admin Org / сам носитель / direct manager.
 *   - Rate limit: единая per-user квота `AiChatQuotaService` (50/20 в день,
 *     общая для Concierge + Clones) — ТЗ 2026-05-31. Старый ключ
 *     `cfg.skill.cloneAskPerUserPerDay` оставлен как code-fallback в env.schema,
 *     но в сервисе больше не читается.
 *   - Retrieval: subject-блоки + knowledgeProfile + relevant decisions.
 *   - LLM call: clone-respond с persona prompt в system.
 *   - Запись в ChatV2Conversation (mode='clone_style').
 */
@Injectable()
export class ClonesService {
  private readonly logger = new Logger(ClonesService.name);

  /** Минимум traits в SkillProfile для ответа клона. */
  private static readonly MIN_TRAITS_FOR_ANSWER = 3;

  /**
   * Фаза 1 clone-reliability-hardening — точная формулировка отказа клона,
   * когда в его памяти нет достаточного количества рассуждений по теме
   * вопроса. Совпадает с пунктом 6 промпта `clone-respond.prompt.ts` —
   * фронту удобно различать «программный отказ» и «модель сказала что-то
   * похожее». Текст менять только в паре с тестами/документацией.
   */
  static readonly TOPIC_STARVED_REFUSAL_TEXT =
    'У оригинала недостаточно высказываний по этой теме, чтобы я мог отвечать в его стиле без выдумывания. Спроси напрямую.';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    /**
     * ТЗ 2026-05-31 — единая per-user квота AI-чата (Concierge + Clones).
     * Используется в `askPerson` / `askRole` / `askPersonV2` / `askRoleV2`
     * вместо приватного `assertRateLimit` (удалён). `AiChatQuotaModule`
     * подключён `@Global`, явный import в `ClonesModule` не требуется.
     */
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
    /**
     * Ф5 knowledge-access-groups (R8) — резолв групп СПРАШИВАЮЩЕГО для
     * фильтра контекста клона. `@Optional()` сохраняет совместимость с
     * unit-тестами, конструирующими ClonesService без этого аргумента
     * (при отсутствии резолвера фильтр пропускается — поведение = off).
     * В рантайме сервис всегда доступен из `@Global RbacModule`.
     */
    @Optional()
    @Inject(KnowledgeAccessResolver)
    private readonly accessResolver: KnowledgeAccessResolver | null = null,
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder: KnowledgeEmbeddingService,
    /**
     * ТЗ 2026-05-25 §9.4.3 (clone-respond эволюция, Фаза 7) — dialog-layer
     * фасад. `@Optional()` — фича работает за флагом `CLONE_V2_ENABLED`;
     * существующие unit-тесты, мокающие конструктор `ClonesService` без
     * 11-го аргумента, остаются совместимыми.
     */
    @Optional()
    @Inject(DialogService)
    private readonly dialog: DialogService | null = null,
    /**
     * Agents v2 Фаза C1 (2026-05-30) — PracticeSkill retrieval. `@Optional` —
     * до включения `PRACTICE_SKILLS_ENABLED` и для unit-тестов, конструирующих
     * ClonesService без 12-го аргумента. При отсутствии сервиса retrieval
     * пропускается (skill'ы не подмешиваются в промпт).
     */
    @Optional()
    @Inject(PracticeSkillRetrievalService)
    private readonly practiceSkills: PracticeSkillRetrievalService | null = null,
  ) {}

  /**
   * Ответ в стиле конкретного сотрудника.
   *
   * ТЗ 2026-05-25 §9 (clone-respond эволюция, Фаза 7) — при включённом
   * `CLONE_V2_ENABLED` маршрутизация переключается на `askPersonV2`
   * (dialog-layer + два режима + RBAC через `CloneAccessGrant`).
   * Legacy-путь сохранён ниже как есть.
   *
   * ТЗ 2026-05-31 — rate limit перенесён с приватного `assertRateLimit`
   * (Redis-only) на `AiChatQuotaService.tryConsume({ tenantId, userId })` —
   * единую per-user квоту AI-чата (Concierge + Clones).
   */
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
    // 1. Проверка RBAC.
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

    // 2. Rate limit.
    // ТЗ 2026-05-31 — единая per-user квота AI-чата (`AiChatQuotaService`).
    // Бросает `QuotaExceededError` (429 + retryAfterSeconds) на превышении.
    await this.aiChatQuota.tryConsume({
      tenantId: args.tenantId,
      userId: args.requesterUserId,
    });

    // 3. Найти SkillProfile + active traits.
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

    // 4. Найти / собрать active ExecutablePersona.
    let persona = await this.prisma.executablePersona.findFirst({
      where: {
        profileId: profile.id,
        scope: 'person',
        status: 'active',
      },
      orderBy: { version: 'desc' },
    });
    if (!persona) {
      // on-demand build.
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

    // 5. Retrieval subgraph.
    // Ф5 knowledge-access (R8) — резолв групп СПРАШИВАЮЩЕГО (при off → null,
    // фильтр не применяется; контекст клона байт-в-байт).
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
      accessCtx,
      enforcement: enf,
    });

    // 5.5. Программный анти-deepfake: плотность рассуждений по теме вопроса.
    // Если в reasoning-блоках сотрудника < cloneTopicMinBlocks с
    // косинусной близостью к вопросу ≥ cloneTopicSimilarityThreshold —
    // НЕ зовём модель, отдаём готовый отказ. Защита перенесена в код,
    // чтобы не зависеть от того, послушает ли модель пункт 6 промпта.
    const topicDensity = await this.assertTopicDensity({
      question: args.question,
      reasoningBlocks: subgraph.reasoningBlocks,
    });
    if (topicDensity.refused) {
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
        },
      });

      this.metrics.incCloneAskRefused({ reason: 'topic_starved' });
      this.metrics.incCloneAsk({ scope: 'person' });
      if (
        profile.person.userId &&
        profile.person.userId === args.requesterUserId
      ) {
        this.metrics.incCloneAskByOwner();
      }

      return {
        conversationId,
        messageId,
        text: refusalText,
        citations: [],
        mode: 'clone_style',
        isOwner:
          profile.person.userId !== null &&
          profile.person.userId === args.requesterUserId,
        refused: true,
        refusalReason: 'topic_starved',
      };
    }

    // 6. Agents v2 Фаза C1 — PracticeSkill retrieval (за флагом
    //    PRACTICE_SKILLS_ENABLED; @Optional сервис безопасно молчит).
    const retrievedSkills = await this.retrievePracticeSkills({
      tenantId: args.tenantId,
      scope: 'person',
      scopeRefId: args.personId,
      question: args.question,
      conversationId: args.conversationId ?? null,
    });

    // 7. LLM clone-respond.
    // Clones=Roles Фаза 6 — у person-scope askPerson нет «должности», поэтому
    // roleName = null (промпт подставит дефолт «сотрудника»), bearerName =
    // имя самого носителя профиля.
    const llmResult = await this.callCloneRespond({
      tenantId: args.tenantId,
      persona,
      question: args.question,
      subgraph,
      roleName: null,
      bearerName: profile.person.name,
      practiceSkills: toPromptSkills(retrievedSkills),
    });

    // 8. Распарсить цитаты.
    const citations = this.parseCitations(llmResult.text, subgraph);

    // 9. ChatV2Conversation + Message.
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
      },
    });

    // 10. SkillUsage log (Agents v2 Фаза C1).
    await this.recordPracticeSkillUsages({
      tenantId: args.tenantId,
      conversationId,
      messageId,
      skills: retrievedSkills,
    });

    // 11. Метрики.
    this.metrics.incCloneAsk({ scope: 'person' });
    if (
      profile.person.userId &&
      profile.person.userId === args.requesterUserId
    ) {
      this.metrics.incCloneAskByOwner();
    }

    return {
      conversationId,
      messageId,
      text: llmResult.text,
      citations,
      mode: 'clone_style',
      isOwner:
        profile.person.userId !== null &&
        profile.person.userId === args.requesterUserId,
    };
  }

  /**
   * Ответ в стиле роли (агрегат по employee'ям этой роли).
   *
   * ТЗ 2026-05-25 §9 (Фаза 7) — при `CLONE_V2_ENABLED` маршрутизация на
   * `askRoleV2` (dialog-layer + два режима + CloneAccessGrant).
   *
   * ТЗ 2026-05-31 — rate limit перенесён с приватного `assertRateLimit`
   * (Redis-only) на `AiChatQuotaService.tryConsume({ tenantId, userId })` —
   * единую per-user квоту AI-чата (Concierge + Clones).
   */
  async askRole(args: {
    tenantId: string;
    requesterUserId: string;
    roleId: string;
    question: string;
    conversationId?: string;
  }): Promise<AskCloneResponseDto> {
    if (this.isCloneV2Enabled()) {
      return this.askRoleV2(args);
    }
    // 1. RBAC: read на Role + read на ≥ одну skill_profile внутри Org → admin/owner.
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

    // 2. Rate limit.
    // ТЗ 2026-05-31 — единая per-user квота AI-чата (`AiChatQuotaService`).
    // Бросает `QuotaExceededError` (429 + retryAfterSeconds) на превышении.
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

    // 3. Active role-persona.
    let persona = await this.prisma.executablePersona.findFirst({
      where: {
        tenantId: args.tenantId,
        scope: 'role',
        scopeRefId: args.roleId,
        status: 'active',
      },
      orderBy: { version: 'desc' },
    });
    if (!persona) {
      persona = await this.personaBuilder.buildForRole({
        tenantId: args.tenantId,
        roleId: args.roleId,
      });
      if (!persona) {
        throw new NotFoundException({
          ok: false,
          error: {
            code: 'role_persona_unavailable',
            message:
              'Клон роли пока недоступен — нужно больше сотрудников с накопленными профилями.',
          },
        });
      }
    }

    // 4. Retrieval — top reasoning от всех employee'ев этой роли.
    // Ф5 knowledge-access (R8) — резолв групп СПРАШИВАЮЩЕГО (off → null).
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
      accessCtx,
      enforcement: enf,
    });

    // 4.5. Программный анти-deepfake: плотность рассуждений по теме вопроса.
    // Для роли «тема» агрегируется — нам важно, чтобы среди reasoning-блоков
    // любого из сотрудников роли нашлось ≥ cloneTopicMinBlocks по теме.
    const topicDensity = await this.assertTopicDensity({
      question: args.question,
      reasoningBlocks: subgraph.reasoningBlocks,
    });
    if (topicDensity.refused) {
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

    // 5. LLM call.
    // Clones=Roles Фаза 6 — подставляем roleName из Role.name и bearerName
    // из текущего носителя `ExecutablePersona.currentBearerPersonId`. Если
    // bearer не зафиксирован — null (промпт подставит дефолт).
    let bearerName: string | null = null;
    if (persona.currentBearerPersonId) {
      const bearer = await this.prisma.person.findUnique({
        where: { id: persona.currentBearerPersonId },
        select: { name: true, tenantId: true },
      });
      if (bearer && bearer.tenantId === args.tenantId) {
        bearerName = bearer.name;
      }
    }

    // Agents v2 Фаза C1 — PracticeSkill retrieval (scope='role').
    const retrievedSkills = await this.retrievePracticeSkills({
      tenantId: args.tenantId,
      scope: 'role',
      scopeRefId: args.roleId,
      question: args.question,
      conversationId: args.conversationId ?? null,
    });

    const llmResult = await this.callCloneRespond({
      tenantId: args.tenantId,
      persona,
      question: args.question,
      subgraph,
      roleName: role.name,
      bearerName,
      practiceSkills: toPromptSkills(retrievedSkills),
    });

    const citations = this.parseCitations(llmResult.text, subgraph);

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
      },
    });

    await this.recordPracticeSkillUsages({
      tenantId: args.tenantId,
      conversationId,
      messageId,
      skills: retrievedSkills,
    });

    this.metrics.incCloneAsk({ scope: 'role' });

    return {
      conversationId,
      messageId,
      text: llmResult.text,
      citations,
      mode: 'clone_style',
      isOwner: false,
    };
  }

  /**
   * Defensive чтение `cfg.cloneV2.enabled` — старые unit-тесты передают мок
   * cfg, в котором этой группы может не быть. В таком случае считаем V2
   * отключённым (legacy path), что соответствует defaults в env.schema
   * (CLONE_V2_ENABLED=false).
   */
  private isCloneV2Enabled(): boolean {
    try {
      return this.cfg.cloneV2?.enabled === true;
    } catch {
      return false;
    }
  }

  // ─────────────────────── Clone V2 (ТЗ 2026-05-25 §9, Фаза 7) ───────────────────────

  /**
   * ТЗ 2026-05-25 §9 — новый путь `askPerson` под `CLONE_V2_ENABLED`.
   *
   * Отличия от legacy:
   *  - RBAC ТОЛЬКО через `CloneAccessGrant` (галочка админа), legacy-исключения
   *    отключены (носитель свой клон по умолчанию не видит).
   *  - Перед LLM запускается полный `DialogService.process()` (5-шаговый
   *    pipeline с памятью диалога: contextualize → confidence → classify →
   *    multi-query → cache).
   *  - intent (`factual` | `exploratory|analytical` → `judgmental`) выбирает
   *    режим ответа: temperature, порог topic-density, набор правил в промпте,
   *    политика цитат.
   *  - При `dialog-classify.intent='clone_roleplay'` режим — factual.
   *  - При cache-hit dialog-layer'а — возвращаем cachedAnswer без LLM-вызова.
   */
  private async askPersonV2(args: {
    tenantId: string;
    requesterUserId: string;
    personId: string;
    question: string;
    conversationId?: string;
  }): Promise<AskCloneResponseDto> {
    // 1. RBAC через RbacService.canAccessPersonClone(cloneV2Enabled=true).
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
          message:
            'Нет доступа к клону этого сотрудника. Запросите галочку у админа Org.',
        },
      });
    }

    // 2. Rate limit (общий с legacy).
    // ТЗ 2026-05-31 — единая per-user квота AI-чата (`AiChatQuotaService`).
    // Бросает `QuotaExceededError` (429 + retryAfterSeconds) на превышении.
    await this.aiChatQuota.tryConsume({
      tenantId: args.tenantId,
      userId: args.requesterUserId,
    });

    // 3. SkillProfile + persona (логика идентична legacy — переиспользуем).
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

    // 4. dialog-layer.
    const dialog = await this.runDialogLayer({
      tenantId: args.tenantId,
      userId: args.requesterUserId,
      userMessage: args.question,
      conversationId: args.conversationId ?? null,
      scope: 'clone',
      scopeRefId: profile.id,
    });

    // 5. Mode = factual / judgmental.
    const mode = ClonesService.intentToMode(dialog.intent);

    // 6. Subgraph retrieval (как в legacy).
    // Ф5 knowledge-access (R8) — резолв групп СПРАШИВАЮЩЕГО (off → null).
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
      accessCtx,
      enforcement: enf,
    });

    // 7. Topic-density guard (порог зависит от mode).
    const requiredBlocksOverride =
      mode === 'judgmental'
        ? Math.max(1, Math.floor(this.cfg.skill.cloneTopicMinBlocks / 2))
        : null;
    const topicDensity = await this.assertTopicDensity({
      question: dialog.standaloneQuestion,
      reasoningBlocks: subgraph.reasoningBlocks,
      requiredBlocksOverride,
    });
    if (topicDensity.refused) {
      return this.persistTopicStarvedRefusal({
        tenantId: args.tenantId,
        requesterUserId: args.requesterUserId,
        scopeRefId: profile.id,
        question: args.question,
        conversationId: args.conversationId,
        persona,
        topicDensity,
        scopeKind: 'person',
        isOwner:
          profile.person.userId !== null &&
          profile.person.userId === args.requesterUserId,
      });
    }

    // 8a. Agents v2 Фаза C1 — PracticeSkill retrieval (используем standalone
    //     question после dialog-layer'а, чтобы embed был чище).
    const retrievedSkillsV2 = await this.retrievePracticeSkills({
      tenantId: args.tenantId,
      scope: 'person',
      scopeRefId: args.personId,
      question: dialog.standaloneQuestion,
      conversationId: args.conversationId ?? null,
    });

    // 8. LLM clone-respond — параметризованный mode.
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

    // 9. Парсим цитаты из «черновика». В judgmental — скрываем из текста.
    const citations = this.parseCitations(llmResult.text, subgraph);
    const finalText =
      mode === 'judgmental'
        ? ClonesService.stripCitationsFromText(llmResult.text)
        : llmResult.text;

    // 10. Persist.
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
      },
    });

    // 10a. SkillUsage log.
    await this.recordPracticeSkillUsages({
      tenantId: args.tenantId,
      conversationId,
      messageId,
      skills: retrievedSkillsV2,
    });

    // 11. Метрики.
    this.metrics.incCloneAsk({ scope: 'person' });
    if (
      profile.person.userId &&
      profile.person.userId === args.requesterUserId
    ) {
      this.metrics.incCloneAskByOwner();
    }

    return {
      conversationId,
      messageId,
      text: finalText,
      citations,
      mode: 'clone_style',
      isOwner:
        profile.person.userId !== null &&
        profile.person.userId === args.requesterUserId,
    };
  }

  /**
   * ТЗ 2026-05-25 §9 — новый путь `askRole` под `CLONE_V2_ENABLED`.
   * Структурно идентичен `askPersonV2`, но scope='role' и subgraph — агрегат
   * по сотрудникам роли.
   */
  private async askRoleV2(args: {
    tenantId: string;
    requesterUserId: string;
    roleId: string;
    question: string;
    conversationId?: string;
  }): Promise<AskCloneResponseDto> {
    // 1. RBAC через CloneAccessGrant.
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
          message:
            'Нет доступа к клону этой роли. Запросите галочку у админа Org.',
        },
      });
    }
    // ТЗ 2026-05-31 — единая per-user квота AI-чата (`AiChatQuotaService`).
    // Бросает `QuotaExceededError` (429 + retryAfterSeconds) на превышении.
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

    let persona = await this.prisma.executablePersona.findFirst({
      where: {
        tenantId: args.tenantId,
        scope: 'role',
        scopeRefId: args.roleId,
        status: 'active',
      },
      orderBy: { version: 'desc' },
    });
    if (!persona) {
      persona = await this.personaBuilder.buildForRole({
        tenantId: args.tenantId,
        roleId: args.roleId,
      });
      if (!persona) {
        throw new NotFoundException({
          ok: false,
          error: {
            code: 'role_persona_unavailable',
            message:
              'Клон роли пока недоступен — нужно больше сотрудников с накопленными профилями.',
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
      scopeRefId: args.roleId,
    });

    const mode = ClonesService.intentToMode(dialog.intent);

    // Ф5 knowledge-access (R8) — резолв групп СПРАШИВАЮЩЕГО (off → null).
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
      accessCtx,
      enforcement: enf,
    });

    const requiredBlocksOverride =
      mode === 'judgmental'
        ? Math.max(1, Math.floor(this.cfg.skill.cloneTopicMinBlocks / 2))
        : null;
    const topicDensity = await this.assertTopicDensity({
      question: dialog.standaloneQuestion,
      reasoningBlocks: subgraph.reasoningBlocks,
      requiredBlocksOverride,
    });
    if (topicDensity.refused) {
      return this.persistTopicStarvedRefusal({
        tenantId: args.tenantId,
        requesterUserId: args.requesterUserId,
        scopeRefId: args.roleId,
        question: args.question,
        conversationId: args.conversationId,
        persona,
        topicDensity,
        scopeKind: 'role',
        isOwner: false,
      });
    }

    let bearerName: string | null = null;
    if (persona.currentBearerPersonId) {
      const bearer = await this.prisma.person.findUnique({
        where: { id: persona.currentBearerPersonId },
        select: { name: true, tenantId: true },
      });
      if (bearer && bearer.tenantId === args.tenantId) {
        bearerName = bearer.name;
      }
    }

    // Agents v2 Фаза C1 — PracticeSkill retrieval (scope='role').
    const retrievedSkillsV2Role = await this.retrievePracticeSkills({
      tenantId: args.tenantId,
      scope: 'role',
      scopeRefId: args.roleId,
      question: dialog.standaloneQuestion,
      conversationId: args.conversationId ?? null,
    });

    const llmResult = await this.callCloneRespond({
      tenantId: args.tenantId,
      persona,
      question: dialog.standaloneQuestion,
      subgraph,
      roleName: role.name,
      bearerName,
      mode,
      practiceSkills: toPromptSkills(retrievedSkillsV2Role),
    });

    const citations = this.parseCitations(llmResult.text, subgraph);
    const finalText =
      mode === 'judgmental'
        ? ClonesService.stripCitationsFromText(llmResult.text)
        : llmResult.text;

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
      },
    });

    await this.recordPracticeSkillUsages({
      tenantId: args.tenantId,
      conversationId,
      messageId,
      skills: retrievedSkillsV2Role,
    });

    this.metrics.incCloneAsk({ scope: 'role' });

    return {
      conversationId,
      messageId,
      text: finalText,
      citations,
      mode: 'clone_style',
      isOwner: false,
    };
  }

  // ─────────────────────── practice-skills (Agents v2 §C1) ───────────────────────

  /**
   * Безопасная обёртка над `PracticeSkillRetrievalService.retrieveForCloneRespond`.
   * Если retrieval-сервис не инжектирован (флаг выключен / unit-тест без него) —
   * возвращает []. Любая ошибка — поглощается и логируется (Clone API не
   * должен падать из-за retrieval'а).
   */
  private async retrievePracticeSkills(args: {
    tenantId: string;
    scope: 'person' | 'role' | 'org';
    scopeRefId: string;
    question: string;
    conversationId: string | null;
  }): Promise<Array<{ id: string; status: string; trigger: string; steps: unknown; redFlags: unknown }>> {
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
        'clones.retrievePracticeSkills: retrieval упал — продолжаю без skill\'ов',
      );
      return [];
    }
  }

  /**
   * Записывает SkillUsage и обновляет lastUsed. Best-effort, без пробрасывания
   * ошибок (если запись упала — diagnostic-лог; ответ клона уже сохранён).
   */
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

  /**
   * Утилита: запустить dialog-layer (если сервис доступен и фича включена в
   * конфиге). При `DIALOG_LAYER_ENABLED=false` или отсутствии DialogService
   * — возвращаем no-op результат (standaloneQuestion = userMessage,
   * intent='factual', одиночный запрос). Так v2-путь работает даже на
   * unit-тестах, мокающих ClonesService без DialogService.
   */
  private async runDialogLayer(input: {
    tenantId: string;
    userId: string;
    userMessage: string;
    conversationId: string | null;
    scope: string;
    scopeRefId: string;
  }): Promise<{
    standaloneQuestion: string;
    intent:
      | 'factual'
      | 'exploratory'
      | 'analytical'
      | 'clone_roleplay';
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
      // ТЗ 2026-05-29 Phase 1 — сужение DialogIntent (7 категорий) до
      // ChatDialogIntent (4 категории) для clones dialog wrapper. Новые
      // intent'ы (daily_plan_morning/evening/note) не должны доходить до
      // clones-flow (bot-adapter перехватывает раньше); helper маппит их в
      // 'factual' как безопасный дефолт.
      intent: narrowToChatIntent(r.intent),
      queries: r.queries,
      confidence: r.confidence,
    };
  }

  /** ТЗ 2026-05-25 §9.4.5 — маппинг intent → mode (factual/judgmental). */
  private static intentToMode(
    intent: 'factual' | 'exploratory' | 'analytical' | 'clone_roleplay',
  ): 'factual' | 'judgmental' {
    if (intent === 'exploratory' || intent === 'analytical') return 'judgmental';
    return 'factual';
  }

  /**
   * ТЗ 2026-05-25 §9.4.5 — убрать `[BLOCK:id]` маркеры из текста ответа в
   * judgmental-режиме. Сами цитаты остаются в `metadata.citations` (через
   * `parseCitations` до вызова этого метода).
   */
  private static stripCitationsFromText(text: string): string {
    return text.replace(/\[BLOCK:[a-zA-Z0-9_-]+\]/g, '').replace(/\s{2,}/g, ' ').trim();
  }

  /**
   * Утилита: единая обработка topic-starved-отказа для обоих v2-путей.
   * Возвращает готовый `AskCloneResponseDto` с `refused=true`.
   */
  private async persistTopicStarvedRefusal(args: {
    tenantId: string;
    requesterUserId: string;
    scopeRefId: string;
    question: string;
    conversationId: string | undefined;
    persona: ExecutablePersona;
    topicDensity: {
      matchedBlocks: number;
      requiredBlocks: number;
      similarityThreshold: number;
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
      },
    });
    this.metrics.incCloneAskRefused({ reason: 'topic_starved' });
    this.metrics.incCloneAsk({ scope: args.scopeKind });
    if (args.isOwner) this.metrics.incCloneAskByOwner();
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

  /**
   * ТЗ 2026-05-25 §9.4.7 (Фаза 7) — «Новый диалог» с клоном.
   *
   * Создаёт пустую `ChatV2Conversation` с привязкой к клону
   * (scope='card', scopeRefId — personId либо roleId — совпадает с
   * persistMessage()). Доступ проверяется ТОЛЬКО через CloneAccessGrant в
   * режиме v2; при выключенном V2 — через legacy-RBAC, чтобы UI «список
   * моих диалогов» работал и до миграции.
   */
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
    // audit В14 (2026-05-29): после RBAC проверяем, что cloneRefId реально
    // существует в тенанте и не soft-удалён. Без этой проверки owner мог
    // создать ChatV2Conversation на несуществующий personId/roleId
    // (`canAccess.*Clone` для owner'а всегда true) — БД получала висячие
    // scopeRefId, UI потом ломался с «не нашли клона» уже из контекста
    // сообщения.
    await this.assertCloneRefExists(
      args.tenantId,
      args.cloneType,
      args.cloneRefId,
    );
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

  /**
   * audit В14: дублирует логику `ClonesAdminService.assertCloneRefExists`
   * чтобы не делать method-injection из admin-сервиса в user-сервис.
   * Проверяет существование Role/Person в тенанте + не soft-удалён.
   */
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

  /**
   * ТЗ 2026-05-26 §2.7 — `GET /api/v1/clones/conversations`.
   *
   * Возвращает список диалогов текущего пользователя с конкретным клоном
   * (отсортировано по `updatedAt DESC`, cursor-based pagination).
   *
   * RBAC: только активный `CloneAccessGrant` (через
   * `RbacService.canAccessPersonClone/canAccessRoleClone` c
   * `cloneV2Enabled=true`). Этот эндпоинт показывает историю — не имеет смысла
   * показывать её тем, у кого нет доступа к самому клону.
   *
   * Маппинг к схеме:
   *   - `cloneType + cloneRefId` → `ChatV2Conversation.scope='card'` +
   *     `scopeRefId=cloneRefId` (см. `createCloneConversation`).
   *   - Соответствие cloneType валидируется проверкой существования Role или
   *     Person в текущем тенанте (404 при отсутствии).
   *   - У `ChatV2Conversation` нет `deletedAt` — фильтруем `status: 'active'`.
   */
  async listMyCloneConversations(args: {
    tenantId: string;
    requesterUserId: string;
    cloneType: 'person' | 'role';
    cloneRefId: string;
    limit: number;
    cursor?: string;
  }): Promise<CloneConversationsListResponseDto> {
    // 1. Существование клона в тенанте (для отдельного 404 — иначе пустой
    //    список не отличался бы от «клона нет»).
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

    // 2. RBAC: активный грант (или legacy-доступ, если CLONE_V2_ENABLED=false).
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

    // 3. Cursor pagination. take = limit + 1, чтобы определить hasMore без
    //    дополнительного count-запроса.
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
      ...(args.cursor
        ? { cursor: { id: args.cursor }, skip: 1 }
        : {}),
      select: {
        id: true,
        title: true,
        updatedAt: true,
        createdAt: true,
        _count: { select: { messages: true } },
      },
    });

    const hasMore = conversations.length > args.limit;
    const sliced = hasMore
      ? conversations.slice(0, args.limit)
      : conversations;
    const items: CloneConversationListItemDto[] = sliced.map((c) => ({
      id: c.id,
      title: c.title,
      lastMessageAt: c.updatedAt.toISOString(),
      messageCount: c._count.messages,
      createdAt: c.createdAt.toISOString(),
    }));
    const nextCursor =
      hasMore && items.length > 0 ? items[items.length - 1]!.id : null;

    return { items, nextCursor };
  }

  // ─────────────────────── skill-profile read ───────────────────────

  async getPersonSkillProfile(args: {
    tenantId: string;
    requesterUserId: string;
    personId: string;
  }): Promise<SkillProfileDto> {
    // RBAC: то же что для askPerson (owner/admin/self/direct manager).
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
        canMarkMisleading:
          access.relation === 'owner_admin' || access.relation === 'manager',
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
      canMarkMisleading:
        access.relation === 'owner_admin' || access.relation === 'manager',
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
    // RBAC: read role.
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

  // ─────────────────────── Clones=Roles Ф4 — list & history ───────────────────────

  /**
   * Clones=Roles Ф4 — список текущих ролевых клонов Org для `/clones`.
   *
   * Контракт:
   *   - RBAC: read `role` (как и `getRoleSkillProfile`). Любой member,
   *     которому видны роли, видит список их клонов.
   *   - Возвращает только `ExecutablePersona(scope='role')` — person-scope
   *     персоны (legacy) скрыты, фронт их больше не показывает.
   *   - На каждую (role, version) даём максимум одну запись: для status='active'
   *     это естественно (одна active версия на роль), для других статусов
   *     группировка делается на DB-уровне через ORDER BY + DISTINCT ON.
   *     На Ф4 берём только status='active' по умолчанию — поэтому достаточно
   *     обычного findMany.
   *   - confidence — эвристика `min(1, builtFromTraitsCount / 10)`.
   *     Без отдельного поля в БД, согласовано с UI Ф4 (та же формула там).
   */
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

    // Сначала собираем кандидатов на уровне БД: ExecutablePersona(scope='role')
    // нужного статуса в этом Org. Фильтр по Role.name (через include) и
    // confidenceMin делаем in-memory — на текущих объёмах (десятки ролей)
    // это безопасно. Если ролей в Org станет >>100 — переедет в pgvector-style
    // raw query, пока избыточно.
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

    // Загружаем Role + Department + bearer Person одним батчем.
    const roleIds = [
      ...new Set(
        allCandidates
          .map((c) => c.scopeRefId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const bearerIds = [
      ...new Set(
        allCandidates
          .map((c) => c.currentBearerPersonId)
          .filter((id): id is string => Boolean(id)),
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

    // Сборка DTO + фильтры по Role.name и confidenceMin.
    const qLower = q?.toLowerCase();
    const mapped: CloneListItemDto[] = [];
    for (const c of allCandidates) {
      if (!c.scopeRefId) continue;
      const role = roleById.get(c.scopeRefId);
      if (!role) continue; // роль удалена / иной tenant — пропускаем
      if (qLower && !role.name.toLowerCase().includes(qLower)) continue;

      const confidence = Math.min(1, c.builtFromTraitsCount / 10);
      if (confidenceMin !== undefined && confidence < confidenceMin) continue;

      const bearer = c.currentBearerPersonId
        ? bearerById.get(c.currentBearerPersonId)
        : undefined;

      mapped.push({
        personaId: c.id,
        roleId: role.id,
        roleName: role.name,
        departmentName: role.department?.name ?? null,
        departmentId: role.department?.id ?? null,
        version: c.roleVersion ?? 1,
        publicName: c.publicName ?? `Клон ${role.name} v${c.roleVersion ?? 1}`,
        status: c.status as 'active' | 'superseded' | 'pending_rebuild',
        currentBearer: bearer
          ? { personId: bearer.id, personName: bearer.name }
          : null,
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

  /**
   * Clones=Roles Ф4 — история версий клона роли для
   * `GET /api/v1/clones/:roleId/history`.
   *
   * Возвращает все `ExecutablePersona(scope='role', scopeRefId=roleId)`
   * отсортированные по `roleVersion DESC`. Период каждой версии:
   *   - validFrom = snapshotAt самой версии;
   *   - validUntil = snapshotAt предыдущей по времени версии (для архивных)
   *     или null (для текущей активной).
   *
   * RBAC: read `role`.
   */
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

    const bearerIds = [
      ...new Set(
        personas
          .map((p) => p.currentBearerPersonId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const bearers =
      bearerIds.length > 0
        ? await this.prisma.person.findMany({
            where: { id: { in: bearerIds }, tenantId: args.tenantId },
            select: { id: true, name: true },
          })
        : [];
    const bearerById = new Map(bearers.map((p) => [p.id, p]));

    // Сортируем по snapshotAt ASC для корректного вычисления validUntil:
    // validUntil[i] = snapshotAt[i+1] (или null для самой свежей).
    const byTimeAsc = [...personas].sort(
      (a, b) => a.snapshotAt.getTime() - b.snapshotAt.getTime(),
    );
    const validUntilByPersonaId = new Map<string, string | null>();
    for (let i = 0; i < byTimeAsc.length; i += 1) {
      const next = byTimeAsc[i + 1];
      validUntilByPersonaId.set(
        byTimeAsc[i]!.id,
        next ? next.snapshotAt.toISOString() : null,
      );
    }

    // Clones=Roles Ф2 — обновляем gauge «общее число версий клона на роль».
    // Учитываем все версии (active + superseded + pending_rebuild).
    try {
      this.metrics.setCloneRoleVersionsTotal({
        roleId: args.roleId,
        value: personas.length,
      });
    } catch {
      // observability — не критичный путь, игнорируем
    }

    const versions: CloneVersionDto[] = personas.map((p) => {
      const bearer = p.currentBearerPersonId
        ? bearerById.get(p.currentBearerPersonId)
        : undefined;
      return {
        personaId: p.id,
        roleId: role.id,
        version: p.roleVersion ?? 1,
        publicName: p.publicName ?? `Клон ${role.name} v${p.roleVersion ?? 1}`,
        status: p.status as 'active' | 'superseded' | 'pending_rebuild',
        bearer: bearer
          ? { personId: bearer.id, personName: bearer.name }
          : null,
        validFrom: p.snapshotAt.toISOString(),
        validUntil: validUntilByPersonaId.get(p.id) ?? null,
        confidence: Math.min(1, p.builtFromTraitsCount / 10),
        traitsCount: p.includedTraitIds.length,
      };
    });

    return { roleId: role.id, roleName: role.name, versions };
  }

  /**
   * Помечает SkillTrait как misleading (post-hoc контроль кураторов).
   * RBAC: owner/admin или direct manager Person'а.
   */
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
    // Носитель не может пометить свой trait — это post-hoc контроль manager'а.
    if (access.relation !== 'owner_admin' && access.relation !== 'manager') {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden_self_mark',
          message:
            'Пометить черту неверной может только direct manager или admin',
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

  /**
   * SBA γ-1 доделки — manual snapshot rebuild для ExecutablePersona.
   * Только owner Person'а или admin/owner Org. Bypass'ит idempotency-замок
   * (manual всегда работает).
   */
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
          message:
            'Manual snapshot может запросить только сам носитель или admin/owner Org',
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
    status: 'active' | 'superseded_by' | 'archived' | 'misleading';
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

  // ─────────────────────── RBAC ───────────────────────

  /**
   * Доступ к клону Person разрешён:
   *   - owner/admin Org;
   *   - сам носитель (Person.userId === requesterUserId);
   *   - direct manager (Membership.role='manager' в той же primaryDepartment).
   */
  private async canAccessPersonClone(args: {
    tenantId: string;
    requesterUserId: string;
    personId: string;
  }): Promise<{ allowed: boolean; relation: 'owner_admin' | 'self' | 'manager' | 'none' }> {
    // 1. owner/admin?
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

    // 2. self?
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

    // 3. direct manager?
    if (target.primaryDepartmentId) {
      const requesterPerson = await this.prisma.person.findFirst({
        where: {
          tenantId: args.tenantId,
          userId: args.requesterUserId,
          deletedAt: null,
        },
        select: { id: true, primaryDepartmentId: true },
      });
      if (
        requesterPerson?.primaryDepartmentId === target.primaryDepartmentId
      ) {
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

  // ─────────────────────── rate limit ───────────────────────
  //
  // ТЗ 2026-05-31 — приватный `assertRateLimit` (Redis-based, ключи
  // `clone:ask:<userId>:<YYYY-MM-DD>`) удалён. Все 4 точки вызова
  // (askPerson / askRole / askPersonV2 / askRoleV2) теперь используют
  // `AiChatQuotaService.tryConsume({ tenantId, userId })` — единую per-user
  // квоту AI-чата (Concierge + Clones), 50/день для админов, 20/день для
  // member'ов. Лимит `cfg.skill.cloneAskPerUserPerDay` и ENV
  // `CLONE_ASK_PER_USER_PER_DAY` оставлены как code-fallback в env.schema
  // (удаление в отдельной мини-фазе, чтобы не задеть другие места).

  // ─────────────────────── retrieval ───────────────────────

  private async loadPersonSubgraph(args: {
    tenantId: string;
    personId: string;
    /**
     * Ф5 knowledge-access (R8) — группы СПРАШИВАЮЩЕГО. null → off (фильтр не
     * применяется, контекст байт-в-байт). При shadow считаем метрику
     * расхождения; при enforce — отбрасываем недоступные reasoning-блоки.
     */
    accessCtx?: KnowledgeAccessContext | null;
    enforcement?: 'off' | 'shadow' | 'enforce';
  }): Promise<CloneSubgraph> {
    const accessCtx = args.accessCtx ?? null;
    const enforcement = args.enforcement ?? 'off';
    const accessEnforce =
      enforcement === 'enforce' && !!accessCtx && !accessCtx.isBypass;

    const person = await this.prisma.person.findUnique({
      where: { id: args.personId },
      select: {
        id: true,
        entityId: true,
        knowledgeProfile: true,
      },
    });
    if (!person) return emptySubgraph();

    // 1. Subject-reasoning блоки (top 20 свежие).
    const reasoningBlocks: CloneBlock[] = [];
    if (person.entityId) {
      const mentions = await this.prisma.ideaBlockEntity.findMany({
        where: {
          entityId: person.entityId,
          role: 'subject',
          // Ф5: при enforce — DB-фильтр доступа спрашивающего по вложенному
          // block (не тащим недоступные блоки из БД). off/shadow → {}.
          block: {
            tenantId: args.tenantId,
            status: 'canonical',
            signalType: { in: ['reasoning', 'rationale', 'decision_basis'] },
            ...(accessEnforce && accessCtx
              ? this.accessResolver!.buildAccessWhere(accessCtx)
              : {}),
          },
        },
        select: { blockId: true },
        take: 40,
      });
      const blockIds = [...new Set(mentions.map((m) => m.blockId))];
      if (blockIds.length > 0) {
        const blocks = await this.prisma.ideaBlock.findMany({
          where: { id: { in: blockIds } },
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
          orderBy: { createdAt: 'desc' },
          take: 20,
        });
        for (const b of blocks) {
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

    // Ф5 knowledge-access (R8) — post-filter поверх reasoningBlocks.
    // off (accessCtx=null) или bypass → НИ одного нового запроса (байт-в-байт).
    // shadow → метрика расхождения, выдачу НЕ меняем. enforce → отбрасываем
    // недоступные (defense-in-depth поверх DB-фильтра в mentions).
    await this.applyAccessToReasoningBlocks(
      reasoningBlocks,
      accessCtx,
      enforcement,
    );

    // 2. KnowledgeProfile summary.
    const knowledgeProfileSummary = this.serializeKnowledgeProfile(
      person.knowledgeProfile,
    );

    // 3. Top decisions с decidedByPersonIds.includes(personId).
    // Ф6 (R12) — Decision — проекция; её групповой доступ выводится ON-READ из
    // sourceBlockIds (наследование строжайшей закрытой группы блоков-источников).
    let decisions = await this.prisma.decision.findMany({
      where: {
        tenantId: args.tenantId,
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

    // Ф6 — фильтр проекций (decisions) по доступу СПРАШИВАЮЩЕГО. off/bypass →
    // байт-в-байт. enforce → отбрасываем недоступные; shadow → только метрика.
    if (
      enforcement !== 'off' &&
      accessCtx &&
      !accessCtx.isBypass &&
      this.accessResolver &&
      decisions.length > 0
    ) {
      const { accessibleIds, denied } =
        await this.accessResolver.partitionProjectionsByAccess(
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
    /**
     * Ф5 knowledge-access (R8) — группы СПРАШИВАЮЩЕГО. См. loadPersonSubgraph.
     */
    accessCtx?: KnowledgeAccessContext | null;
    enforcement?: 'off' | 'shadow' | 'enforce';
  }): Promise<CloneSubgraph> {
    const accessCtx = args.accessCtx ?? null;
    const enforcement = args.enforcement ?? 'off';
    const accessEnforce =
      enforcement === 'enforce' && !!accessCtx && !accessCtx.isBypass;

    // Найти всех employee'ев этой роли.
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
    const entityIds = persons
      .map((p) => p.entityId)
      .filter((id): id is string => Boolean(id));

    const reasoningBlocks: CloneBlock[] = [];
    if (entityIds.length > 0) {
      const mentions = await this.prisma.ideaBlockEntity.findMany({
        where: {
          entityId: { in: entityIds },
          role: 'subject',
          // Ф5: при enforce — DB-фильтр доступа спрашивающего. off/shadow → {}.
          block: {
            tenantId: args.tenantId,
            status: 'canonical',
            signalType: { in: ['reasoning', 'rationale', 'decision_basis'] },
            ...(accessEnforce && accessCtx
              ? this.accessResolver!.buildAccessWhere(accessCtx)
              : {}),
          },
        },
        select: { blockId: true },
        take: 60,
      });
      const blockIds = [...new Set(mentions.map((m) => m.blockId))];
      if (blockIds.length > 0) {
        const blocks = await this.prisma.ideaBlock.findMany({
          where: { id: { in: blockIds } },
          select: {
            id: true,
            name: true,
            trustedAnswer: true,
            evidence: { select: { quote: true }, take: 1 },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        });
        for (const b of blocks) {
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

    // Ф5 knowledge-access (R8) — post-filter (см. loadPersonSubgraph).
    await this.applyAccessToReasoningBlocks(
      reasoningBlocks,
      accessCtx,
      enforcement,
    );

    return {
      reasoningBlocks,
      knowledgeProfileSummary: null,
      decisions: [],
    };
  }

  /**
   * Ф5 knowledge-access (R8) — фильтр контекста клона по правам СПРАШИВАЮЩЕГО.
   * Мутирует `reasoningBlocks` IN-PLACE.
   *
   * Гейт-семантика (как chat-v2 выходной шлюз):
   *   - off (accessCtx=null) ИЛИ bypass → НИ одного запроса, массив не тронут;
   *   - shadow → считаем `kc_access_shadow_diff_total{surface=clone}`, выдачу НЕ меняем;
   *   - enforce → отбрасываем недоступные блоки + `kc_access_denied_total{surface=clone}`
   *     (defense-in-depth поверх DB-фильтра buildAccessWhere в mentions).
   *
   * Порядок важен: фильтр вызывается ДО `assertTopicDensity` (density-guard
   * естественно считает по доступным → корректный `topic_starved` при нехватке).
   */
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
    const { accessible, denied } =
      await this.accessResolver.partitionBlockIdsByAccess(accessCtx, ids);
    if (enforcement === 'enforce') {
      const allow = new Set(accessible);
      // Отфильтровать reasoningBlocks IN-PLACE (defense-in-depth поверх DB-фильтра).
      let write = 0;
      for (let read = 0; read < reasoningBlocks.length; read++) {
        if (allow.has(reasoningBlocks[read]!.id)) {
          reasoningBlocks[write++] = reasoningBlocks[read]!;
        }
      }
      reasoningBlocks.length = write;
      this.metrics.incAccessDenied({ surface: 'clone' }, denied);
    } else {
      // shadow — выдачу НЕ меняем, только метрика расхождения.
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

  // ─────────────────────── topic density (anti-deepfake) ───────────────────────

  /**
   * Фаза 1 clone-reliability-hardening — программная проверка плотности
   * рассуждений по теме вопроса.
   *
   * Возвращает `{ refused: true }`, если в reasoningBlocks меньше
   * `cfg.skill.cloneTopicMinBlocks` блоков с косинусной близостью к
   * embedding'у вопроса ≥ `cfg.skill.cloneTopicSimilarityThreshold`.
   *
   * Консервативные edge-кейсы:
   *   - блок без embedding (старые данные) → НЕ считается «по теме»
   *     (лучше отказаться, чем сгенерировать дипфейк);
   *   - embedQuery вернул null/упал → НЕ блокируем пользователя при
   *     технической проблеме (пропускаем как «достаточная плотность»),
   *     но логируем warning. Это явное решение «не подменять анти-deepfake
   *     отказом из-за технической недоступности embedding-сервиса».
   */
  private async assertTopicDensity(args: {
    question: string;
    reasoningBlocks: ReadonlyArray<{ id: string; text: string }>;
    /**
     * ТЗ 2026-05-25 §9.4.6 (Фаза 7) — override порога `cloneTopicMinBlocks`
     * для judgmental-режима. Если задан — используется вместо
     * `cfg.skill.cloneTopicMinBlocks`. null → дефолт из config.
     */
    requiredBlocksOverride?: number | null;
  }): Promise<{
    refused: boolean;
    matchedBlocks: number;
    requiredBlocks: number;
    similarityThreshold: number;
  }> {
    const similarityThreshold = this.cfg.skill.cloneTopicSimilarityThreshold;
    const requiredBlocks =
      args.requiredBlocksOverride !== undefined &&
      args.requiredBlocksOverride !== null
        ? args.requiredBlocksOverride
        : this.cfg.skill.cloneTopicMinBlocks;

    // Граница: порог 0 — фича выключена.
    if (requiredBlocks <= 0) {
      return {
        refused: false,
        matchedBlocks: args.reasoningBlocks.length,
        requiredBlocks,
        similarityThreshold,
      };
    }

    // Если блоков физически меньше требуемого — можем не ходить за
    // embedding'ами вообще (всё равно не наберём порог).
    if (args.reasoningBlocks.length < requiredBlocks) {
      return {
        refused: true,
        matchedBlocks: 0,
        requiredBlocks,
        similarityThreshold,
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
      };
    }

    const blockEmbeddings = await this.loadBlockEmbeddings(
      args.reasoningBlocks.map((b) => b.id),
    );

    let matched = 0;
    for (const block of args.reasoningBlocks) {
      const vec = blockEmbeddings.get(block.id);
      if (!vec) continue; // нет embedding'а — консервативно не считаем
      const sim = cosineSim(questionEmbedding, vec);
      if (sim >= similarityThreshold) matched += 1;
    }

    return {
      refused: matched < requiredBlocks,
      matchedBlocks: matched,
      requiredBlocks,
      similarityThreshold,
    };
  }

  /**
   * Читает IdeaBlock.embedding через pgvector raw query. Возвращает мапу
   * blockId → number[]. Блоки без embedding в карту не попадут.
   *
   * Логика скопирована из `Specialist37Service.loadEmbeddings` —
   * специально без вынесения в общий helper, чтобы не цеплять
   * `Specialist37Service` за этот файл и не плодить циклы зависимостей.
   */
  private async loadBlockEmbeddings(
    blockIds: string[],
  ): Promise<Map<string, number[]>> {
    if (blockIds.length === 0) return new Map();
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ id: string; emb: string | null }>
      >`SELECT "id", "embedding"::text AS "emb" FROM "IdeaBlock" WHERE "id" IN (${Prisma.join(blockIds)}) AND "embedding" IS NOT NULL`;
      const map = new Map<string, number[]>();
      for (const r of rows) {
        if (!r.emb) continue;
        // pgvector text-формат: '[0.1,0.2,...]'.
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

  // ─────────────────────── LLM call ───────────────────────

  private async callCloneRespond(args: {
    tenantId: string;
    persona: ExecutablePersona;
    question: string;
    subgraph: CloneSubgraph;
    /**
     * Clones=Roles Фаза 6 — название должности и имя текущего носителя.
     * Подставляются в шаблон `clone-respond.prompt.ts` (placeholders
     * `{{roleName}}` / `{{bearerName}}`). Если null/undefined — используются
     * безопасные дефолты внутри `buildCloneRespondSystemPrompt`.
     */
    roleName: string | null;
    bearerName: string | null;
    /**
     * ТЗ 2026-05-25 §9.4.5 (Фаза 7) — режим ответа. Если не задан — factual
     * (обратная совместимость с legacy-вызовами).
     */
    mode?: 'factual' | 'judgmental';
    /**
     * Agents v2 Фаза C1 — PracticeSkill, найденные retrieval'ом. Если массив
     * пустой/undefined — секция `<known_procedures>` не добавляется в USER.
     */
    practiceSkills?: ReadonlyArray<CloneRespondPracticeSkill>;
  }): Promise<LlmCallResult> {
    const mode = args.mode ?? 'factual';
    const systemPrompt = buildCloneRespondSystemPrompt({
      roleName: args.roleName,
      bearerName: args.bearerName,
      personaPrompt: args.persona.personaPrompt,
      mode,
    });
    return this.llm.call({
      taskType: 'clone-respond',
      systemPrompt,
      userMessage: CLONE_RESPOND_USER_TEMPLATE({
        question: args.question,
        subgraph: {
          reasoningBlocks: args.subgraph.reasoningBlocks.map((b) => ({
            id: b.id,
            text: b.text,
          })),
          knowledgeProfileSummary: args.subgraph.knowledgeProfileSummary,
          decisions: args.subgraph.decisions,
        },
        practiceSkills: args.practiceSkills,
      }),
      tenantId: args.tenantId,
      sourceRef: { type: 'executable_persona', id: args.persona.id },
      dataClass: 'internal',
      // ТЗ 2026-05-25 §9.4.5 — температура зависит от режима (factual=0.2 /
      // judgmental=0.7). На сегодня `LlmRouterService.call` не принимает
      // temperature — она задаётся на стороне провайдера/route. Здесь
      // фиксируем намерение через mode (передан в system prompt), а
      // запись «mode=…» уходит в `llmMeta` через caller для аудита.
      // TODO §9.9 — вывести temperature в LlmCallParams отдельной волной.
    });
  }

  private parseCitations(
    answerText: string,
    subgraph: CloneSubgraph,
  ): CloneCitationDto[] {
    const blockMap = new Map<string, CloneBlock>(
      subgraph.reasoningBlocks.map((b) => [b.id, b]),
    );
    const regex = /\[BLOCK:([a-zA-Z0-9_-]+)\]/g;
    const seen = new Set<string>();
    const out: CloneCitationDto[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(answerText)) !== null) {
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
    return out;
  }

  // ─────────────────────── persist message ───────────────────────

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

    // Append user + assistant сообщения.
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
}

// ─────────────────────── types ───────────────────────

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

/**
 * Agents v2 Фаза C1 — нормализует retrieved PracticeSkill из БД-формата
 * (JSON-поля как unknown) в формат `CloneRespondPracticeSkill` для шаблона
 * `clone-respond.prompt.ts`. Безопасно к мусорным JSON: невалидные шаги
 * отбрасываются, нет — секция в промпт не уйдёт.
 */
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
      .filter(
        (st): st is Record<string, unknown> =>
          !!st && typeof st === 'object',
      )
      .map((st, i) => {
        const order =
          typeof st.order === 'number' && Number.isInteger(st.order)
            ? st.order
            : i + 1;
        const action = typeof st.action === 'string' ? st.action : '';
        const er =
          typeof st.emotionalRegister === 'string'
            ? st.emotionalRegister
            : null;
        return { order, action, emotionalRegister: er };
      })
      .filter((st) => st.action.length > 0);
    if (steps.length === 0) continue;
    const flags = Array.isArray(s.redFlags)
      ? (s.redFlags as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        )
      : [];
    out.push({
      trigger: typeof s.trigger === 'string' ? s.trigger : '',
      steps,
      redFlags: flags,
    });
  }
  return out;
}

/**
 * Косинусная близость двух эмбеддингов одинаковой размерности.
 * Возвращает 0 для несовпадающих длин или нулевых векторов
 * (никогда не кидает — это «горячий путь» Clone API).
 */
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
