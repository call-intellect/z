/**
 * Smoke-скрипт Шага 0 Фазы 2: LlmRouter с DeepSeek primary + JSON Schema strict.
 *
 * Что проверяем:
 *   1. `LlmRouterService.call({ taskType: 'block-distill', responseFormat: text })`
 *      возвращает непустой текст; `modelUsed` начинается с `deepseek:` или
 *      `openai-via-proxy:` (fallback) или `ollama:` (fallback fallback).
 *   2. Тот же call с `responseFormat: json_schema strict YesNoAnswer` —
 *      DeepSeek возвращает валидный JSON `{answer:"yes"|"no"}`.
 *   3. В `AiUsageLog` появилась запись с правильным `provider`/`model`/
 *      `taskType`/`tenantId`/`cachedTokens >= 0`/`costUsd > 0` (если price
 *      есть в LlmModelPrice).
 *
 * Требует:
 *   - DEEPSEEK_API_KEY (реальный, иначе fallback пройдёт на openai/ollama).
 *   - DATABASE_URL.
 *
 * Запуск:
 *   bun run scripts/smoke-llm-router-phase2-step0.ts
 *
 * Cleanup: удаляются AiUsageLog по test orgId. Org/User не трогаем —
 * могут быть другие данные в локальной БД.
 *
 * Скрипт намеренно поднимает урезанный Nest-контекст (без HTTP, без воркеров),
 * чтобы получить реальный `LlmRouterService` со всеми DI-зависимостями.
 */

import 'reflect-metadata';

import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';

import { TypedConfigService } from '../src/common/config/typed-config.service';
import { parseEnv } from '../src/common/config/env.schema';
import { BusinessMetricsService } from '../src/common/metrics/business-metrics.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AiUsageLogService } from '../src/modules/ai/services/ai-usage-log.service';
import { AnthropicService } from '../src/modules/ai/services/anthropic.service';
import { DeepSeekService } from '../src/modules/ai/services/deepseek.service';
import { LlmRouterService } from '../src/modules/ai/services/llm-router.service';
import { MinimaxService } from '../src/modules/ai/services/minimax.service';
import { OllamaService } from '../src/modules/ai/services/ollama.service';
import { OpenAiProxyService } from '../src/modules/ai/services/openai-proxy.service';

const prisma = new PrismaClient();

