import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PracticeSkill } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  PRACTICE_SKILL_ADVERSARIAL_VERIFY_JSON_SCHEMA,
  PRACTICE_SKILL_ADVERSARIAL_VERIFY_SCHEMA_NAME,
  PRACTICE_SKILL_ADVERSARIAL_VERIFY_SYSTEM_PROMPT,
  PRACTICE_SKILL_ADVERSARIAL_VERIFY_USER_TEMPLATE,
} from '../prompts/practice-skill-extract.prompt';

/**
 * Agents v2 Фаза C1 (2026-05-30) — PracticeSkillEvaluatorService.
 *
 * Запускается `PracticeSkillEvaluatorCron` (`@Cron('0 4 * * *')` — daily 04:00).
 * Для каждой shadow-skill с ≥`cfg.practiceSkills.evalMinRuns` SkillUsage за
 * последние 24-48 часов:
 *   1. Считает composite score:
 *      `0.5 * (1 - mean(editDistance)) + 0.3 * meanOutcomeSuccess + 0.2 * adversarialOK`
 *   2. Считает baseline (composite на conversations БЕЗ retrieval'а этого skill'а
 *      за 30 дней).
 *   3. Если composite > baseline + `evalPromoteDelta` → promote (status='active',
 *      trafficShare=1.0).
 *   4. Если composite < baseline - `evalArchiveDelta` → archive
 *      (status='archived', archivedReason='shadow_metrics_worse_than_baseline').
 *   5. Иначе — оставляем в shadow ещё цикл.
 *
 * Adversarial verify — отдельный LLM-вызов `practice-skill-adversarial-verify`
 * (deepseek-v4-flash) на 5 случайных usages: проверяет, что ответ клона не
 * нарушает redFlags и не противоречит шагам.
 */
@Injectable()
export class PracticeSkillEvaluatorService {
  private readonly logger = new Logger(PracticeSkillEvaluatorService.name);

  private static readonly ADVERSARIAL_SAMPLE_SIZE = 5;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  /**
   * Главный entry-point. Возвращает summary прохода. Безопасен к повторному
   * запуску (idempotent — promote/archive выставляют статус, повторный вызов
   * найдёт другой набор shadow-skill'ов).
   */
  async runOnce(): Promise<{
    skillsEvaluated: number;
    promoted: number;
    archived: number;
    held: number;
  }> {
    const minRuns = this.cfg.practiceSkills.evalMinRuns;
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const promoteDelta = this.cfg.practiceSkills.evalPromoteDelta;
    const archiveDelta = this.cfg.practiceSkills.evalArchiveDelta;

    // Кандидаты: shadow skills с ≥ minRuns usages за последние 48ч.
    const candidates = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; cnt: bigint }>
    >(
      `SELECT ps.id, COUNT(su.id)::bigint AS cnt
         FROM "practice_skills" ps
         JOIN "skill_usages" su ON su."practiceSkillId" = ps.id
        WHERE ps.status::text = 'shadow'
          AND su."createdAt" >= $1
          AND su."wasUsed" = true
        GROUP BY ps.id
       HAVING COUNT(su.id) >= $2`,
      since,
      minRuns,
    );

    let promoted = 0;
    let archived = 0;
    let held = 0;

