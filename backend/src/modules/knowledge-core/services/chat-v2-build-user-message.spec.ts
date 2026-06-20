import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';

import type { ChatV2RetrievalService } from './chat-v2-retrieval.service';
import {
  ChatV2Service,
  CONTRADICTING_FACT_TAG,
  CONTRADICTIONS_HEADER,
  REASONING_CHAIN_TAG_PREFIX,
  TABLE_TAG_PREFIX,
} from './chat-v2.service';
import type { ProvenanceService } from './provenance.service';

interface ContextBlockLike {
  id: string;
  name: string;
  signalType: string;
  trustedAnswer: string;
  dataClass: 'public' | 'internal' | 'sensitive' | 'private';
  primaryMeetingEvidence: {
    meetingId: string;
    meetingTitle: string;
    startMs: number;
    endMs: number;
    snippet: string;
  } | null;
  primaryDocumentSource: null;
}

interface ReasoningChainLike {
  seedBlockId: string;
  depth: 1 | 2;
  nodes: ReadonlyArray<{
    id: string;
    name: string;
    signalType: string;
    criticalQuestion: string;
    trustedAnswer: string;
    depth: number;
  }>;
}

interface ContradictingLike {
  id: string;
  name: string;
  signalType: string;
  trustedAnswer: string;
  contradictsBlockId: string;
}

type BuildUserMessageFn = (
  query: string,
  blocks: ReadonlyArray<ContextBlockLike>,
  reasoningChains: ReadonlyArray<ReasoningChainLike>,
  contradictingBlocks: ReadonlyArray<ContradictingLike>,
  extra?: {
    conversationSummary?: string | null;
    history?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
    tableRows?: ReadonlyArray<{ tableName: string; cells: string }>;
  },
) => string;

function makeService(): ChatV2Service {
  const prisma = {} as unknown as PrismaService;
  const cfg = {} as unknown as TypedConfigService;
  const metrics = {} as unknown as BusinessMetricsService;
  const llm = { call: vi.fn() } as unknown as LlmRouterService;
  const retrieval = {
    fetchCandidates: vi.fn(),
  } as unknown as ChatV2RetrievalService;
  const accessResolver = {
    partitionBlockIdsByAccess: vi.fn(),
  } as unknown as KnowledgeAccessResolver;

  const provenance = {
    resolveByRawEventIds: vi.fn(async () => new Map()),
  } as unknown as ProvenanceService;

  return new ChatV2Service(
    prisma,
    cfg,
    llm,
    retrieval,
    metrics,
    accessResolver,
    provenance,
    undefined,
    undefined,
  );
}

function build(svc: ChatV2Service, ...args: Parameters<BuildUserMessageFn>): string {
  const fn = (svc as unknown as { buildUserMessage: BuildUserMessageFn }).buildUserMessage;
  return fn.apply(svc, args);
}

const baseBlock: ContextBlockLike = {
  id: 'b1',
  name: 'Риск ухода клиента',
  signalType: 'churn_risk',
  trustedAnswer: 'Клиент намекнул, что рассматривает конкурента.',
  dataClass: 'internal',
  primaryMeetingEvidence: {
    meetingId: 'm1',
    meetingTitle: 'Звонок с клиентом',
    startMs: 65_000,
    endMs: 70_000,
    snippet: 'мы думаем уйти к другим',
  },
  primaryDocumentSource: null,
};

