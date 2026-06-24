import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';

const CHUNK_CONTEXT_SYSTEM_PROMPT =
  'Ты добавляешь одно короткое предложение контекста к фрагменту встречи для ' +
  'улучшения поиска. Верни ровно одно предложение по-русски, без преамбул.';

const CHUNK_CONTEXT_MAX_TOKENS = 120;
const CHUNK_CONTEXT_MAX_CHARS = 300;

export interface ChunkContextArgs {
  tenantId: string;
  meetingTitle?: string;
  meetingType?: string;
  meetingDateIso?: string;
  participants?: string[];
}

@Injectable()
export class ChunkContextService {
  private readonly logger = new Logger(ChunkContextService.name);

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async buildContextHeader(args: ChunkContextArgs): Promise<string> {
    const meta = this.buildMetaLine(args);
    if (meta.length === 0) return '';

    const enabled = await this.cfg.getDynamic<boolean>(
      'knowledge.contextual_header_enabled',
      undefined,
      true,
    );
    if (!enabled) return meta;

    try {
      const result = await this.llm.call({
        taskType: 'chunk-context',
        tenantId: args.tenantId,
        systemPrompt: withInjectionGuard(CHUNK_CONTEXT_SYSTEM_PROMPT),
        userMessage: wrapUserData(meta),
        maxTokens: CHUNK_CONTEXT_MAX_TOKENS,
        dataClass: 'internal',
      });
      const sentence = (result.text ?? '').replace(/\s+/gu, ' ').trim();
      if (sentence.length === 0) return meta.slice(0, CHUNK_CONTEXT_MAX_CHARS);
      return `${meta} ${sentence}`.slice(0, CHUNK_CONTEXT_MAX_CHARS);
    } catch (err) {
      this.logger.debug(
        { tenantId: args.tenantId, err: err instanceof Error ? err.message : String(err) },
        'chunk-context: LLM-обогащение упало — отдаём только метастроку (fail-open)',
      );
      return meta.slice(0, CHUNK_CONTEXT_MAX_CHARS);
    }
  }

  private buildMetaLine(args: ChunkContextArgs): string {
    const parts: string[] = [];
    const title = args.meetingTitle?.trim();
    if (title) parts.push(`встреча «${title}»`);
    const type = args.meetingType?.trim();
    if (type) parts.push(`тип ${type}`);
    const date = this.formatDate(args.meetingDateIso);
    if (date) parts.push(`дата ${date}`);
    const participants = (args.participants ?? [])
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (participants.length > 0) parts.push(`участники: ${participants.join(', ')}`);
    if (parts.length === 0) return '';
    return `Контекст: ${parts.join(', ')}`;
  }

  private formatDate(iso: string | undefined): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = String(d.getUTCFullYear());
    return `${dd}.${mm}.${yyyy}`;
  }
}
