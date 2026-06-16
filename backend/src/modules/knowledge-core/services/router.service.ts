import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { IdeaBlock } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import { CoreQueueService } from '../../core-queue/core-queue.service';

import { resolveAxisTenantTop } from './tenant-top';

@Injectable()
export class RouterService {
  private readonly logger = new Logger(RouterService.name);

  static readonly SPECIALIST = {
    DECISIONS: '3-3-decisions',
    REGULATIONS: '3-1-regulations',
    INSIGHTS: '3-5-insights',
    IDEAS: '3-6-ideas',
    SKILL: '3-7-skill',
    PROJECT_CUSTOMER: '3-4-project-customer',
    KNOWLEDGE_CLONE: '3-2-knowledge-clone',
    PROCESS_DETECTOR: '3-1-process-detector',
    EXPERIMENT_TRACKER: '3-9-experiments',
    PERSONAL_RELATION: '3-12-personal-relation',
    HELPFULNESS: '3-8-helpfulness',
    GOALS: '3-14-goals',
  } as const;

  private static readonly PRIORITY: Record<string, number> = {
    [RouterService.SPECIALIST.DECISIONS]: 1,
    [RouterService.SPECIALIST.REGULATIONS]: 2,
    [RouterService.SPECIALIST.INSIGHTS]: 3,
    [RouterService.SPECIALIST.IDEAS]: 4,
    [RouterService.SPECIALIST.SKILL]: 5,
    [RouterService.SPECIALIST.PROJECT_CUSTOMER]: 6,
    [RouterService.SPECIALIST.KNOWLEDGE_CLONE]: 7,
    [RouterService.SPECIALIST.PROCESS_DETECTOR]: 2.5,
    [RouterService.SPECIALIST.EXPERIMENT_TRACKER]: 4.5,
    [RouterService.SPECIALIST.PERSONAL_RELATION]: 3.5,
    [RouterService.SPECIALIST.HELPFULNESS]: 5.5,
    [RouterService.SPECIALIST.GOALS]: 3.8,
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(LlmRouterService)
    private readonly llm?: LlmRouterService,
    @Optional()
    @Inject(RedisService)
    private readonly redis?: RedisService,
    @Optional()
    @Inject(EventEmitter2)
    private readonly eventEmitter?: EventEmitter2,
  ) {}

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  async dispatch(block: Pick<IdeaBlock, 'id' | 'tenantId' | 'signalType'>): Promise<{
    dispatched: string[];
    fanOutBeforeTrim: number;
  }> {
    let targets: string[];
    try {
      targets = await this.matchSpecialists(block);
    } catch (err) {
      this.logger.warn(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'RouterService: matchSpecialists упал — пропускаем dispatch',
      );
      return { dispatched: [], fanOutBeforeTrim: 0 };
    }

    const fanOutBeforeTrim = targets.length;
    this.metrics.observeCoreRouterFanOut(fanOutBeforeTrim);

    const limit = this.cfg.router.maxSpecialistsPerBlock;
    let finalTargets = targets;
    if (targets.length > limit) {
      finalTargets = [...targets]
        .sort((a, b) => (RouterService.PRIORITY[a] ?? 99) - (RouterService.PRIORITY[b] ?? 99))
        .slice(0, limit);
      this.metrics.incCoreRouterTrimmed({ signalType: block.signalType });
      this.logger.debug(
        {
          blockId: block.id,
          requested: targets,
          kept: finalTargets,
          limit,
        },
        'RouterService: анти-fan-out — часть специалистов отброшена',
      );
    }

    const dispatched: string[] = [];
    for (const specialistName of finalTargets) {
      try {
        await this.coreQueue.enqueueSpecialistRouting({
          specialistName,
          blockId: block.id,
          tenantId: block.tenantId,
          signalType: block.signalType,
        });
        this.metrics.incCoreRouterDispatched({
          specialist: specialistName,
          signalType: block.signalType,
        });
        dispatched.push(specialistName);
      } catch (err) {
        this.logger.warn(
          {
            blockId: block.id,
            specialistName,
            err: err instanceof Error ? err.message : String(err),
          },
          'RouterService: enqueueSpecialistRouting упал — продолжаем по другим специалистам',
        );
      }
    }

    return { dispatched, fanOutBeforeTrim };
  }

