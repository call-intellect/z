import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { PromptFeedback, PromptRule } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { EmbeddingFallbackService } from '../../embeddings/services/embedding-fallback.service';
import {
  AUTORULE_EXTRACT_JSON_SCHEMA,
  AUTORULE_EXTRACT_SCHEMA_NAME,
  AUTORULE_EXTRACT_SYSTEM_PROMPT,
  AUTORULE_EXTRACT_USER_TEMPLATE,
} from '../prompts/autorule-extract.prompt';

/**
 * Agents v2 Фаза B1 (2026-05-30) — AutoRuleExtractorService.
 *
 * Ночной cron вызывает `extractForPromptKey(promptKey, tenantId)`:
 *   1. Загружает PromptFeedback за 24ч с editedOutput != null.
 *   2. Группирует по KNN cosine ≥ knnGroupThreshold (default 0.78) на
 *      `inputEmbedding`. Если эмбеддинга нет — fallback на group-by inputDigest.
 *   3. Для групп ≥3 элементов → один LLM-вызов `autorule-extract` → draft rule.
 *   4. Если `confidence >= minConfidenceForPromote` — продолжаем; иначе skip.
 *   5. KNN-check на existing PromptRule (≥ ruleSimilarityThreshold cosine):
 *      - если `overridden_by_admin` → skip (sticky);
 *      - если есть — `appendExamples` (обновляем existing);
 *      - иначе → новое PromptRule(status='shadow').
 *
 * В Фазе B статус active НЕ ставим — всё остаётся shadow, для будущей
 * валидации админом + A/B-сравнения в Фазе C.
 *
 * Метрики:
 *   - `z_autorule_extracted_total{promptKey, ruleType}` — каждое новое правило.
 *   - `z_autorule_rules_total{promptKey, status, source}` — gauge (обновляется
 *     отдельным snapshot-cron'ом, здесь не трогаем).
 */
@Injectable()
export class AutoRuleExtractorService {
  private readonly logger = new Logger(AutoRuleExtractorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Optional()
    @Inject(EmbeddingFallbackService)
    private readonly embeddings?: EmbeddingFallbackService,
  ) {}

