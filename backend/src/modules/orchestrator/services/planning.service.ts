import { Inject, Injectable, Logger } from '@nestjs/common';

import { LlmRouterService } from '../../ai/services/llm-router.service';
import { readOrchestratorLimits } from '../orchestrator.config';
import {
  ALL_ORCHESTRATOR_AGENT_TYPES,
  ORCHESTRATOR_PLAN_JSON_SCHEMA,
  ORCHESTRATOR_PLAN_SCHEMA_NAME,
  type OrchestratorAgentType,
  type OrchestratorPlan,
  type OrchestratorPlanStep,
} from '../orchestrator.types';

@Injectable()
export class PlanningService {
  private readonly logger = new Logger(PlanningService.name);

  constructor(@Inject(LlmRouterService) private readonly llm: LlmRouterService) {}

  async plan(args: { task: string; tenantId: string; userId: string }): Promise<OrchestratorPlan> {
    const limits = readOrchestratorLimits();
    const max = limits.maxSubagentsPerRun;

    const systemPrompt = [
      'Ты — оркестратор multi-agent research для AI-системы корпоративной памяти.',
      'Тебе дан запрос пользователя; верни ПЛАН подзадач для subagent-ов.',
      '',
      'Доступные стратегии subagent-ов:',
      '  - entity_research:        собрать всё, что граф знает о конкретной сущности.',
      '  - comparison:             сравнить N сущностей по K измерениям.',
      '  - topic_summary:          обобщить, что компания говорит про тему.',
      '  - timeline_construction:  построить хронологию событий по теме.',
      '',
      'Правила:',
      `  - максимум ${max} шагов.`,
      '  - каждый шаг изолирован: contextSlice.focus — короткая формулировка задачи subagent-а.',
      '  - subagent НЕ видит общую историю; только свой contextSlice.',
      '  - seedHints[] — имена сущностей/ключевые слова/blockId-ы (если применимы).',
      '  - params — параметры стратегии (для comparison: { subjects: [...], dimensions: [...] }; иначе пустой объект {}).',
      '',
      `Верни строго JSON по схеме ${ORCHESTRATOR_PLAN_SCHEMA_NAME}: объект с полями`,
      '  "rationale" (1-2 предложения, почему такой план) и',
      '  "steps" (массив шагов, у каждого agentType из whitelist, description, contextSlice{focus, seedHints, params}).',
    ].join('\n');

    let text: string;
    try {
      const out = await this.llm.call({
        taskType: 'orchestrator-plan',
        systemPrompt,
        userMessage: `Запрос: ${args.task}`,
        tenantId: args.tenantId,
        userId: args.userId,
        maxTokens: 1500,
        responseFormat: {
          type: 'json_schema',
          name: ORCHESTRATOR_PLAN_SCHEMA_NAME,
          schema: ORCHESTRATOR_PLAN_JSON_SCHEMA,
          strict: true,
        },
      });
      text = out.text;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'planning: LLM call failed — fallback to single topic_summary',
      );
      return this.fallbackPlan(args.task);
    }

    const parsed = this.tryParse(text, max);
    if (!parsed || parsed.steps.length === 0) {
      this.logger.warn('planning: empty/invalid plan — fallback to topic_summary');
      return this.fallbackPlan(args.task);
    }
    return parsed;
  }

  private tryParse(text: string, max: number): OrchestratorPlan | null {
    let obj: unknown;
    try {
      obj = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try {
        obj = JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    if (!obj || typeof obj !== 'object') return null;
    const o = obj as { rationale?: unknown; steps?: unknown };
    if (!Array.isArray(o.steps)) return null;

    const steps: OrchestratorPlanStep[] = [];
    for (let i = 0; i < o.steps.length && steps.length < max; i++) {
      const raw = o.steps[i];
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as {
        agentType?: unknown;
        description?: unknown;
        contextSlice?: unknown;
      };
      const agentType = this.coerceAgentType(r.agentType);
      const description =
        typeof r.description === 'string' && r.description.trim().length > 0
          ? r.description.trim().slice(0, 240)
          : agentType;
      const ctx = (r.contextSlice ?? {}) as Record<string, unknown>;
      const focus =
        typeof ctx['focus'] === 'string' && ctx['focus'].trim().length > 0
          ? (ctx['focus'] as string).trim().slice(0, 1000)
          : description;
      const seedHints = Array.isArray(ctx['seedHints'])
        ? (ctx['seedHints'] as unknown[])
            .filter((x): x is string => typeof x === 'string')
            .slice(0, 20)
        : [];
      const params =
        ctx['params'] && typeof ctx['params'] === 'object'
          ? (ctx['params'] as Record<string, unknown>)
          : {};
      steps.push({
        stepIndex: steps.length,
        agentType,
        description,
        contextSlice: { focus, seedHints, params },
      });
    }
    const rationale =
      typeof o.rationale === 'string' && o.rationale.trim().length > 0
        ? o.rationale.trim().slice(0, 600)
        : 'Авто-план для multi-agent research.';
    return { steps, rationale };
  }

  private coerceAgentType(raw: unknown): OrchestratorAgentType {
    if (typeof raw === 'string') {
      const v = raw.trim() as OrchestratorAgentType;
      if (ALL_ORCHESTRATOR_AGENT_TYPES.includes(v)) return v;
    }
    return 'topic_summary';
  }

  private fallbackPlan(task: string): OrchestratorPlan {
    return {
      rationale: 'Fallback-план: одиночный topic_summary (LLM не вернул валидный плана).',
      steps: [
        {
          stepIndex: 0,
          agentType: 'topic_summary',
          description: 'Обобщить то, что компания знает по запросу',
          contextSlice: {
            focus: task.slice(0, 1000),
            seedHints: [],
            params: {},
          },
        },
      ],
    };
  }
}
