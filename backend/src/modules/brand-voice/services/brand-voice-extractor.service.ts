import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type LlmCallResult,
  LlmRouterService,
} from '../../ai/services/llm-router.service';
import {
  BRAND_VOICE_EXTRACT_JSON_SCHEMA,
  BRAND_VOICE_EXTRACT_SCHEMA_NAME,
  BRAND_VOICE_EXTRACT_SYSTEM_PROMPT,
  BRAND_VOICE_EXTRACTOR_VERSION,
  buildBrandVoiceExtractUserMessage,
  type BrandVoiceExtractBlock,
  type BrandVoiceExtractDocument,
} from '../prompts/brand-voice-extract.prompt';
import { brandVoiceTenantTop } from '../utils/tenant-top';
import { BrandVoiceService } from './brand-voice.service';

/**
 * SBA β-7 — BrandVoiceExtractorService.
 *
 * Daily-cron, который пересобирает BrandVoiceProfile из:
 *   - Document'ов с useCases includes 'brand_corpus' (полный parsedText
 *     с укорочением до 2000 символов на документ);
 *   - IdeaBlock'ов с signalType='brand_principle' (status=canonical).
 *
 * Anti-noise threshold: если документов меньше BRAND_VOICE_MIN_CORPUS_SIZE
 * (default 5) — пропускаем Org (нечего экстрагировать). Это страхует от
 * шумного профиля на новых тенантах.
 *
 * Idempotency window: если профиль уже собирался < 6h назад — пропускаем
 * (защита от двойного срабатывания cron'а / manual rebuild'а).
 *
 * Best-effort: ошибки логируем, продолжаем со следующим тенантом. LLM-ошибки
 * фиксируются в counter `brand_voice_extractor_runs_total{result='llm_error'}`.
 */

/** Idempotency-окно — не пересобираем профиль чаще раза в 6 часов. */
const REBUILD_DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000;

/** Лимит документов на один LLM-вызов (не больше — иначе токен-бюджет
 *  перерастёт лимит модели). */
const MAX_DOCS_PER_RUN = 30;

/** Лимит brand_principle блоков на вызов. */
const MAX_BLOCKS_PER_RUN = 50;

/** Сколько символов parsedText брать на один документ (укорочение). */
const DOC_EXCERPT_MAX_CHARS = 2000;

