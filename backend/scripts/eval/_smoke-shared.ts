import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

export const MODEL = 'deepseek-v4-pro';
export const PRICE_IN = 0.435 / 1_000_000;
export const PRICE_CACHED_IN = 0.003625 / 1_000_000;
export const PRICE_OUT = 0.87 / 1_000_000;

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('✗ DEEPSEEK_API_KEY не задан');
  process.exit(1);
}

export const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  cached_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

export interface SmokeReport {
  taskType: string;
  promptFound: boolean;
  ranSuccessfully: boolean;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number;
  ms: number;
  modelResponse: string;
  error: string | null;
}

export function computeCost(u: Usage): {
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number;
} {
  const tokensIn = u.prompt_tokens ?? 0;
  const tokensOut = u.completion_tokens ?? 0;
  const cachedTokens =
    u.prompt_cache_hit_tokens ?? u.cached_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
  const uncached = Math.max(0, tokensIn - cachedTokens);
  const costUsd = uncached * PRICE_IN + cachedTokens * PRICE_CACHED_IN + tokensOut * PRICE_OUT;
  return { tokensIn, tokensOut, cachedTokens, costUsd };
}

export async function writeReport(taskType: string, report: SmokeReport): Promise<void> {
  const reportPath = path.resolve(`test/eval/smoke-all-agents/reports/${taskType}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n✓ отчёт: ${reportPath}`);
}

export async function readFixture<T>(taskType: string): Promise<T> {
  const fixturePath = path.resolve(`test/eval/smoke-all-agents/fixtures/${taskType}.json`);
  return JSON.parse(await fs.readFile(fixturePath, 'utf-8')) as T;
}

export function shortResponse(text: string): string {
  return (text ?? '').slice(0, 300);
}

export function logRun(taskType: string, report: SmokeReport): void {
  const flag = report.ranSuccessfully ? '✓' : '✗';
  console.log(
    `${flag} ${taskType}: ${report.ms}мс | вход=${report.tokensIn} (кэш=${report.cachedTokens}) выход=${report.tokensOut} | $${report.costUsd.toFixed(4)}${report.error ? ` | ${report.error}` : ''}`,
  );
}