  /**
   * Главный entry-point. Вызывается из cron'а для каждой пары (promptKey, tenantId).
   */
  async extractForPromptKey(
    promptKey: string,
    tenantId: string | null,
  ): Promise<PromptRule[]> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const feedback = await this.prisma.promptFeedback.findMany({
      where: {
        promptKey,
        ...(tenantId === null ? {} : { tenantId }),
        editedOutput: { not: null },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      // Защита от memory blow-up: даже на «глобальной» волне берём не больше 500
      // самых свежих feedback'ов одного promptKey.
      take: 500,
    });

    if (feedback.length < this.cfg.autorule.minFeedbackForExtract) {
      this.logger.debug(
        `extractForPromptKey: promptKey=${promptKey} tenant=${tenantId ?? 'global'} — мало feedback (${feedback.length})`,
      );
      return [];
    }

    const groups = await this.knnGroup(feedback, this.cfg.autorule.knnGroupThreshold);

    const newRules: PromptRule[] = [];
    for (const group of groups) {
      if (group.length < 3) continue;

      let draft: AutoRuleDraft;
      try {
        draft = await this.callLlmForGroup(promptKey, tenantId, group);
      } catch (err) {
        this.logger.warn(
          {
            promptKey,
            tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'autorule-extract LLM call failed — пропускаю группу',
        );
        continue;
      }

      if (draft.confidence < this.cfg.autorule.minConfidenceForPromote) {
        this.logger.debug(
          `autorule-extract: skip low confidence (${draft.confidence}) для promptKey=${promptKey}`,
        );
        continue;
      }

      // KNN-check на existing rule (cosine ≥ ruleSimilarityThreshold).
      const existing = await this.findSimilarRule(
        promptKey,
        tenantId,
        draft.rule,
        this.cfg.autorule.ruleSimilarityThreshold,
      );

      if (existing) {
        if (existing.status === 'overridden_by_admin') {
          this.logger.log(
            `autorule-extract: existing rule overridden_by_admin — skip (promptKey=${promptKey}, ruleId=${existing.id})`,
          );
          continue;
        }
        // Update examples — мерж до 3.
        await this.appendExamples(existing.id, draft.examples);
        continue;
      }

      const created = await this.prisma.promptRule.create({
        data: {
          tenantId,
          promptKey,
          rule: draft.rule,
          ruleType: draft.ruleType,
          source: 'autorule',
          examples: draft.examples as unknown as object,
          confidence: draft.confidence,
          status: 'shadow',
        },
      });
      // Эмбеддинг текста rule — отдельным raw update'ом.
      try {
        await this.upsertRuleEmbedding(created.id, draft.rule);
      } catch (err) {
        this.logger.debug(
          `autorule-extract: upsert embedding failed для rule=${created.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      this.metrics.incAutoruleExtracted({
        promptKey,
        ruleType: draft.ruleType,
      });
      newRules.push(created);
    }
    return newRules;
  }

  /**
   * Группирует feedback в кластеры. Использует KNN по `inputEmbedding`
   * (cosine similarity), если эмбеддинги есть. Иначе fallback на group-by
   * `inputDigest` (хуже recall, но работает без embedding'ов).
   *
   * Алгоритм: greedy single-link.
   *   - sort feedback descending по createdAt;
   *   - для каждого: ищем существующий кластер с representative, у которого
   *     cosine >= threshold; если есть — добавляем туда, иначе создаём новый.
   */
  private async knnGroup(
    feedback: PromptFeedback[],
    threshold: number,
  ): Promise<PromptFeedback[][]> {
    if (feedback.length === 0) return [];

    // Загружаем эмбеддинги (vector → number[]) одним raw запросом. Prisma
    // не отдаёт Unsupported поля, поэтому делаем отдельный SELECT.
    const ids = feedback.map((f) => f.id);
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; emb: number[] | null }>
    >(
      // pgvector экспортирует vector → text как '[v1,v2,...]'; пробуем cast в float8[]
      // через ARRAY-парсинг безопаснее: используем pgvector функцию `to_text` и парсим в JS.
      `SELECT id, "inputEmbedding"::text AS emb FROM "PromptFeedback" WHERE id = ANY($1::text[])`,
      ids,
    );
    const idToVec = new Map<string, number[] | null>();
    for (const r of rows) {
      idToVec.set(r.id, parsePgVector(r.emb as unknown as string | null));
    }

    interface Cluster {
      representative: PromptFeedback;
      vec: number[] | null;
      members: PromptFeedback[];
    }
    const clusters: Cluster[] = [];

    const hasAnyEmbedding = Array.from(idToVec.values()).some((v) => v && v.length > 0);

    for (const f of feedback) {
      const vec = idToVec.get(f.id) ?? null;
      if (hasAnyEmbedding && vec) {
        // KNN-similarity путь.
        let added = false;
        for (const c of clusters) {
          if (!c.vec) continue;
          const sim = cosineSimilarity(c.vec, vec);
          if (sim >= threshold) {
            c.members.push(f);
            added = true;
            break;
          }
        }
        if (!added) {
          clusters.push({ representative: f, vec, members: [f] });
        }
      } else {
        // Fallback: group-by inputDigest точным match'ем.
        let added = false;
        for (const c of clusters) {
          if (c.representative.inputDigest === f.inputDigest) {
            c.members.push(f);
            added = true;
            break;
          }
        }
        if (!added) {
          clusters.push({ representative: f, vec, members: [f] });
        }
      }
    }

    return clusters.map((c) => c.members);
  }

  private async callLlmForGroup(
    promptKey: string,
    tenantId: string | null,
    group: PromptFeedback[],
  ): Promise<AutoRuleDraft> {
    const examples = group.slice(0, 8).map((f) => ({
      original: f.originalOutput,
      edited: f.editedOutput ?? '',
    }));
    const result = await this.llm.call({
      taskType: 'autorule-extract',
      systemPrompt: AUTORULE_EXTRACT_SYSTEM_PROMPT,
      userMessage: AUTORULE_EXTRACT_USER_TEMPLATE({ promptKey, examples }),
      tenantId,
      responseFormat: {
        type: 'json_schema',
        name: AUTORULE_EXTRACT_SCHEMA_NAME,
        schema: AUTORULE_EXTRACT_JSON_SCHEMA,
        strict: true,
      },
      dataClass: 'internal',
      sourceRef: { type: 'autorule-extract', id: `${promptKey}:${tenantId ?? 'global'}` },
    });

    const parsed = JSON.parse(result.text) as Partial<AutoRuleDraft>;
    const rule = typeof parsed.rule === 'string' ? parsed.rule.trim() : '';
    const ruleType = isRuleType(parsed.ruleType) ? parsed.ruleType : 'must_do';
    const confidence =
      typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0;
    const examplesOut = Array.isArray(parsed.examples)
      ? (parsed.examples as Array<unknown>)
          .filter((e): e is AutoRuleExample =>
            !!e &&
            typeof e === 'object' &&
            typeof (e as AutoRuleExample).originalSnippet === 'string' &&
            typeof (e as AutoRuleExample).editedSnippet === 'string' &&
            typeof (e as AutoRuleExample).why === 'string',
          )
          .slice(0, 3)
      : [];
    const reasoning =
      typeof parsed.reasoning === 'string' ? parsed.reasoning : '';

    if (rule.length === 0 || examplesOut.length === 0) {
      throw new Error('autorule-extract: пустой rule или examples в LLM-ответе');
    }
    return { rule, ruleType, confidence, examples: examplesOut, reasoning };
  }

  /**
   * Ищет похожее правило (KNN cosine ≥ threshold). Возвращает null если нет.
   * Если эмбеддинги ещё не сохранены — fallback на substring-match
   * (точное равенство rule.text).
   */
  private async findSimilarRule(
    promptKey: string,
    tenantId: string | null,
    ruleText: string,
    threshold: number,
  ): Promise<PromptRule | null> {
    // Substring-fallback всегда работает быстро.
    const exactByText = await this.prisma.promptRule.findFirst({
      where: {
        promptKey,
        // global rules видим из per-tenant контекста и наоборот не дублируем
        ...(tenantId === null ? { tenantId: null } : { tenantId }),
        rule: ruleText,
      },
    });
    if (exactByText) return exactByText;

    if (!this.embeddings) return null;

    let queryVec: number[] | null;
    try {
      const [v] = await this.embeddings.embed([ruleText.slice(0, 1000)]);
      queryVec = v ?? null;
    } catch {
      return null;
    }
    if (!queryVec) return null;

    // pgvector cosine distance: `embedding <=> query`; similarity = 1 - distance.
    const minDistance = 1 - threshold;
    const tenantClause = tenantId === null ? `"tenantId" IS NULL` : `"tenantId" = $2`;
    const params: unknown[] = [`[${queryVec.join(',')}]`];
    if (tenantId !== null) params.push(tenantId);
    params.push(promptKey);
    params.push(minDistance);

    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string; dist: number }>>(
      `SELECT id, ("embedding" <=> $1::vector) AS dist
       FROM "PromptRule"
       WHERE "embedding" IS NOT NULL
         AND ${tenantClause}
         AND "promptKey" = $${tenantId === null ? 2 : 3}
         AND ("embedding" <=> $1::vector) <= $${tenantId === null ? 3 : 4}
       ORDER BY dist ASC
       LIMIT 1`,
      ...params,
    );
    const best = rows[0];
    if (!best) return null;
    return this.prisma.promptRule.findUnique({ where: { id: best.id } });
  }

  private async appendExamples(
    ruleId: string,
    examples: AutoRuleExample[],
  ): Promise<void> {
    const rule = await this.prisma.promptRule.findUnique({ where: { id: ruleId } });
    if (!rule) return;
    const prev = Array.isArray(rule.examples) ? (rule.examples as unknown as AutoRuleExample[]) : [];
    const merged = dedupeExamples([...prev, ...examples]).slice(0, 5);
    await this.prisma.promptRule.update({
      where: { id: ruleId },
      data: { examples: merged as unknown as object, updatedAt: new Date() },
    });
  }

  private async upsertRuleEmbedding(ruleId: string, ruleText: string): Promise<void> {
    if (!this.embeddings) return;
    const [vec] = await this.embeddings.embed([ruleText.slice(0, 1000)]);
    if (!vec || vec.length !== 1536) return;
    await this.prisma.$executeRawUnsafe(
      `UPDATE "PromptRule" SET "embedding" = $1::vector WHERE id = $2`,
      `[${vec.join(',')}]`,
      ruleId,
    );
  }
}

// ─────────────────────────── types & helpers ──────────────────────────────

export interface AutoRuleExample {
  originalSnippet: string;
  editedSnippet: string;
  why: string;
}

export interface AutoRuleDraft {
  rule: string;
  ruleType: 'must_do' | 'must_not_do' | 'tone' | 'structure';
  confidence: number;
  examples: AutoRuleExample[];
  reasoning: string;
}

function isRuleType(v: unknown): v is AutoRuleDraft['ruleType'] {
  return v === 'must_do' || v === 'must_not_do' || v === 'tone' || v === 'structure';
}

function dedupeExamples(arr: AutoRuleExample[]): AutoRuleExample[] {
  const seen = new Set<string>();
  const out: AutoRuleExample[] = [];
  for (const e of arr) {
    const k = `${e.originalSnippet}::${e.editedSnippet}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

function parsePgVector(raw: string | null): number[] | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1);
  if (inner.length === 0) return [];
  const parts = inner.split(',');
  const out: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    aMag += ai * ai;
    bMag += bi * bi;
  }
  if (aMag === 0 || bMag === 0) return 0;
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}
