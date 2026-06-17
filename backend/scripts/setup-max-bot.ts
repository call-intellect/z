import { createCipheriv, randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';
import * as dotenv from 'dotenv';

interface CliArgs {
  token: string;
  tenantId: string;
  publicHostUrl: string;
  webhookSecret: string;
}

const MAX_API_BASE = process.env['MAX_BOT_API_BASE'] ?? 'https://platform-api.max.ru';

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val !== undefined && !val.startsWith('--')) {
        out[key] = val;
        i++;
      } else {
        out[key] = 'true';
      }
    }
  }
  const token = out['token'];
  const tenantId = out['tenant-id'];
  const publicHostUrl = out['public-host-url'] ?? process.env['PUBLIC_HOST_URL'];
  if (!token || !tenantId || !publicHostUrl) {
    console.error(
      'usage: bun run setup:max-bot -- --token <accessToken> --tenant-id <tenantId> --public-host-url <url> [--webhook-secret <secret>]',
    );
    process.exit(1);
  }
  const webhookSecret = out['webhook-secret'] ?? randomBytes(16).toString('hex');
  return {
    token,
    tenantId,
    publicHostUrl: publicHostUrl.replace(/\/+$/, ''),
    webhookSecret,
  };
}

function encryptForCryptoService(plaintext: string): string {
  const raw = process.env['CRYPTO_MASTER_KEY'];
  if (!raw) {
    throw new Error('CRYPTO_MASTER_KEY не задан в .env');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`CRYPTO_MASTER_KEY должен быть 32 байта (base64), получено ${key.length}`);
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `gcm:v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('base64')}`;
}

async function callMax(
  accessToken: string,
  httpMethod: 'GET' | 'POST' | 'DELETE',
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; description?: string; result?: unknown }> {
  const url = `${MAX_API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  const init: RequestInit = {
    method: httpMethod,
    headers: {
      'Content-Type': 'application/json',
      Authorization: accessToken,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  const res = await fetch(url, init);
  let json: unknown = null;
  try {
    const text = await res.text();
    json = text ? safeJsonParse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      description: extractDescription(json) ?? `HTTP ${res.status}`,
    };
  }
  return { ok: true, status: res.status, result: json ?? undefined };
}

async function main(): Promise<void> {
  dotenv.config();
  const args = parseArgs();
  const webhookUrl = `${args.publicHostUrl}/api/v1/webhooks/max-bot/${args.tenantId}/${args.webhookSecret}`;

  console.log(`[setup-max-bot] tenantId=${args.tenantId}`);
  console.log(`[setup-max-bot] webhookUrl=${webhookUrl}`);

  const me = await callMax(args.token, 'GET', '/me', undefined);
  if (!me.ok) {
    console.error(`[setup-max-bot] /me failed: ${me.description ?? 'unknown'}`);
    process.exit(1);
  }
  const result = me.result as { name?: string; username?: string } | undefined;
  const botName = result?.name ?? result?.username ?? null;
  console.log(`[setup-max-bot] /me ok, botName=${botName ?? '<unknown>'}`);

  const sub = await callMax(args.token, 'POST', '/subscriptions', {
    url: webhookUrl,
  });
  if (!sub.ok) {
    console.error(`[setup-max-bot] POST /subscriptions failed: ${sub.description ?? 'unknown'}`);
    process.exit(1);
  }
  console.log('[setup-max-bot] /subscriptions ok');

  const prisma = createPrismaClient();
  try {
    const config = {
      accessToken: encryptForCryptoService(args.token),
      webhookSecret: encryptForCryptoService(args.webhookSecret),
      botName: botName ?? null,
    };
    const channel = await prisma.channel.upsert({
      where: {
        tenantId_kind: {
          tenantId: args.tenantId,
          kind: 'max_bot',
        },
      },
      update: {
        config,
        status: 'active',
        direction: 'bidirectional',
        maxDataClass: 'internal',
        brokenReason: null,
      },
      create: {
        tenantId: args.tenantId,
        kind: 'max_bot',
        direction: 'bidirectional',
        maxDataClass: 'internal',
        status: 'active',
        config,
      },
    });
    console.log(`[setup-max-bot] Channel upserted id=${channel.id} tenantId=${args.tenantId}`);
    console.log('[setup-max-bot] DONE.');
  } finally {
    await prisma.$disconnect();
  }
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function extractDescription(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj['message'] === 'string') return obj['message'];
  if (typeof obj['description'] === 'string') return obj['description'];
  if (typeof obj['error'] === 'string') return obj['error'];
  return null;
}

main().catch((err) => {
  console.error('[setup-max-bot] FATAL:', err);
  process.exit(1);
});