describe('ChatV2Service.buildUserMessage — человеческий русский контекст (ТЗ 06-15)', () => {
  it('тип блока приходит ПО-РУССКИ (SIGNAL_TYPE_CONTEXT_RU), не кодом enum', () => {
    const svc = makeService();
    const out = build(svc, 'Какие риски по клиенту?', [baseBlock], [], []);

    expect(out).toContain('(риск оттока)');
    expect(out).not.toContain('(churn_risk)');
    expect(out).toContain('[BLOCK:b1]');
    expect(out).toContain('Из встречи "Звонок с клиентом" [01:05]:');
  });

  it('Память диалога (summary + history) — в начале USER, «Вопрос:» — в конце', () => {
    const svc = makeService();
    const out = build(svc, 'Что дальше?', [baseBlock], [], [], {
      conversationSummary: 'Обсуждали продление договора.',
      history: [
        { role: 'user', content: 'Когда продлеваем?' },
        { role: 'assistant', content: 'В следующем квартале.' },
      ],
    });

    expect(out).toContain('Краткое содержание диалога:');
    expect(out).toContain('Обсуждали продление договора.');
    expect(out).toContain('Последние сообщения диалога:');
    expect(out).toContain('- Пользователь: Когда продлеваем?');
    expect(out).toContain('- Ассистент: В следующем квартале.');

    expect(out.indexOf('Краткое содержание диалога:')).toBeLessThan(out.indexOf('Контекст:'));
    expect(out.trimEnd().endsWith('Что дальше?')).toBe(true);
  });

  it('summary/history опускаются, если их нет', () => {
    const svc = makeService();
    const out = build(svc, 'Вопрос?', [baseBlock], [], []);
    expect(out).not.toContain('Краткое содержание диалога:');
    expect(out).not.toContain('Последние сообщения диалога:');
    expect(out.startsWith('Контекст:')).toBe(true);
  });

  it('история длиннее 600 символов обрезается с многоточием', () => {
    const svc = makeService();
    const long = 'я'.repeat(800);
    const out = build(svc, 'Вопрос?', [baseBlock], [], [], {
      history: [{ role: 'user', content: long }],
    });
    expect(out).toContain('…');
    expect(out).not.toContain('я'.repeat(700));
  });

  it('противоречащие факты — русский тег + русский заголовок, тип по-русски', () => {
    const svc = makeService();
    const out = build(
      svc,
      'Какая дата запуска?',
      [baseBlock],
      [],
      [
        {
          id: 'c1',
          name: 'Дата запуска',
          signalType: 'decision',
          trustedAnswer: 'Запуск перенесён на май.',
          contradictsBlockId: 'b1',
        },
      ],
    );

    expect(out).toContain(CONTRADICTIONS_HEADER);
    expect(out).toContain(CONTRADICTING_FACT_TAG);
    expect(out).toContain('(противоречит [BLOCK:b1])');
    expect(out).toContain('[BLOCK:c1]');
    expect(out).toContain('(решение)');
    expect(out).not.toContain('CONTRADICTING BLOCK');
    expect(out).not.toContain('counter-evidence');
  });

  it('цепочка рассуждения — русский тег без служебных depth/nodes, узлы по-русски', () => {
    const svc = makeService();
    const out = build(
      svc,
      'Почему убрали скидку?',
      [baseBlock],
      [
        {
          seedBlockId: 'b1',
          depth: 2,
          nodes: [
            {
              id: 'b1',
              name: 'seed',
              signalType: 'decision',
              criticalQuestion: '',
              trustedAnswer: 'seed',
              depth: 0,
            },
            {
              id: 'n2',
              name: 'Маржа падала',
              signalType: 'rationale',
              criticalQuestion: '',
              trustedAnswer: 'Скидка съедала маржу.',
              depth: 1,
            },
          ],
        },
      ],
      [],
    );

    expect(out).toContain(`${REASONING_CHAIN_TAG_PREFIX} b1]`);
    expect(out).not.toContain('REASONING CHAIN FOR BLOCK');
    expect(out).not.toContain('depth=');
    expect(out).not.toContain('nodes=');
    expect(out).toContain('(обоснование) Маржа падала: Скидка съедала маржу.');
  });

  it('блок «Данные из таблиц» — только если переданы строки (ЧАСТЬ B)', () => {
    const svc = makeService();
    const without = build(svc, 'Вопрос?', [baseBlock], [], []);
    expect(without).not.toContain('Данные из таблиц:');
    expect(without).not.toContain(TABLE_TAG_PREFIX);

    const withRows = build(svc, 'Сколько клиентов из Москвы?', [baseBlock], [], [], {
      tableRows: [{ tableName: 'Клиенты', cells: 'Город=Москва; Статус=активен' }],
    });
    expect(withRows).toContain('Данные из таблиц:');
    expect(withRows).toContain('[ТАБЛИЦА: Клиенты] Город=Москва; Статус=активен');
  });
});
