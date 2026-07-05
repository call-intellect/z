import { resolve } from 'node:path';

import type { INestApplicationContext } from '@nestjs/common';

import { calcCostUsd } from '../../src/modules/ai/services/model-prices';

export type RegulationKind = 'regulation' | 'instruction' | 'policy' | 'process';

export interface OwnedRule {
  kind: RegulationKind;
  id: string;
  name: string;
  text: string;
  scope: string | null;
  ownerPersonId: string | null;
  ownerRoleId: string | null;
  forRole: string | null;
  ownedBy: string;
}

export interface RoleTarget {
  key: CloneKey;
  roleName: string;
  bearerName: string;
  roleId: string | null;
  personId: string | null;
  departmentId: string | null;
}

export type CloneKey = 'ceo' | 'integrator' | 'marketer' | 'support';

export const ROLE_BY_KEY: Record<CloneKey, string> = {
  ceo: 'Генеральный директор',
  integrator: 'Разработчик-интегратор',
  marketer: 'Маркетолог',
  support: 'Руководитель поддержки',
};

export const BEARER_BY_KEY: Record<CloneKey, string> = {
  ceo: 'Сергей',
  integrator: 'Михаил',
  marketer: 'Дарья',
  support: 'Игорь',
};

export const STAND_DIR = resolve(process.cwd(), 'scripts/clone-regulations-stand');
export const ARTIFACTS_DIR = resolve(STAND_DIR, 'artifacts');

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|::1|postgres|host\.docker\.internal)$/i;

export function assertNotProd(): void {
  if (process.env['ALLOW_PROD'] === '1') {
    process.stdout.write('⚠ ALLOW_PROD=1 — prod-guard отключён осознанно.\n');
    return;
  }
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('[clone-reg-stand] DATABASE_URL не задан.');
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error(`[clone-reg-stand] DATABASE_URL не парсится: ${url}`);
  }
  const isLocal =
    LOCAL_HOST.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    !host.includes('.');
  if (!isLocal) {
    throw new Error(
      `[clone-reg-stand] PROD-GUARD: '${host}' не похож на dev/local. Стенд пишет/читает синтетику. ` +
        `Если осознанно — ALLOW_PROD=1.`,
    );
  }
}

export function requireOrg(): string {
  const org = process.env['STRELA_ORG'];
  if (!org) throw new Error('STRELA_ORG не задан в .env');
  return org;
}

export function log(s: string): void {
  process.stdout.write(`${s}\n`);
}

export async function withApp<T>(fn: (app: INestApplicationContext) => Promise<T>): Promise<T> {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../../src/app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    return await fn(app);
  } finally {
    await Promise.race([app.close(), new Promise((r) => setTimeout(r, 6000))]);
  }
}

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  return calcCostUsd(model, inputTokens, outputTokens, 0);
}

export function fmtUsd(v: number): string {
  if (v === 0) return '$0';
  if (v < 0.0001) return `$${v.toExponential(2)}`;
  return `$${v.toFixed(6)}`;
}

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`;
}