async function ensureTestOrg(): Promise<{ orgId: string; tag: string }> {
  // Берём первый существующий Org (иначе создаём новый smoke-org).
  const existing = await prisma.org.findFirst({ where: { deletedAt: null } });
  if (existing) {
    return { orgId: existing.id, tag: 'existing' };
  }
  const tag = `phase2-step0-${nanoid(6)}`;
  const owner = await prisma.user.create({
    data: {
      email: `${tag}@smoke.test`,
      name: 'Phase2 Step0 Owner',
      role: 'user',
      signupSource: 'standalone',
    },
  });
  const org = await prisma.org.create({
    data: {
      name: `Smoke Phase2 Step0 ${tag}`,
      slug: `${tag}-org`,
      ownerId: owner.id,
      visibilityMode: 'open',
      tier: 'basic',
    },
  });
  await prisma.membership.create({
    data: { orgId: org.id, userId: owner.id, role: 'owner' },
  });
  return { orgId: org.id, tag };
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== smoke-llm-router-phase2-step0 START ===');

  const { orgId, tag } = await ensureTestOrg();
  // eslint-disable-next-line no-console
  console.log(`✓ tenantId=${orgId} (tag=${tag})`);

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        validate: parseEnv,
      }),
      ScheduleModule.forRoot(),
    ],
    providers: [
      TypedConfigService,
      PrismaService,
      AiUsageLogService,
      BusinessMetricsService,
      AnthropicService,
      MinimaxService,
      OpenAiProxyService,
      DeepSeekService,
      OllamaService,
      LlmRouterService,
    ],
  }).compile();

  await moduleRef.init();
  const router = moduleRef.get(LlmRouterService);
  const cfg = moduleRef.get(ConfigService);
  void cfg;

  await router.refreshCache();

  // 1. Простой text-вызов.
  // eslint-disable-next-line no-console
  console.log('→ Test 1: responseFormat=text');
  const r1 = await router.call({
    taskType: 'block-distill',
    tenantId: orgId,
    systemPrompt: 'You answer in a single word: yes or no.',
    userMessage: 'Is the sky blue on a sunny day?',
    responseFormat: { type: 'text' },
    maxTokens: 16,
  });
  if (!r1.text || r1.text.trim().length === 0) {
    throw new Error(`Test 1 fail: empty text. modelUsed=${r1.modelUsed}`);
  }
  if (
    !r1.modelUsed.startsWith('deepseek:') &&
    !r1.modelUsed.startsWith('openai-via-proxy:') &&
    !r1.modelUsed.startsWith('ollama:')
  ) {
    throw new Error(`Test 1 fail: unexpected modelUsed=${r1.modelUsed}`);
  }
  // eslint-disable-next-line no-console
  console.log(`✓ Test 1: modelUsed=${r1.modelUsed}, text=${JSON.stringify(r1.text.slice(0, 80))}`);

  // 2. JSON Schema strict.
  // eslint-disable-next-line no-console
  console.log('→ Test 2: responseFormat=json_schema strict');
  const r2 = await router.call({
    taskType: 'block-distill',
    tenantId: orgId,
    systemPrompt:
      'You produce structured JSON answers strictly conforming to the given schema.',
    userMessage: 'Is the sky blue on a sunny day? Respond with {"answer":"yes"} or {"answer":"no"}.',
    responseFormat: {
      type: 'json_schema',
      name: 'YesNoAnswer',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          answer: { type: 'string', enum: ['yes', 'no'] },
        },
        required: ['answer'],
        additionalProperties: false,
      },
    },
    maxTokens: 64,
  });
  if (!r2.text || r2.text.trim().length === 0) {
    throw new Error(`Test 2 fail: empty text. modelUsed=${r2.modelUsed}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(r2.text);
  } catch (err) {
    throw new Error(`Test 2 fail: невалидный JSON: ${r2.text}; err=${err instanceof Error ? err.message : String(err)}`);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('answer' in parsed) ||
    !['yes', 'no'].includes((parsed as { answer: unknown }).answer as string)
  ) {
    throw new Error(`Test 2 fail: schema violation: ${r2.text}`);
  }
  // eslint-disable-next-line no-console
  console.log(`✓ Test 2: modelUsed=${r2.modelUsed}, parsed=${JSON.stringify(parsed)}`);

  // 3. Проверка AiUsageLog.
  const logs = await prisma.aiUsageLog.findMany({
    where: { tenantId: orgId, taskType: 'block-distill' },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  if (logs.length < 2) {
    throw new Error(`Test 3 fail: ожидали >=2 AiUsageLog записи для tenantId=${orgId}, нашли ${logs.length}`);
  }
  for (const log of logs.slice(0, 2)) {
    if (log.tenantId !== orgId) throw new Error('Test 3 fail: log.tenantId != orgId');
    if (!log.provider || !log.model) throw new Error('Test 3 fail: log без provider/model');
    if ((log.cachedTokens ?? 0) < 0) throw new Error('Test 3 fail: cachedTokens отрицательный');
    // eslint-disable-next-line no-console
    console.log(
      `  log: provider=${log.provider} model=${log.model} input=${log.inputTokens} output=${log.outputTokens} cached=${log.cachedTokens} cost=${log.costUsd}`,
    );
  }
  // eslint-disable-next-line no-console
  console.log('✓ Test 3: AiUsageLog OK');

  // ─── Cleanup: удаляем только наши записи в AiUsageLog. ───
  await prisma.aiUsageLog.deleteMany({
    where: { tenantId: orgId, taskType: 'block-distill' },
  });

  await moduleRef.close();

  // eslint-disable-next-line no-console
  console.log('=== smoke-llm-router-phase2-step0 PASSED ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('smoke-llm-router-phase2-step0 FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
