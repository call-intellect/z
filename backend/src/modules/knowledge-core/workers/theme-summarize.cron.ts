import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';

const THEME_SUMMARIZE_SYSTEM_PROMPT =
  'Ты пишешь краткую связную суть темы (2-4 предложения) по списку её фактов, простым русским языком, без английских слов.';

@Injectable()
export class ThemeSummarizeCron {
  private readonly logger = new Logger(ThemeSummarizeCron.name);
  private static readonly THEMES_PER_ORG = 20;
  private static readonly MEMBERS_PER_THEME = 30;
  private static readonly MIN_MEMBERS = 2;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
  ) {}

  @Cron('35 * * * *')
  async sweep(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'knowledge.theme_summary_enabled',
      undefined,
      true,
    );
    if (!enabled) return;

    try {
      const orgs = await this.prisma.org.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      for (const org of orgs) {
        try {
          await this.processOrg(org.id);
        } catch (err) {
          this.logger.warn(
            {
              tenantId: org.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'theme-summarize: ошибка на Org — продолжаю',
          );
        }
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'theme-summarize: непойманная ошибка',
      );
    }
  }

  async processOrg(tenantId: string): Promise<void> {
    try {
      await this.gate.checkOrThrow(tenantId, 'theme-summarize');
    } catch {
      this.logger.debug({ tenantId }, 'theme-summarize: gate disabled — skip Org');
      return;
    }

    const themeRows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT t.id AS id
         FROM "Theme" t
        WHERE t."tenantId" = $1
          AND t.status = 'active'
          AND (
            t.summary IS NULL
            OR t."summaryUpdatedAt" IS NULL
            OR t."lastSignalAt" > t."summaryUpdatedAt"
          )
        ORDER BY t."updatedAt" DESC
        LIMIT $2`,
      tenantId,
      ThemeSummarizeCron.THEMES_PER_ORG,
    );
    if (themeRows.length === 0) return;

    for (const theme of themeRows) {
      try {
        await this.summarizeTheme(tenantId, theme.id);
      } catch (err) {
        this.logger.debug(
          {
            tenantId,
            themeId: theme.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'theme-summarize: ошибка темы — пропускаю',
        );
      }
    }
  }

  async summarizeTheme(tenantId: string, themeId: string): Promise<void> {
    const members = await this.prisma.themeIdeaBlock.findMany({
      where: { themeId },
      orderBy: { createdAt: 'desc' },
      take: ThemeSummarizeCron.MEMBERS_PER_THEME,
      select: {
        block: { select: { name: true, trustedAnswer: true } },
      },
    });
    const facts = members
      .map((m) => {
        const name = m.block?.name?.trim() ?? '';
        const answer = m.block?.trustedAnswer?.trim() ?? '';
        if (!name && !answer) return null;
        return `${name}: ${answer}`.trim();
      })
      .filter((f): f is string => f !== null && f.length > 0);
    if (facts.length < ThemeSummarizeCron.MIN_MEMBERS) return;

    const userMessage = `Факты темы:\n${facts.map((f) => `- ${f}`).join('\n')}`;

    let text: string;
    try {
      const result = await this.llm.call({
        taskType: 'theme-summarize',
        systemPrompt: THEME_SUMMARIZE_SYSTEM_PROMPT,
        userMessage,
        tenantId,
        maxTokens: 250,
        dataClass: 'internal',
        sourceRef: { type: 'theme', id: themeId },
      });
      text = result.text?.trim() ?? '';
    } catch (err) {
      this.logger.debug(
        {
          tenantId,
          themeId,
          err: err instanceof Error ? err.message : String(err),
        },
        'theme-summarize: LLM упал — пропускаю тему',
      );
      return;
    }
    if (text.length === 0) return;

    await this.prisma.theme.update({
      where: { id: themeId },
      data: { summary: text.slice(0, 2000), summaryUpdatedAt: new Date() },
    });
  }
}