  private async matchSpecialists(
    block: Pick<IdeaBlock, 'id' | 'tenantId' | 'signalType'>,
  ): Promise<string[]> {
    const targets = new Set<string>();
    const signal = block.signalType;

    switch (signal) {
      case 'decision':
      case 'rationale':
      case 'decision_basis':
        targets.add(RouterService.SPECIALIST.DECISIONS);
        break;
      case 'regulation':
        targets.add(RouterService.SPECIALIST.REGULATIONS);
        break;
      case 'process_step':
        targets.add(RouterService.SPECIALIST.REGULATIONS);
        targets.add(RouterService.SPECIALIST.PROCESS_DETECTOR);
        break;
      case 'pain':
      case 'risk':
      case 'churn_risk':
      case 'objection':
        targets.add(RouterService.SPECIALIST.INSIGHTS);
        break;
      case 'idea':
      case 'feature_request':
        targets.add(RouterService.SPECIALIST.IDEAS);
        break;
      case 'reasoning': {
        const hasEmployeeSubject = await this.hasEmployeeSubject(block.id);
        if (hasEmployeeSubject) {
          targets.add(RouterService.SPECIALIST.SKILL);
        }
        break;
      }
      case 'fact': {
        const hasProjectOrCustomer = await this.hasProjectCustomerOrVendor(block.id);
        if (hasProjectOrCustomer) {
          targets.add(RouterService.SPECIALIST.PROJECT_CUSTOMER);
        }
        const hasEmployeeMention = await this.hasEmployeeMention(block.id);
        if (hasEmployeeMention) {
          targets.add(RouterService.SPECIALIST.KNOWLEDGE_CLONE);
        }
        break;
      }
      case 'knowledge_gap':
      case 'question':
        targets.add(RouterService.SPECIALIST.KNOWLEDGE_CLONE);
        break;
      case 'expertise':
      case 'experience':
      case 'competence':
        {
          const hasEmployeeSubject = await this.hasEmployeeSubject(block.id);
          if (hasEmployeeSubject) {
            targets.add(RouterService.SPECIALIST.SKILL);
            targets.add(RouterService.SPECIALIST.KNOWLEDGE_CLONE);
          }
        }
        break;
      case 'lesson':
      case 'hypothesis':
      case 'result': {
        targets.add(RouterService.SPECIALIST.EXPERIMENT_TRACKER);
        const hasEmployeeSubject = await this.hasEmployeeSubject(block.id);
        if (hasEmployeeSubject) {
          targets.add(RouterService.SPECIALIST.SKILL);
        }
        break;
      }
      case 'methodology_step': {
        targets.add(RouterService.SPECIALIST.PROCESS_DETECTOR);
        const hasEmployeeSubject = await this.hasEmployeeSubject(block.id);
        if (hasEmployeeSubject) {
          targets.add(RouterService.SPECIALIST.SKILL);
        }
        break;
      }
      case 'blocker':
      case 'resource_gap':
        targets.add(RouterService.SPECIALIST.INSIGHTS);
        break;
      case 'team_friction':
      case 'process_friction':
        targets.add(RouterService.SPECIALIST.INSIGHTS);
        targets.add(RouterService.SPECIALIST.PERSONAL_RELATION);
        break;
      case 'suggestion':
      case 'client_request':
        targets.add(RouterService.SPECIALIST.IDEAS);
        break;
      case 'brand_principle':
      case 'content_artifact':
      case 'done_item':
        break;
      case 'commitment':
      case 'plan_item':
        targets.add(RouterService.SPECIALIST.GOALS);
        break;
      case 'commitment_status':
        try {
          this.eventEmitter?.emit('commitment.status_received', {
            tenantId: block.tenantId,
            blockId: block.id,
            signalType: block.signalType,
          });
        } catch (err) {
          this.logger.warn(
            {
              blockId: block.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'RouterService: emit commitment.status_received failed — продолжаем без эмита',
          );
        }
        break;
      case 'help_provided':
      case 'proactive_hint':
      case 'mentoring':
      case 'emotional_support':
      case 'constructive_feedback':
      case 'question_unanswered':
      case 'question_acknowledged_no_action':
      case 'helped_by':
      case 'helped_to':
      case 'thanks_explicit':
      case 'task_comment':
      case 'task_mention':
        targets.add(RouterService.SPECIALIST.HELPFULNESS);
        break;
      default:
        break;
    }

    if (targets.size === 0 && this.isLlmFallbackEnabled()) {
      try {
        const llmTargets = await this.fallbackToLlm(block);
        for (const t of llmTargets) targets.add(t);
      } catch (err) {
        this.logger.debug(
          {
            blockId: block.id,
            signalType: block.signalType,
            err: err instanceof Error ? err.message : String(err),
          },
          'RouterService.matchSpecialists: LLM-fallback бросил — игнорируем',
        );
      }
    }

    return Array.from(targets);
  }

  private async fallbackToLlm(
    block: Pick<IdeaBlock, 'id' | 'tenantId' | 'signalType'>,
  ): Promise<string[]> {
    if (!this.llm) return [];
    const tenantTop = resolveAxisTenantTop(block.tenantId);

    const full = await this.prisma.ideaBlock.findUnique({
      where: { id: block.id },
      select: {
        criticalQuestion: true,
        trustedAnswer: true,
        tags: true,
      },
    });
    if (!full) {
      this.metrics.incRouterFallbackCall({ tenantTop, result: 'no_match' });
      return [];
    }

    const cacheKey = this.makeFallbackCacheKey({
      signalType: block.signalType,
      criticalQuestion: full.criticalQuestion,
      trustedAnswer: full.trustedAnswer,
    });

    if (this.redis) {
      try {
        const cached = await this.redis.client.get(cacheKey);
        if (cached != null) {
          const parsed = parseCachedSpecialists(cached);
          this.metrics.incRouterFallbackCacheHit({ tenantTop });
          this.metrics.incRouterFallbackCall({
            tenantTop,
            result: parsed.length > 0 ? 'matched' : 'no_match',
          });
          return parsed;
        }
      } catch (err) {
        this.logger.debug(
          {
            cacheKey,
            err: err instanceof Error ? err.message : String(err),
          },
          'RouterService.fallback: cache read error — пропускаем кэш',
        );
      }
    }

    const whitelist = Object.values(RouterService.SPECIALIST) as string[];
    const systemPrompt = [
      'Ты — knowledge-роутер. Тебе дают один IdeaBlock и whitelist специалистов Слоя 3.',
      'Выбери 0..3 специалистов из whitelist, которым полезно увидеть этот блок. Если ни один не подходит — верни пустой массив.',
      'Отвечай строго JSON: {"specialists": ["3-3-decisions", ...]}. Никакого комментария.',
    ].join('\n');
    const userMessage = [
      `Блок (signalType=${block.signalType}).`,
      `Вопрос: ${full.criticalQuestion}`,
      `Ответ: ${full.trustedAnswer}`,
      `Теги: ${full.tags.join(', ') || '(нет)'}`,
      '',
      `Whitelist специалистов: ${whitelist.join(', ')}`,
    ].join('\n');

    const guardOn = this.isPromptInjectionGuardEnabled();
    let llmText: string;
    try {
      const result = await this.llm.call({
        taskType: 'router-fallback',
        tenantId: block.tenantId,
        systemPrompt: guardOn ? withInjectionGuard(systemPrompt) : systemPrompt,
        userMessage: guardOn ? wrapUserData(userMessage) : userMessage,
        responseFormat: { type: 'json_object' },
        maxTokens: 200,
        sourceRef: { type: 'idea_block', id: block.id },
      });
      llmText = result.text;
    } catch (err) {
      this.metrics.incRouterFallbackCall({ tenantTop, result: 'llm_error' });
      this.logger.warn(
        {
          blockId: block.id,
          signalType: block.signalType,
          err: err instanceof Error ? err.message : String(err),
        },
        'RouterService.fallback: LLM-call упал — возвращаем пусто',
      );
      return [];
    }

    const suggested = parseLlmSpecialists(llmText, whitelist);
    this.metrics.incRouterFallbackCall({
      tenantTop,
      result: suggested.length > 0 ? 'matched' : 'no_match',
    });

    if (this.redis) {
      try {
        const ttl = this.getRouterFallbackTtlSeconds();
        await this.redis.client.set(cacheKey, JSON.stringify(suggested), 'EX', ttl);
      } catch (err) {
        this.logger.debug(
          {
            cacheKey,
            err: err instanceof Error ? err.message : String(err),
          },
          'RouterService.fallback: cache write error — пропускаем',
        );
      }
    }

    return suggested;
  }

  private makeFallbackCacheKey(args: {
    signalType: string;
    criticalQuestion: string;
    trustedAnswer: string;
  }): string {
    const hash = createHash('sha1')
      .update(args.criticalQuestion + '\n' + args.trustedAnswer)
      .digest('hex')
      .slice(0, 16);
    return `routerfallback:${args.signalType}:${hash}`;
  }

  private isLlmFallbackEnabled(): boolean {
    const raw = process.env['ROUTER_LLM_FALLBACK_ENABLED'];
    if (raw == null || raw === '') return false;
    return raw === 'true' || raw === '1';
  }

  private getRouterFallbackTtlSeconds(): number {
    const raw = process.env['ROUTER_FALLBACK_CACHE_TTL_SECONDS'];
    if (raw == null || raw === '') return 86400;
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) return 86400;
    return Math.floor(num);
  }