    for (const row of candidates) {
      try {
        const r = await this.evaluateOne(row.id);
        if (r === 'promote') promoted++;
        else if (r === 'archive') archived++;
        else held++;
      } catch (err) {
        this.logger.warn(
          `practice-skill-evaluator: skill=${row.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        held++;
      }
    }

    this.logger.log(
      `practice-skill-evaluator: evaluated=${candidates.length} promoted=${promoted} archived=${archived} held=${held} promoteDelta=${promoteDelta} archiveDelta=${archiveDelta}`,
    );
    return {
      skillsEvaluated: candidates.length,
      promoted,
      archived,
      held,
    };
  }

  /**
   * Оценка одного skill'а. Возвращает action — promote/archive/hold.
   */
  async evaluateOne(skillId: string): Promise<'promote' | 'archive' | 'hold'> {
    const skill = await this.prisma.practiceSkill.findUnique({
      where: { id: skillId },
    });
    if (!skill || skill.status !== 'shadow') return 'hold';

    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const usages = await this.prisma.skillUsage.findMany({
      where: {
        practiceSkillId: skill.id,
        wasUsed: true,
        createdAt: { gte: since },
      },
      select: {
        id: true,
        outcome: true,
        editDistance: true,
        conversationId: true,
        messageId: true,
      },
      take: 1000,
    });
    if (usages.length < this.cfg.practiceSkills.evalMinRuns) {
      return 'hold';
    }

    const composite = await this.composite({
      tenantId: skill.tenantId,
      usages,
    });
    const baseline = await this.baselineFor(skill);
    const delta = composite.value - baseline;

    try {
      this.metrics.observePracticeSkillsCompositeVsBaseline({ delta });
    } catch {
      /* observability */
    }

    const shadowMetrics = {
      runs: usages.length,
      composite: composite.value,
      meanEditDistance: composite.meanEditDistance,
      meanOutcomeSuccess: composite.meanOutcomeSuccess,
      adversarialOK: composite.adversarialOK,
      baseline,
      vsBaseline: delta,
      lastEvalAt: new Date().toISOString(),
    };

    if (delta > this.cfg.practiceSkills.evalPromoteDelta) {
      await this.prisma.practiceSkill.update({
        where: { id: skill.id },
        data: {
          status: 'active',
          trafficShare: 1.0,
          successRate: composite.meanOutcomeSuccess,
          shadowMetrics: shadowMetrics as unknown as object,
          promotedAt: new Date(),
        },
      });
      try {
        this.metrics.incPracticeSkillsPromoted();
      } catch {
        /* observability */
      }
      this.logger.log(
        `practice-skill-evaluator: skill=${skill.id} PROMOTED (composite=${composite.value.toFixed(3)} vs baseline=${baseline.toFixed(3)})`,
      );
      return 'promote';
    }
    if (delta < -this.cfg.practiceSkills.evalArchiveDelta) {
      await this.prisma.practiceSkill.update({
        where: { id: skill.id },
        data: {
          status: 'archived',
          successRate: composite.meanOutcomeSuccess,
          shadowMetrics: shadowMetrics as unknown as object,
          archivedAt: new Date(),
          archivedReason: 'shadow_metrics_worse_than_baseline',
        },
      });
      try {
        this.metrics.incPracticeSkillsArchived();
      } catch {
        /* observability */
      }
      this.logger.log(
        `practice-skill-evaluator: skill=${skill.id} ARCHIVED (composite=${composite.value.toFixed(3)} vs baseline=${baseline.toFixed(3)})`,
      );
      return 'archive';
    }
    // Hold — обновляем только metrics, не трогаем status.
    await this.prisma.practiceSkill.update({
      where: { id: skill.id },
      data: {
        successRate: composite.meanOutcomeSuccess,
        shadowMetrics: shadowMetrics as unknown as object,
      },
    });
    this.logger.debug(
      `practice-skill-evaluator: skill=${skill.id} HOLD (composite=${composite.value.toFixed(3)} vs baseline=${baseline.toFixed(3)})`,
    );
    return 'hold';
  }

  // ─────────────────────── composite ───────────────────────

  /**
   * composite = 0.5 * (1 - mean(editDistance)) + 0.3 * meanOutcomeSuccess + 0.2 * adversarialOK
   *
   * Пустые поля:
   *   - editDistance == null → исключается из mean.
   *   - outcome == 'pending' → исключается из meanOutcomeSuccess.
   *
   * Если adversarialOK не удалось посчитать (LLM упал на ВСЕХ 5 sample) —
   * берём консервативно 0.5 (нейтрально, не promote и не archive).
   */
  private async composite(args: {
    tenantId: string;
    usages: ReadonlyArray<{
      id: string;
      outcome: string | null;
      editDistance: number | null;
      conversationId: string;
      messageId: string;
    }>;
  }): Promise<{
    value: number;
    meanEditDistance: number;
    meanOutcomeSuccess: number;
    adversarialOK: number;
  }> {
    // mean(editDistance)
    const eds = args.usages
      .map((u) => u.editDistance)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const meanEditDistance =
      eds.length > 0 ? eds.reduce((a, b) => a + b, 0) / eds.length : 0;

    // meanOutcomeSuccess
    const decided = args.usages.filter(
      (u) => u.outcome && u.outcome !== 'pending',
    );
    const successCount = decided.filter(
      (u) => u.outcome === 'accepted_as_is',
    ).length;
    const meanOutcomeSuccess =
      decided.length > 0 ? successCount / decided.length : 0;

    // adversarialOK на 5 случайных usage'ах.
    const adversarialOK = await this.adversarialOK({
      tenantId: args.tenantId,
      usages: args.usages,
    });

    const value =
      0.5 * (1 - meanEditDistance) +
      0.3 * meanOutcomeSuccess +
      0.2 * adversarialOK;
    return {
      value,
      meanEditDistance,
      meanOutcomeSuccess,
      adversarialOK,
    };
  }

  /**
   * Adversarial OK — доля sample usages, в которых ответ клона не нарушает
   * redFlags и не противоречит шагам skill'а. На N=5; если все 5 LLM-вызовов
   * упали — возвращаем 0.5 (нейтрально).
   */
  private async adversarialOK(args: {
    tenantId: string;
    usages: ReadonlyArray<{
      id: string;
      messageId: string;
    }>;
  }): Promise<number> {
    const sample = sampleN(
      args.usages,
      PracticeSkillEvaluatorService.ADVERSARIAL_SAMPLE_SIZE,
    );
    if (sample.length === 0) return 0.5;

    // Загружаем skill один раз (по первому usage).
    const firstUsage = await this.prisma.skillUsage.findUnique({
      where: { id: sample[0]!.id },
      include: {
        practiceSkill: {
          select: {
            id: true,
            trigger: true,
            steps: true,
            redFlags: true,
          },
        },
      },
    });
    if (!firstUsage) return 0.5;
    const skill = firstUsage.practiceSkill;

    const stepsArr = Array.isArray(skill.steps)
      ? (skill.steps as Array<{ order?: number; action?: string }>)
          .filter(
            (s): s is { order: number; action: string } =>
              !!s &&
              typeof (s as { order?: unknown }).order === 'number' &&
              typeof (s as { action?: unknown }).action === 'string',
          )
          .map((s) => ({ order: s.order, action: s.action }))
      : [];
    const redFlagsArr = Array.isArray(skill.redFlags)
      ? (skill.redFlags as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        )
      : [];

    let okCount = 0;
    let evaluated = 0;
    for (const u of sample) {
      const cloneAnswer = await this.loadAnswer(u.messageId);
      if (!cloneAnswer) continue;
      try {
        const result = await this.llm.call({
          taskType: 'practice-skill-adversarial-verify',
          systemPrompt: PRACTICE_SKILL_ADVERSARIAL_VERIFY_SYSTEM_PROMPT,
          userMessage: PRACTICE_SKILL_ADVERSARIAL_VERIFY_USER_TEMPLATE({
            trigger: skill.trigger,
            steps: stepsArr,
            redFlags: redFlagsArr,
            cloneAnswer,
          }),
          tenantId: args.tenantId,
          responseFormat: {
            type: 'json_schema',
            name: PRACTICE_SKILL_ADVERSARIAL_VERIFY_SCHEMA_NAME,
            schema: PRACTICE_SKILL_ADVERSARIAL_VERIFY_JSON_SCHEMA,
            strict: true,
          },
          dataClass: 'internal',
          sourceRef: {
            type: 'practice-skill-adversarial-verify',
            id: u.id,
          },
        });
        const parsed = JSON.parse(result.text) as {
          violatesRedFlags?: unknown;
          contradictsSteps?: unknown;
        };
        const violates =
          parsed.violatesRedFlags === true ||
          parsed.contradictsSteps === true;
        if (!violates) okCount++;
        evaluated++;
      } catch (err) {
        this.logger.debug(
          `adversarialOK: usage=${u.id} LLM failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return evaluated > 0 ? okCount / evaluated : 0.5;
  }

  private async loadAnswer(messageId: string): Promise<string | null> {
    try {
      const msg = await this.prisma.chatV2Message.findUnique({
        where: { id: messageId },
        select: { text: true },
      });
      return msg?.text ?? null;
    } catch {
      return null;
    }
  }

  // ─────────────────────── baseline ───────────────────────

  /**
   * Baseline: composite score на conversations за последние 30 дней, в которых
   * этот skill НЕ участвовал (нет SkillUsage[skillId=current] для conversationId).
   *
   * Упрощённая версия для Фазы C1: вместо полного «как бы выглядел ответ без
   * skill'а» — берём средний editDistance + meanOutcomeSuccess по всем
   * ChatV2Message(role='assistant', mode='clone_style') данного scope'а.
   * adversarialOK для baseline не считаем (предполагаем 1.0 — без skill'а
   * нечему противоречить).
   *
   * Если baseline посчитать не удалось — возвращаем 0.5 как нейтральный.
   */
  private async baselineFor(skill: PracticeSkill): Promise<number> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    try {
      // Все skill_usages этого skill (исключим эти conversations).
      const usedConvs = await this.prisma.skillUsage.findMany({
        where: { practiceSkillId: skill.id },
        select: { conversationId: true },
        take: 5_000,
      });
      const excludeConv = new Set(usedConvs.map((u) => u.conversationId));

      // ChatV2Conversation в рамках scope'а skill'а (по scopeRefId == person/role).
      // Упрощённо: scope='card', scopeRefId = personId/roleId/orgId.
      const conversations = await this.prisma.chatV2Conversation.findMany({
        where: {
          tenantId: skill.tenantId,
          scope: 'card',
          scopeRefId: skill.scopeRefId,
          createdAt: { gte: since },
        },
        select: { id: true },
        take: 2_000,
      });
      const convIds = conversations
        .map((c) => c.id)
        .filter((id) => !excludeConv.has(id));
      if (convIds.length === 0) return 0.5;

      // Усредняем по SkillUsage из ДРУГИХ skill'ов в этих conversation'ах,
      // если есть. Если нет — возвращаем условный 0.5 (нет данных).
      const otherUsages = await this.prisma.skillUsage.findMany({
        where: {
          conversationId: { in: convIds },
          wasUsed: true,
          practiceSkillId: { not: skill.id },
        },
        select: { outcome: true, editDistance: true },
        take: 5_000,
      });
      if (otherUsages.length === 0) return 0.5;

      const eds = otherUsages
        .map((u) => u.editDistance)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      const meanEditDistance =
        eds.length > 0 ? eds.reduce((a, b) => a + b, 0) / eds.length : 0;
      const decided = otherUsages.filter(
        (u) => u.outcome && u.outcome !== 'pending',
      );
      const successCount = decided.filter(
        (u) => u.outcome === 'accepted_as_is',
      ).length;
      const meanOutcomeSuccess =
        decided.length > 0 ? successCount / decided.length : 0;
      // adversarialOK baseline = 1.0 — без skill'а нечего нарушать.
      return (
        0.5 * (1 - meanEditDistance) + 0.3 * meanOutcomeSuccess + 0.2 * 1.0
      );
    } catch (err) {
      this.logger.debug(
        `baselineFor skill=${skill.id} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0.5;
    }
  }
}

// ───────────────────────────── helpers ─────────────────────────────

function sampleN<T>(arr: ReadonlyArray<T>, n: number): T[] {
  if (arr.length <= n) return [...arr];
  const indices = new Set<number>();
  while (indices.size < n) {
    indices.add(Math.floor(Math.random() * arr.length));
  }
  return [...indices].map((i) => arr[i] as T);
}
