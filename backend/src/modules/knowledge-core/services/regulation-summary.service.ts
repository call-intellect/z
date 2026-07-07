import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';

import type { RegulationKind } from './role-scope.util';

interface RuleRow {
  kind: RegulationKind;
  id: string;
  name: string;
  text: string;
}

const SUMMARY_SYSTEM = [
  'Ты сжимаешь корпоративное правило/регламент в 1–2 ёмких предложения.',
  'Ответ должен передавать: О ЧЁМ правило и КОГДА (в какой ситуации) оно применяется.',
  'Без вводных слов, без «данное правило», без списков — только суть. На русском.',
].join('\n');

@Injectable()
export class RegulationSummaryService {
  private readonly logger = new Logger(RegulationSummaryService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  sourceHash(name: string, text: string): string {
    return createHash('sha256').update(`${name}\n${text}`, 'utf8').digest('hex').slice(0, 40);
  }

  async refreshStaleForOrg(
    tenantId: string,
    opts?: { limit?: number; force?: boolean },
  ): Promise<{ generated: number; reused: number }> {
    const limit = opts?.limit ?? (await this.cfg.getDynamic<number>('clone.regulations.summary.batch', undefined, 40));
    const force = opts?.force ?? false;

    const rules = await this.collectRules(tenantId);
    if (rules.length === 0) return { generated: 0, reused: 0 };

    const existing = await this.prisma.ruleSummary.findMany({
      where: { tenantId, ruleId: { in: rules.map((r) => r.id) } },
      select: { kind: true, ruleId: true, sourceHash: true },
    });
    const hashByKey = new Map(existing.map((e) => [`${e.kind}:${e.ruleId}`, e.sourceHash]));

    const [model, maxTokens] = await Promise.all([
      this.cfg.getDynamic<string>('clone.regulations.summary.model', undefined, 'deepseek-v4-flash'),
      this.cfg.getDynamic<number>('clone.regulations.summary.max_tokens', undefined, 700),
    ]);

    let generated = 0;
    let reused = 0;
    for (const rule of rules) {
      if (generated >= limit) break;
      const hash = this.sourceHash(rule.name, rule.text);
      if (!force && hashByKey.get(`${rule.kind}:${rule.id}`) === hash) {
        reused++;
        continue;
      }
      const summary = await this.generateSummary(tenantId, rule, model, maxTokens);
      if (!summary) continue;
      await this.prisma.ruleSummary.upsert({
        where: { tenantId_kind_ruleId: { tenantId, kind: rule.kind, ruleId: rule.id } },
        create: {
          tenantId,
          kind: rule.kind,
          ruleId: rule.id,
          summary,
          sourceHash: hash,
          model,
        },
        update: { summary, sourceHash: hash, model, generatedAt: new Date() },
      });
      generated++;
    }
    return { generated, reused };
  }

  private async generateSummary(
    tenantId: string,
    rule: RuleRow,
    model: string,
    maxTokens: number,
  ): Promise<string | null> {
    try {
      const res = await this.llm.call({
        taskType: 'clone-respond',
        model,
        tenantId,
        dataClass: 'internal',
        maxTokens,
        systemPrompt: SUMMARY_SYSTEM,
        userMessage: `Название: ${rule.name}\nТекст правила: ${rule.text}`,
        sourceRef: { type: `${rule.kind}-summary`, id: rule.id },
      });
      const text = res.text?.trim() ?? '';
      return text.length > 0 ? text.slice(0, 2000) : null;
    } catch (err) {
      this.logger.debug(
        `regulation-summary: LLM упал для ${rule.kind}:${rule.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async collectRules(tenantId: string): Promise<RuleRow[]> {
    const base = { tenantId, deletedAt: null, status: 'active' as const };
    const [regs, instrs, pols, procs] = await Promise.all([
      this.prisma.regulation.findMany({ where: base, select: { id: true, name: true, statement: true, contentMd: true } }),
      this.prisma.instruction.findMany({ where: base, select: { id: true, name: true, statement: true, contentMd: true } }),
      this.prisma.policy.findMany({ where: base, select: { id: true, name: true, contentMd: true } }),
      this.prisma.process.findMany({ where: base, select: { id: true, name: true, description: true } }),
    ]);
    const rows: RuleRow[] = [];
    const push = (kind: RegulationKind, id: string, name: string, text: string): void => {
      const clean = (text ?? '').trim();
      if (clean) rows.push({ kind, id, name, text: clean.slice(0, 4000) });
    };
    for (const r of regs) push('regulation', r.id, r.name, (r.statement?.trim() || r.contentMd) ?? '');
    for (const r of instrs) push('instruction', r.id, r.name, (r.statement?.trim() || r.contentMd) ?? '');
    for (const r of pols) push('policy', r.id, r.name, r.contentMd ?? '');
    for (const r of procs) push('process', r.id, r.name, r.description ?? '');
    return rows;
  }
}
