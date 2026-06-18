import { Inject, Injectable, Logger } from '@nestjs/common';

import { LlmRouterService } from '../../ai/services/llm-router.service';
import { applyInputGuards } from '../../ai/services/prompts/common';

@Injectable()
export class CheckinParserService {
  private readonly logger = new Logger(CheckinParserService.name);

  constructor(@Inject(LlmRouterService) private readonly llm: LlmRouterService) {}

  async parse(args: { tenantId: string; kind: 'morning' | 'evening'; rawText: string }): Promise<{
    plans: Array<{ text: string; priority?: number }>;
    dones: Array<{ text: string }>;
    blockers: Array<{ text: string; severity?: 'low' | 'medium' | 'high' }>;
    confidence: number;
  }> {
    if (!args.rawText || args.rawText.trim().length === 0) {
      return { plans: [], dones: [], blockers: [], confidence: 0 };
    }

    const systemPrompt = [
      'Ты — парсер ежедневных чек-инов сотрудников.',
      'На вход — короткий свободный текст сотрудника (морнинг = план на день, ивнинг = что сделано + блокеры).',
      'На выход — строгий JSON: { plans: [{text, priority?: 1-5}], dones: [{text}], blockers: [{text, severity?: low|medium|high}], confidence: 0..1 }.',
      'plans/dones/blockers — массивы коротких пунктов (1-200 символов каждый).',
      'severity ставь по тону: «срочно/блокирует» = high, «мешает» = medium, упоминание мимоходом = low.',
      'confidence — твоя уверенность, что распарсил корректно. Если текст бессмысленный или односложный («ок», «всё хорошо») — confidence ≤ 0.3.',
      'Никакого комментария вне JSON.',
    ].join('\n');

    const rawUserMessage = [
      `Тип чек-ина: ${args.kind === 'morning' ? 'утренний (план на день)' : 'вечерний (что сделано + блокеры)'}.`,
      'Ответ сотрудника:',
      args.rawText.slice(0, 4_000),
    ].join('\n');

    const { system: guardedSystem, user: userMessage } = applyInputGuards(
      systemPrompt,
      rawUserMessage,
      { injection: true },
    );

    try {
      const result = await this.llm.call({
        taskType: 'checkin-parse',
        tenantId: args.tenantId,
        systemPrompt: guardedSystem,
        userMessage,
        responseFormat: { type: 'json_object' },
        maxTokens: 800,
        sourceRef: { type: 'checkin', id: args.kind },
      });
      return this.parseLlmResponse(result.text);
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          kind: args.kind,
          err: err instanceof Error ? err.message : String(err),
        },
        'CheckinParserService: LLM-call упал — возвращаю пустую разметку',
      );
      return { plans: [], dones: [], blockers: [], confidence: 0 };
    }
  }

  private parseLlmResponse(text: string): {
    plans: Array<{ text: string; priority?: number }>;
    dones: Array<{ text: string }>;
    blockers: Array<{ text: string; severity?: 'low' | 'medium' | 'high' }>;
    confidence: number;
  } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return { plans: [], dones: [], blockers: [], confidence: 0 };
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        return { plans: [], dones: [], blockers: [], confidence: 0 };
      }
    }
    if (!parsed || typeof parsed !== 'object') {
      return { plans: [], dones: [], blockers: [], confidence: 0 };
    }
    const obj = parsed as Record<string, unknown>;
    return {
      plans: this.normalizePlans(obj.plans),
      dones: this.normalizeDones(obj.dones),
      blockers: this.normalizeBlockers(obj.blockers),
      confidence: clamp(Number(obj.confidence ?? 0), 0, 1),
    };
  }

  private normalizePlans(raw: unknown): Array<{ text: string; priority?: number }> {
    if (!Array.isArray(raw)) return [];
    const out: Array<{ text: string; priority?: number }> = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const text = (item as { text?: unknown }).text;
      if (typeof text !== 'string' || text.length === 0) continue;
      const priorityRaw = (item as { priority?: unknown }).priority;
      const priority = typeof priorityRaw === 'number' ? clamp(priorityRaw, 0, 5) : undefined;
      out.push(
        priority !== undefined
          ? { text: text.slice(0, 2_000), priority }
          : { text: text.slice(0, 2_000) },
      );
      if (out.length >= 50) break;
    }
    return out;
  }

  private normalizeDones(raw: unknown): Array<{ text: string }> {
    if (!Array.isArray(raw)) return [];
    const out: Array<{ text: string }> = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const text = (item as { text?: unknown }).text;
      if (typeof text !== 'string' || text.length === 0) continue;
      out.push({ text: text.slice(0, 2_000) });
      if (out.length >= 50) break;
    }
    return out;
  }

  private normalizeBlockers(
    raw: unknown,
  ): Array<{ text: string; severity?: 'low' | 'medium' | 'high' }> {
    if (!Array.isArray(raw)) return [];
    const out: Array<{ text: string; severity?: 'low' | 'medium' | 'high' }> = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const text = (item as { text?: unknown }).text;
      if (typeof text !== 'string' || text.length === 0) continue;
      const sev = (item as { severity?: unknown }).severity;
      const severity = sev === 'low' || sev === 'medium' || sev === 'high' ? sev : undefined;
      out.push(
        severity ? { text: text.slice(0, 2_000), severity } : { text: text.slice(0, 2_000) },
      );
      if (out.length >= 50) break;
    }
    return out;
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
