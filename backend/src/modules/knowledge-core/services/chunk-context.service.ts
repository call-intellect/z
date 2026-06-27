import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';

export const CONTEXT_HEADER_VERSION = 'v2';

const CHUNK_CONTEXT_SYSTEM_PROMPT =
  'Ты добавляешь одно короткое предложение контекста к фрагменту встречи для ' +
  'улучшения поиска. Верни ровно одно предложение по-русски, без преамбул.';

const CHUNK_CONTEXT_MAX_TOKENS = 120;
const CHUNK_CONTEXT_MAX_CHARS = 300;
const MAX_COMPANIES = 12;
const MAX_PARTICIPANTS = 24;

export interface ContextHeaderInput {
  sourceTitle?: string | null;
  companies?: string[];
  participants?: string[];
  meetingType?: string | null;
  meetingDateIso?: string | null;
}

export interface ChunkContextArgs extends ContextHeaderInput {
  tenantId: string;
}

function normalizeList(values: string[] | undefined, limit: number): string[] {
  if (!values || values.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = typeof v === 'string' ? v.trim() : '';
    if (t.length === 0) continue;
    const key = t.toLocaleLowerCase('ru');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  out.sort((a, b) => a.localeCompare(b, 'ru'));
  return out.slice(0, limit);
}

export function buildMetaLine(input: ContextHeaderInput): string {
  const companies = normalizeList(input.companies, MAX_COMPANIES);
  const participants = normalizeList(input.participants, MAX_PARTICIPANTS);
  const title = input.sourceTitle?.trim();

  const stable: string[] = [];
  if (title && title.length > 0) stable.push(`источник «${title}»`);
  if (companies.length > 0) stable.push(`компании: ${companies.join(', ')}`);
  if (participants.length > 0) stable.push(`участники: ${participants.join(', ')}`);

  const variable: string[] = [];
  const type = input.meetingType?.trim();
  if (type && type.length > 0) variable.push(`тип ${type}`);
  const date = formatDate(input.meetingDateIso);
  if (date) variable.push(`дата ${date}`);

  const all = [...stable, ...variable];
  if (all.length === 0) return '';
  return `Контекст: ${all.join(', ')}`;
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getUTCFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

@Injectable()
export class ChunkContextService {
  private readonly logger = new Logger(ChunkContextService.name);

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  buildMetaLine(input: ContextHeaderInput): string {
    return buildMetaLine(input);
  }

  async buildContextHeader(args: ChunkContextArgs): Promise<string> {
    const meta = buildMetaLine(args);
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
}