@Injectable()
export class BrandVoiceExtractorService {
  private readonly logger = new Logger(BrandVoiceExtractorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BrandVoiceService) private readonly profiles: BrandVoiceService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  /**
   * Прогон по всем активным тенантам (вызывается из cron'а).
   */
  async runForAllTenants(): Promise<{
    tenantsScanned: number;
    tenantsBuilt: number;
    tenantsSkippedLowCorpus: number;
    tenantsSkippedDisabled: number;
  }> {
    if (!this.cfg.brandVoice.extractorEnabled) {
      const orgs = await this.prisma.org.count({ where: { deletedAt: null } });
      // Один counter-инкремент на тенанта чисто для трекинга «прогон был, но
      // в no-op режиме». Без tenantTop разбивки — общий 'other' bucket.
      this.metrics.incBrandVoiceExtractorRun({
        tenantTop: 'other',
        result: 'skipped_disabled',
      });
      return {
        tenantsScanned: orgs,
        tenantsBuilt: 0,
        tenantsSkippedLowCorpus: 0,
        tenantsSkippedDisabled: orgs,
      };
    }

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });
    let tenantsBuilt = 0;
    let tenantsSkippedLowCorpus = 0;
    for (const org of orgs) {
      try {
        const r = await this.runForTenant({
          tenantId: org.id,
          companyName: org.name,
        });
        if (r.result === 'built') tenantsBuilt++;
        if (r.result === 'skipped_low_corpus') tenantsSkippedLowCorpus++;
      } catch (err) {
        this.logger.error(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'brand-voice-extractor: непойманная ошибка по тенанту — продолжаю',
        );
      }
    }
    return {
      tenantsScanned: orgs.length,
      tenantsBuilt,
      tenantsSkippedLowCorpus,
      tenantsSkippedDisabled: 0,
    };
  }

  /**
   * Одна итерация — для конкретного тенанта. Возвращает структурированный
   * результат для тестов и manual rebuild'а.
   */
  async runForTenant(args: {
    tenantId: string;
    companyName?: string;
  }): Promise<{
    result:
      | 'built'
      | 'skipped_low_corpus'
      | 'skipped_idempotency'
      | 'llm_error'
      | 'db_error';
    profileVersion?: number;
    corpusSize: number;
  }> {
    const tenantTop = brandVoiceTenantTop(args.tenantId);
    const corpusSize = await this.profiles.corpusSize(args.tenantId);
    this.metrics.setBrandVoiceCorpusSize({ tenantTop, value: corpusSize });

    const minCorpusSize = this.cfg.brandVoice.minCorpusSize;
    if (corpusSize < minCorpusSize) {
      this.metrics.incBrandVoiceExtractorRun({
        tenantTop,
        result: 'skipped_low_corpus',
      });
      this.logger.debug(
        { tenantId: args.tenantId, corpusSize, minCorpusSize },
        'brand-voice-extractor: корпус ниже порога — skip',
      );
      return { result: 'skipped_low_corpus', corpusSize };
    }

    // Idempotency: профиль уже собирался недавно — skip.
    const existing = await this.profiles.getRaw(args.tenantId);
    if (
      existing?.lastBuiltAt &&
      Date.now() - existing.lastBuiltAt.getTime() < REBUILD_DEDUP_WINDOW_MS
    ) {
      this.logger.debug(
        {
          tenantId: args.tenantId,
          lastBuiltAt: existing.lastBuiltAt,
        },
        'brand-voice-extractor: idempotency-окно ещё не истекло — skip',
      );
      return {
        result: 'skipped_idempotency',
        corpusSize,
        profileVersion: existing.version,
      };
    }

    // 1. Документы (parsedText) brand_corpus.
    const docs = await this.loadBrandCorpusDocuments(args.tenantId);
    // 2. brand_principle блоки.
    const blocks = await this.loadBrandPrincipleBlocks(args.tenantId);

    if (docs.length === 0 && blocks.length === 0) {
      // Корпус формально >= порога (docs > min), но parsedText по факту нет
      // (документы ещё парсятся). Скорее всего, retry на следующем cron-проходе.
      this.metrics.incBrandVoiceExtractorRun({
        tenantTop,
        result: 'skipped_low_corpus',
      });
      this.logger.debug(
        { tenantId: args.tenantId },
        'brand-voice-extractor: пустые тексты — skip',
      );
      return { result: 'skipped_low_corpus', corpusSize };
    }

    // 3. LLM call.
    const companyName = args.companyName ?? '(без названия)';
    const userMessage = buildBrandVoiceExtractUserMessage({
      companyName,
      documents: docs,
      brandPrincipleBlocks: blocks,
    });

    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'brand-voice-extract',
        systemPrompt: BRAND_VOICE_EXTRACT_SYSTEM_PROMPT,
        userMessage,
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: BRAND_VOICE_EXTRACT_SCHEMA_NAME,
          schema: BRAND_VOICE_EXTRACT_JSON_SCHEMA,
          strict: true,
        },
        dataClass: 'internal',
      });
    } catch (err) {
      this.metrics.incBrandVoiceExtractorRun({
        tenantTop,
        result: 'llm_error',
      });
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'brand-voice-extractor: LLM-вызов упал — skip',
      );
      return { result: 'llm_error', corpusSize };
    }

    const parsed = parseExtractedProfile(result.text);
    if (!parsed) {
      this.metrics.incBrandVoiceExtractorRun({
        tenantTop,
        result: 'llm_error',
      });
      this.logger.warn(
        { tenantId: args.tenantId, sample: result.text.slice(0, 200) },
        'brand-voice-extractor: LLM вернул невалидный JSON — skip',
      );
      return { result: 'llm_error', corpusSize };
    }

    // 4. Apply.
    try {
      const updated = await this.profiles.applyExtracted({
        tenantId: args.tenantId,
        tone: parsed.tone,
        values: parsed.values,
        taboos: parsed.taboos,
        exampleArtifactIds: docs.map((d) => d.documentId),
        builderAgentVersion: BRAND_VOICE_EXTRACTOR_VERSION,
      });
      this.metrics.incBrandVoiceExtractorRun({
        tenantTop,
        result: 'built',
      });
      this.logger.log(
        {
          tenantId: args.tenantId,
          version: updated.version,
          corpusSize,
          docs: docs.length,
          blocks: blocks.length,
        },
        'brand-voice-extractor: профиль собран',
      );
      return {
        result: 'built',
        corpusSize,
        profileVersion: updated.version,
      };
    } catch (err) {
      this.metrics.incBrandVoiceExtractorRun({
        tenantTop,
        result: 'db_error',
      });
      this.logger.error(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'brand-voice-extractor: запись профиля упала',
      );
      return { result: 'db_error', corpusSize };
    }
  }

  // ─────────────────────────── private ──────────────────────────────

  private async loadBrandCorpusDocuments(
    tenantId: string,
  ): Promise<BrandVoiceExtractDocument[]> {
    const rows = await this.prisma.document.findMany({
      where: {
        tenantId,
        deletedAt: null,
        useCases: { has: 'brand_corpus' },
        // parsedText может быть null, если документ ещё не распарсен —
        // фильтр на уровне SQL не делаем (Prisma не позволяет not-null на
        // нём без сложного where), отфильтруем в JS.
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_DOCS_PER_RUN,
      select: {
        id: true,
        name: true,
        mimeType: true,
        parsedText: true,
      },
    });
    return rows
      .filter(
        (r): r is typeof r & { parsedText: string } =>
          typeof r.parsedText === 'string' && r.parsedText.length > 0,
      )
      .map((r) => ({
        documentId: r.id,
        name: r.name,
        mimeType: r.mimeType,
        excerpt: r.parsedText.slice(0, DOC_EXCERPT_MAX_CHARS),
      }));
  }

  private async loadBrandPrincipleBlocks(
    tenantId: string,
  ): Promise<BrandVoiceExtractBlock[]> {
    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        signalType: 'brand_principle',
        status: 'canonical',
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_BLOCKS_PER_RUN,
      select: {
        id: true,
        name: true,
        signalType: true,
        criticalQuestion: true,
        trustedAnswer: true,
        evidence: {
          select: { quote: true },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    return blocks.map((b) => ({
      blockId: b.id,
      name: b.name,
      signalType: b.signalType,
      criticalQuestion: b.criticalQuestion,
      trustedAnswer: b.trustedAnswer,
      quote: b.evidence[0]?.quote ?? null,
    }));
  }
}

// ─────────────────────────── parsing ───────────────────────────────

interface ExtractedProfile {
  tone: Record<string, number> | null;
  values:
    | Array<{ value: string; weight: number; exampleBlockIds: string[] }>
    | null;
  taboos:
    | Array<{ phrase: string; alternative?: string; reason: string }>
    | null;
}

function parseExtractedProfile(raw: string): ExtractedProfile | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;

  // tone
  let tone: Record<string, number> | null = null;
  if (obj.tone && typeof obj.tone === 'object' && !Array.isArray(obj.tone)) {
    const t = obj.tone as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const k of Object.keys(t)) {
      const v = t[k];
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[k] = Math.max(0, Math.min(1, v));
      }
    }
    if (Object.keys(out).length > 0) tone = out;
  }

  // values
  let values:
    | Array<{ value: string; weight: number; exampleBlockIds: string[] }>
    | null = null;
  if (Array.isArray(obj.values)) {
    const list: Array<{
      value: string;
      weight: number;
      exampleBlockIds: string[];
    }> = [];
    for (const v of obj.values) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const item = v as Record<string, unknown>;
      if (typeof item.value !== 'string') continue;
      const weight =
        typeof item.weight === 'number' && Number.isFinite(item.weight)
          ? Math.max(0, Math.min(1, item.weight))
          : 0.5;
      const exampleBlockIds = Array.isArray(item.exampleBlockIds)
        ? item.exampleBlockIds.filter(
            (x): x is string => typeof x === 'string' && x.length > 0,
          )
        : [];
      list.push({ value: item.value.slice(0, 120), weight, exampleBlockIds });
    }
    if (list.length > 0) values = list;
  }

  // taboos
  let taboos:
    | Array<{ phrase: string; alternative?: string; reason: string }>
    | null = null;
  if (Array.isArray(obj.taboos)) {
    const list: Array<{
      phrase: string;
      alternative?: string;
      reason: string;
    }> = [];
    for (const t of obj.taboos) {
      if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
      const item = t as Record<string, unknown>;
      if (typeof item.phrase !== 'string') continue;
      if (typeof item.reason !== 'string') continue;
      const entry: {
        phrase: string;
        reason: string;
        alternative?: string;
      } = {
        phrase: item.phrase.slice(0, 200),
        reason: item.reason.slice(0, 500),
      };
      if (typeof item.alternative === 'string') {
        entry.alternative = item.alternative.slice(0, 200);
      }
      list.push(entry);
    }
    if (list.length > 0) taboos = list;
  }

  if (!tone && !values && !taboos) return null;
  return { tone, values, taboos };
}
