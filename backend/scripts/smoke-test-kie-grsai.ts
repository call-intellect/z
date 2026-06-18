import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

import { KieService } from '../src/modules/ai/services/kie.service';
import { GrsaiService } from '../src/modules/ai/services/grsai.service';
import { calcCostUsd, MODEL_PRICES } from '../src/modules/ai/services/model-prices';
import type { LlmCompleteInput } from '../src/modules/ai/services/llm.types';
import type { TypedConfigService } from '../src/common/config/index';

loadEnv({ path: resolve(__dirname, '..', '..', '.env'), override: true });
loadEnv({ path: resolve(__dirname, '..', '.env'), override: false });

const SYSTEM_PROMPT = 'Ты лаконичный ассистент. Отвечай строго одним словом без знаков препинания.';
const USER_PROMPT = 'Скажи только одно слово: тест';

function buildCfg(): TypedConfigService {
  return {
    ai: {
      kie: {
        apiKey: process.env.KIE_API_KEY ?? '',
        baseUrl: process.env.KIE_BASE_URL ?? 'https://api.kie.ai',
      },
      grsai: {
        apiKey: process.env.GRSAI_API_KEY ?? '',
        baseUrl: process.env.GRSAI_BASE_URL ?? 'https://grsaiapi.com',
      },
      proxy: {
        baseUrl: process.env.PROXY_BASE_URL ?? 'https://proxy.agent-lia.ru/v1',
        prefix: process.env.PROXY_PREFIX ?? 'myFeedproxy3128',
      },
    },
  } as unknown as TypedConfigService;
}

interface SmokeRow {
  provider: 'kie' | 'grsai';
  model: string;
  status: 'ok' | 'fail' | 'skip';
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  reply?: string;
  error?: string;
  reason?: string;
}

function logRow(r: SmokeRow): void {
  const head = `[${r.status.toUpperCase()}] ${r.provider}/${r.model}`;
  if (r.status === 'skip') {
    // eslint-disable-next-line no-console
    console.log(`${head} — ${r.reason ?? ''}`);
    return;
  }
  if (r.status === 'fail') {
    // eslint-disable-next-line no-console
    console.log(`${head} — error: ${r.error}`);
    return;
  }
  const replyShort = (r.reply ?? '').slice(0, 60).replace(/\s+/g, ' ');
  // eslint-disable-next-line no-console
  console.log(
    `${head} — ${r.latencyMs}ms · in=${r.inputTokens} out=${r.outputTokens} · cost=$${(r.costUsd ?? 0).toFixed(6)} · reply="${replyShort}"`,
  );
}

async function runOne(
  provider: 'kie' | 'grsai',
  model: string,
  call: (input: LlmCompleteInput) => Promise<{
    text: string;
    inputTokens: number;
    outputTokens: number;
  }>,
): Promise<SmokeRow> {
  const t0 = Date.now();
  try {
    const out = await call({
      system: { text: SYSTEM_PROMPT },
      user: USER_PROMPT,
      model,
      maxTokens: 64,
    });
    const latencyMs = Date.now() - t0;
    const costUsd = calcCostUsd(model, out.inputTokens, out.outputTokens, 0);
    const row: SmokeRow = {
      provider,
      model,
      status: 'ok',
      latencyMs,
      inputTokens: out.inputTokens,
      outputTokens: out.outputTokens,
      costUsd,
      reply: out.text,
    };
    if (MODEL_PRICES[model]?.inputPer1M === 0 && MODEL_PRICES[model]?.outputPer1M === 0) {
      row.reply = `${out.text}  [⚠ price=0/0 — TODO заполнить в model-prices.ts]`;
    }
    return row;
  } catch (err) {
    return {
      provider,
      model,
      status: 'fail',
      latencyMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== smoke-test-kie-grsai START ===');

  const cfg = buildCfg();
  const rows: SmokeRow[] = [];

  if (!process.env.KIE_API_KEY) {
    rows.push({
      provider: 'kie',
      model: 'gemini-3-flash',
      status: 'skip',
      reason: 'set KIE_API_KEY env to run',
    });
  } else {
    const kie = new KieService(cfg);
    rows.push(await runOne('kie', 'gemini-3-flash', (input) => kie.complete(input)));
  }

  if (!process.env.KIE_API_KEY) {
    rows.push({
      provider: 'kie',
      model: 'gpt-5-4',
      status: 'skip',
      reason: 'set KIE_API_KEY env to run',
    });
  } else {
    const kie = new KieService(cfg);
    rows.push(await runOne('kie', 'gpt-5-4', (input) => kie.complete(input)));
  }

  if (!process.env.GRSAI_API_KEY) {
    rows.push({
      provider: 'grsai',
      model: 'gemini-3-pro',
      status: 'skip',
      reason: 'set GRSAI_API_KEY env to run',
    });
  } else {
    const grsai = new GrsaiService(cfg);
    rows.push(await runOne('grsai', 'gemini-3-pro', (input) => grsai.complete(input)));
  }

  // eslint-disable-next-line no-console
  console.log('\n── Результаты ───────────────────────────────────────────────');
  for (const r of rows) logRow(r);
  // eslint-disable-next-line no-console
  console.log('=== smoke-test-kie-grsai DONE ===');

  const failed = rows.some((r) => r.status === 'fail');
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('smoke-test-kie-grsai FAILED:', err);
  process.exit(1);
});
