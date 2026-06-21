import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { TypedConfigService } from '../../common/config/index';
import type { LlmRouterService } from '../ai/services/llm-router.service';
import {
  PROBE_FORMULATE_SYSTEM_PROMPT,
  PROBE_FORMULATE_USER_TEMPLATE,
} from '../knowledge-core/prompts/probe-formulate.prompt';
import {
  PROVENANCE_ACCESS_MASK,
  ProvenanceService,
} from '../knowledge-core/services/provenance.service';
import type { S3Service } from '../recordings/s3.service';
import { KnowledgeAccessResolver } from '../rbac/knowledge-access-resolver.service';
import { RbacService } from '../rbac/rbac.service';

import { ProbeFormulationService } from './probe-formulation.service';
import {
  PROBE_REASON_FALLBACK,
  PROBE_REASON_FALLBACK_DEFAULT,
  PROBE_REASON_LABEL,
} from './probe-reason-labels';
import { deriveDigestQuestion } from './probe-text.util';
import {
  PROBE_VALUE_GATE_SYSTEM_PROMPT,
  PROBE_VALUE_GATE_USER,
} from './prompts/probe-value-gate.prompt';
import { PROBE_QUALITY_JUDGE_USER } from './prompts/probe-quality-judge.prompt';
import { buildProbeDigestSummary } from './prompts/probe-digest.prompt';
import type { SubjectMemoryService } from './subject-memory/subject-memory.service';

const log = (...a: unknown[]) => console.log('[synthetic]', ...a);

interface SyntheticCase {
  id: string;
  group: 'good' | 'noise';
  reason: string;
  objectName: string;
  objectKindRu: string;
  message: string;
  expectAsk: boolean;
}

const CASES: SyntheticCase[] = [
  {
    id: 'reg-owner',
    group: 'good',
    reason: 'regulation.missing_owner',
    objectName: 'Приёмка товара на складе',
    objectKindRu: 'регламент',
    message: 'У регламента «Приёмка товара на складе» нет ответственного.',
    expectAsk: true,
  },
  {
    id: 'dec-overdue',
    group: 'good',
    reason: 'decision.overdue',
    objectName: 'Перейти на нового подрядчика по логистике',
    objectKindRu: 'решение',
    message: 'Решение «Перейти на нового подрядчика по логистике» просрочено.',
    expectAsk: true,
  },
  {
    id: 'proc-input',
    group: 'good',
    reason: 'process_template.missing_input_artifact',
    objectName: 'Настройка рабочего аккаунта',
    objectKindRu: 'шаг процесса',
    message: 'У шага «Настройка рабочего аккаунта» не указан вход.',
    expectAsk: true,
  },
  {
    id: 'noise-empty',
    group: 'noise',
    reason: 'process_template.missing_output_artifact',
    objectName: '',
    objectKindRu: 'шаг процесса',
    message: '',
    expectAsk: false,
  },
  {
    id: 'noise-generic',
    group: 'noise',
    reason: 'card.outdated_summary',
    objectName: 'отчёт',
    objectKindRu: 'карточка',
    message: 'Описание устарело.',
    expectAsk: false,
  },
];

function syntheticProbe(c: SyntheticCase): {
  id: string;
  tenantId: string;
  reason: string;
  payload: Record<string, unknown>;
} {
  return {
    id: `probe-${c.id}`,
    tenantId: 't-1',
    reason: c.reason,
    payload: {
      objectName: c.objectName || undefined,
      objectKindRu: c.objectKindRu,
      message: c.message || undefined,
      contextCardTitle: c.objectName || undefined,
    },
  };
}

function extractObject(user: string): string {
  const m = user.match(/«([^»]+)»/);
  return m ? m[1]! : '';
}