  private async hasEmployeeSubject(blockId: string): Promise<boolean> {
    const result = await this.prisma.ideaBlockEntity.findFirst({
      where: {
        blockId,
        role: 'subject',
        entity: {
          type: 'person',
          persons: {
            some: {
              relationship: 'employee',
              deletedAt: null,
            },
          },
        },
      },
      select: { entityId: true },
    });
    return result !== null;
  }

  private async hasProjectCustomerOrVendor(blockId: string): Promise<boolean> {
    const result = await this.prisma.ideaBlockEntity.findFirst({
      where: {
        blockId,
        entity: {
          type: { in: ['customer', 'vendor', 'project', 'client'] },
        },
      },
      select: { entityId: true },
    });
    return result !== null;
  }

  private async hasEmployeeMention(blockId: string): Promise<boolean> {
    const result = await this.prisma.ideaBlockEntity.findFirst({
      where: {
        blockId,
        role: { in: ['subject', 'mentioned'] },
        entity: {
          type: 'person',
          persons: {
            some: {
              relationship: 'employee',
              deletedAt: null,
            },
          },
        },
      },
      select: { entityId: true },
    });
    return result !== null;
  }

  static priorityOf(specialist: string): number {
    return RouterService.PRIORITY[specialist] ?? 99;
  }
}

function parseCachedSpecialists(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

function parseLlmSpecialists(text: string, whitelist: string[]): string[] {
  if (!text) return [];
  const allowed = new Set(whitelist);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
  const arr = (parsed as { specialists?: unknown })?.specialists;
  if (!Array.isArray(arr)) return [];
  const result: string[] = [];
  for (const item of arr) {
    if (typeof item === 'string' && allowed.has(item) && !result.includes(item)) {
      result.push(item);
    }
  }
  return result;
}
