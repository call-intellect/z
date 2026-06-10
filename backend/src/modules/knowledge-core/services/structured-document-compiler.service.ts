import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import {
  type LlmCallResult,
  LlmRouterService,
} from '../../ai/services/llm-router.service';
import { applyInputGuards } from '../../ai/services/prompts/common';
import {
  COMPILE_ORG_DOCUMENT_MAX_TOKENS,
  COMPILE_ORG_DOCUMENT_TASK_TYPE,
  COMPILE_ORG_DOCUMENT_TOOL,
  COMPILE_ORG_DOCUMENT_TOOL_NAME,
  CompileOrgDocumentOutputSchema,
  buildCompileOrgDocumentSystemPrompt,
  buildCompileOrgDocumentUserMessage,
  type CompiledStep,
  type CompileOrgDocumentInput,
} from '../prompts/structured-document-compiler.prompt';

/**
 * Волна 6 Стадия C, A7 — StructuredDocumentCompilerService.
 *
 * Единый владелец сборки `contentMd` орг-документа (regulation/process/policy/
 * instruction). Вызывается специалистом 3.1 после regulation-dedupe на verdict
 * merge/extension: вместо plain-конкатенации поля собирает структурный документ
 * по шаблону типа в двух режимах (СОЗДАНИЕ / ДОПОЛНЕНИЕ).
 *
 * Best-effort: при любой ошибке (LLM упал, tool не вернулся, zod-валидация не
 * прошла) — лог + возврат fallback (`existingContentMd` как есть), НЕ падаем.
 * Это значит, что dedupe-путь специалиста никогда не ломается из-за компилятора.
 */
@Injectable()
export class StructuredDocumentCompilerService {
  private readonly logger = new Logger(StructuredDocumentCompilerService.name);

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

  /** Kill-switch агента-компилятора (дефолт ON). */
  isEnabled(): boolean {
    try {
      return this.cfg?.aiFeatures.docCompilerEnabled !== false;
    } catch {
      return true;
    }
  }

  /** Мастер-флаг защиты от prompt-injection (дефолт ON). */
  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  /**
   * Собрать документ из материала. Возвращает готовый markdown + шаги (для
   * process) + changeReason + signals. На любой ошибке — fallback к
   * existingContentMd (best-effort).
   */
  async compile(
    input: CompileOrgDocumentInput,
    ctx: { tenantId: string | null; dataClass?: 'public' | 'internal' | 'sensitive' | 'private'; sourceRef?: { type: string; id: string } | null } = {
      tenantId: null,
    },
  ): Promise<CompileResult> {
    const existing = input.existingContentMd ?? '';
    const fallback: CompileResult = {
      contentMd: existing,
      steps: input.existingSteps?.map((s) => ({
        title: s.title,
        description: s.description ?? '',
      })) ?? [],
      changeReason: '',
      signals: [],
      ok: false,
    };

    // ── 1. Сборка пары (system, user) + входные guard'ы (E1/E2) ──
    const rawSystem = buildCompileOrgDocumentSystemPrompt();
    const rawUser = buildCompileOrgDocumentUserMessage(input);
    const { system, user } = applyInputGuards(rawSystem, rawUser, {
      injection: true,
      enabled: this.isPromptInjectionGuardEnabled(),
      meetingDateIso: input.nowIso ?? null,
    });

    // ── 2. LLM-вызов (tool-use) ──
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: COMPILE_ORG_DOCUMENT_TASK_TYPE,
        systemPrompt: system,
        userMessage: user,
        tenantId: ctx.tenantId,
        maxTokens: COMPILE_ORG_DOCUMENT_MAX_TOKENS,
        tools: [COMPILE_ORG_DOCUMENT_TOOL],
        sourceRef: ctx.sourceRef ?? null,
        dataClass: ctx.dataClass ?? 'internal',
      });
    } catch (err) {
      this.logger.warn(
        {
          kind: input.kind,
          name: input.name,
          err: err instanceof Error ? err.message : String(err),
        },
        'structured-document-compiler: LLM упал — fallback к existingContentMd',
      );
      return fallback;
    }

    // ── 3. Парсинг tool_call ──
    try {
      const parsed = this.parseToolCallOutput(result.toolCalls, result.text);
      // Для не-process типов steps игнорируем (downstream синхронизирует только
      // process). Защита от пустого contentMd: если модель вернула пусто — это
      // не валидный документ, fallback.
      if (!parsed.contentMd || parsed.contentMd.trim().length === 0) {
        this.logger.warn(
          { kind: input.kind, name: input.name },
          'structured-document-compiler: пустой contentMd — fallback',
        );
        return fallback;
      }
      return {
        contentMd: parsed.contentMd,
        steps: input.kind === 'process' ? parsed.steps : [],
        changeReason:
          parsed.changeReason ||
          (existing.trim().length > 0
            ? 'дополнение из материала'
            : 'первичная сборка из материала'),
        signals: parsed.signals,
        ok: true,
      };
    } catch (err) {
      this.logger.warn(
        {
          kind: input.kind,
          name: input.name,
          err: err instanceof Error ? err.message : String(err),
          textSample: result.text.slice(0, 300),
        },
        'structured-document-compiler: парсинг tool_call упал — fallback',
      );
      return fallback;
    }
  }

  /**
   * Извлекает вход tool'а из toolCalls (приоритет — наш tool по имени), иначе
   * пытается распарсить fallback-text как JSON. Зеркалит логику
   * SpecialistsCombinedService.parseToolCallOutput.
   */
  private parseToolCallOutput(
    toolCalls: Array<{ name: string; input: unknown }> | undefined,
    fallbackText: string,
  ): { contentMd: string; steps: CompiledStep[]; changeReason: string; signals: string[] } {
    let rawInput: unknown = null;

    if (toolCalls && toolCalls.length > 0) {
      const direct = toolCalls.find(
        (tc) => tc.name === COMPILE_ORG_DOCUMENT_TOOL_NAME,
      );
      rawInput = (direct ?? toolCalls[0])?.input ?? null;
    }

    if (rawInput === null && fallbackText) {
      try {
        rawInput = JSON.parse(fallbackText);
      } catch {
        // ignore — упадём на zod ниже.
      }
    }

    if (rawInput === null) {
      throw new Error(
        `LLM не вернул tool_calls (${COMPILE_ORG_DOCUMENT_TOOL_NAME}) и не вернул валидный JSON в text`,
      );
    }

    // Некоторые провайдеры сериализуют arguments как строку.
    if (typeof rawInput === 'string') {
      rawInput = JSON.parse(rawInput);
    }

    const validated = CompileOrgDocumentOutputSchema.safeParse(rawInput);
    if (!validated.success) {
      throw new Error(
        `LLM-output не прошёл zod-валидацию: ${validated.error.message}`,
      );
    }
    return validated.data;
  }
}

/** Результат компиляции. `ok=false` — вернулся fallback (existingContentMd). */
export interface CompileResult {
  contentMd: string;
  steps: CompiledStep[];
  changeReason: string;
  signals: string[];
  ok: boolean;
}