function stubFormulationService(): ProbeFormulationService {
  const cfg = {
    getDynamic: vi.fn(async () => true),
    aiFeatures: { promptInjectionGuardEnabled: false },
    subjectMemory: {
      enabled: false,
      retrieveBeforeAskEnabled: false,
      matchMinSimilarity: 0.82,
      suppressMinConfidence: 0.7,
    },
  } as unknown as TypedConfigService;
  const metrics = {
    incProbeQualityJudged: vi.fn(),
  } as unknown as BusinessMetricsService;

  const llm = {
    call: vi.fn(async (p: { taskType: string; userMessage: string }) => {
      const obj = extractObject(p.userMessage);
      if (p.taskType === 'probe-value-gate') {
        const generic = ['отчёт', 'задача', 'документ', 'карточка'].includes(
          obj.toLowerCase(),
        );
        const ask = obj.length > 0 && !generic;
        return {
          text: JSON.stringify({
            ask,
            reason: ask ? 'есть конкретный объект' : 'опереться не на что',
          }),
        };
      }
      if (p.taskType === 'probe-formulate') {
        const q = obj
          ? `Что сейчас с «${obj}» — кто за это отвечает?`
          : 'По какому шагу процесса нужен вход?';
        return { text: JSON.stringify({ question: q }) };
      }
      if (p.taskType === 'probe-quality-judge') {
        const occ = obj ? p.userMessage.split(obj).length - 1 : 2;
        const namesObject = occ >= 2;
        return {
          text: JSON.stringify(
            namesObject
              ? { ok: true }
              : { ok: false, issues: ['missing_object'], rewrite: `Что сейчас с «${obj}»?` },
          ),
        };
      }
      return { text: '{}' };
    }),
  } as unknown as LlmRouterService;

  const subjectMemory = {
    findApplicableRule: vi.fn().mockResolvedValue(null),
    findRelevantRules: vi.fn().mockResolvedValue([]),
  } as unknown as SubjectMemoryService;
  return new ProbeFormulationService(llm, metrics, cfg, subjectMemory);
}

describe('СИНТЕТИКА — промпты probe собираются на реалистичных данных', () => {
  it('formulate USER несёт объект и тип; SYSTEM держит правило «НАЗОВИ ОБЪЕКТ»', () => {
    const c = CASES[0]!;
    const user = PROBE_FORMULATE_USER_TEMPLATE({
      reasonLabel: PROBE_REASON_LABEL[c.reason]!,
      message: c.message,
      suggestedActions: [],
      objectName: c.objectName,
      objectKindRu: c.objectKindRu,
    });
    log('--- PROBE_FORMULATE SYSTEM (фрагмент) ---');
    log(PROBE_FORMULATE_SYSTEM_PROMPT.split('\n').slice(0, 6).join('\n'));
    log('--- PROBE_FORMULATE USER (reg-owner) ---\n' + user);
    expect(PROBE_FORMULATE_SYSTEM_PROMPT).toContain('НАЗОВИ ОБЪЕКТ');
    expect(user).toContain('Приёмка товара на складе');
    expect(user).toContain('Тип объекта: регламент');
  });

  it('value-gate USER различает пустой объект; judge USER несёт объект', () => {
    const noise = CASES[3]!;
    const gateUser = PROBE_VALUE_GATE_USER({
      reasonLabel: PROBE_REASON_LABEL[noise.reason]!,
      objectName: undefined,
      objectKindRu: noise.objectKindRu,
      message: undefined,
    });
    log('--- PROBE_VALUE_GATE SYSTEM (фрагмент) ---');
    log(PROBE_VALUE_GATE_SYSTEM_PROMPT.split('\n').slice(0, 3).join('\n'));
    log('--- GATE USER (noise-empty) ---\n' + gateUser);
    expect(gateUser).toContain('(не определён)');

    const judgeUser = PROBE_QUALITY_JUDGE_USER({
      question: 'Кто отвечает за этот регламент?',
      objectName: 'Приёмка товара',
    });
    log('--- JUDGE USER ---\n' + judgeUser);
    expect(judgeUser).toContain('Приёмка товара');
  });
});

describe('СИНТЕТИКА — конвейер gate→formulate→judge (stub-LLM по логике промптов)', () => {
  it('каждый кейс проходит конвейер; шум глушится, нужное называет объект', async () => {
    const svc = stubFormulationService();
    log('\n========= ПРОГОН КОНВЕЙЕРА =========');
    for (const c of CASES) {
      const probe = syntheticProbe(c) as never;
      const verdict = await svc.gate(probe);
      if (!verdict.ask) {
        log(`[${c.id}] ГЕЙТ ПРОМОЛЧАЛ → ${verdict.reason}`);
        expect(c.expectAsk).toBe(false);
        continue;
      }
      const { question } = await svc.formulate(probe);
      const finalQ = await svc.judgeQuality(probe, question);
      log(`[${c.id}] ВОПРОС → «${finalQ}»`);
      expect(c.expectAsk).toBe(true);
      expect(finalQ.length).toBeGreaterThan(0);
      expect(finalQ).not.toBe('Можете уточнить, пожалуйста?');
      if (c.objectName) expect(finalQ).toContain(c.objectName);
    }
  });

  it('судья переписывает безымянный вопрос, вставляя объект', async () => {
    const svc = stubFormulationService();
    const probe = syntheticProbe(CASES[0]!) as never;
    const rewritten = await svc.judgeQuality(
      probe,
      'Кто отвечает за этот регламент?',
    );
    log(`\n[judge] безымянный → «${rewritten}»`);
    expect(rewritten).toContain('Приёмка товара на складе');
  });
});

describe('СИНТЕТИКА — детерминированный стоп-кран дайджеста', () => {
  it('пустых вопросов нет; объект не дублируется в скобке', () => {
    const built = CASES.filter((c) => c.expectAsk).map((c) => ({
      question: deriveDigestQuestion(
        c.reason,
        { message: c.message },
        PROBE_REASON_FALLBACK,
        PROBE_REASON_FALLBACK_DEFAULT,
      ),
      objectTitle: c.objectName,
      probeEventId: c.id,
    }));
    const summary = buildProbeDigestSummary(built);
    log('\n========= ДАЙДЖЕСТ (детерминированный фолбэк) =========\n' + summary);
    for (const item of built) {
      expect(item.question).not.toBe('Можете уточнить, пожалуйста?');
    }
    expect(summary).not.toContain('((');
  });
});

describe('СИНТЕТИКА — провенанс резолвит источник и уважает права зрителя', () => {
  function provenanceFor(closed: boolean): {
    svc: ProvenanceService;
    member: { tenantId: string; userId: string };
  } {
    const resolverPrisma = {
      ideaBlockAccess: {
        findMany: vi.fn(async () =>
          closed
            ? [
                {
                  blockId: 'b-1',
                  groupId: 'g-council',
                  group: { isClosed: true, kind: 'council' },
                },
              ]
            : [],
        ),
      },
    } as unknown as PrismaService;
    const resolver = new KnowledgeAccessResolver(
      resolverPrisma,
      Object.create(RbacService.prototype) as RbacService,
    );
    vi.spyOn(resolver, 'resolveAccessibleGroups').mockResolvedValue({
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: false,
    });

    const servicePrisma = {
      decision: {
        findFirst: vi.fn(async () => ({ sourceBlockIds: ['b-1'] })),
      },
      ideaBlock: {
        findMany: vi.fn(async () => [{ id: 'b-1', primarySource: 'transcript' }]),
      },
      ideaBlockEvidence: {
        findMany: vi.fn(async () => [
          {
            blockId: 'b-1',
            rawEventId: 'raw-1',
            quote: 'Договорились перейти на недельные спринты',
            startMs: 90_000,
            endMs: 95_000,
            sourceTimestamp: new Date('2026-03-10T09:00:00.000Z'),
          },
        ]),
      },
      rawEvent: {
        findMany: vi.fn(async () => [
          { id: 'raw-1', sourceType: 'meeting', sourceExternalId: 'm-1' },
        ]),
      },
      meeting: { findMany: vi.fn(async () => [{ id: 'm-1', title: 'Планёрка 10 марта' }]) },
      document: { findMany: vi.fn(async () => []) },
    } as unknown as PrismaService;

    const s3 = {
      presignGet: vi.fn(async () => ({
        url: 'https://s3.example/presigned',
        expiresAt: new Date('2026-06-21T00:10:00.000Z'),
      })),
    } as unknown as S3Service;
    const cfg = {
      getDynamic: vi.fn(async (_k: string, _e: unknown, def: unknown) => def),
    } as unknown as TypedConfigService;

    return {
      svc: new ProvenanceService(servicePrisma, resolver, s3, cfg),
      member: { tenantId: 't-1', userId: 'u-1' },
    };
  }

  it('зритель с доступом → цитата + deep-link к моменту встречи', async () => {
    const { svc, member } = provenanceFor(false);
    const nodes = await svc.resolve('decision', 'd-1', member);
    log('\n========= ПРОВЕНАНС (доступ есть) =========');
    log(JSON.stringify(nodes[0], null, 2));
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.quote).toContain('недельные спринты');
    expect(nodes[0]!.source.deepLink).toBe('/meetings/m-1?t=90');
    expect(nodes[0]!.attribution).toBe('quoted');
  });

  it('зритель без доступа к закрытому блоку → цитата и название встречи скрыты', async () => {
    const { svc, member } = provenanceFor(true);
    const nodes = await svc.resolve('decision', 'd-1', member);
    log('\n========= ПРОВЕНАНС (доступ закрыт) =========');
    log(JSON.stringify(nodes[0], null, 2));
    expect(nodes[0]!.accessFiltered).toBe(true);
    expect(nodes[0]!.quote).toBe(PROVENANCE_ACCESS_MASK);
    expect(nodes[0]!.source.label).not.toContain('Планёрка');
    expect(nodes[0]!.source.deepLink).toBeNull();
  });
});
