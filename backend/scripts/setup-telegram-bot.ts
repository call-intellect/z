/**
 * SBA β-1 — Setup script для Telegram Bot канала.
 *
 * Что делает:
 *   1. setWebhook у Telegram (URL = <PUBLIC_HOST_URL>/api/v1/webhooks/telegram-bot/<tenantId>,
 *      secret_token = `--webhook-secret` или случайный).
 *   2. setMyCommands — выставляет список slash-команд (русские описания).
 *   3. getMe — для проверки токена и подтягивания username.
 *   4. Upsert Channel(tenantId, kind='telegram_bot', config={encrypted token,
 *      encrypted secret, botUsername}, status='active', maxDataClass='internal',
 *      direction='bidirectional').
 *
 * Все секреты шифруются совместимым с CryptoService форматом (`gcm:v1:...`)
 * — переиспользует `CRYPTO_MASTER_KEY` из .env.
 *
 * Usage:
 *   bun run setup:telegram-bot -- \
 *       --token <BOT_TOKEN> \
 *       --tenant-id <tenantId> \
 *       --public-host-url https://api.kora.ai \
 *       [--webhook-secret <SECRET>]   # опционально, по умолчанию — random 32 hex bytes
 *
 * Idempotent: повторный запуск с тем же tenantId перезатирает Channel.config
 * и Telegram-webhook (нормально — токен мог обновиться).
 */

import { createCipheriv, randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

interface CliArgs {
  token: string;
  tenantId: string;
  publicHostUrl: string;
  webhookSecret: string;
}

const TELEGRAM_API_BASE =
  process.env['TELEGRAM_BOT_API_BASE'] ?? 'https://api.telegram.org';

const COMMANDS = [
  { command: 'ask', description: 'Задать вопрос помощнику по знаниям' },
  { command: 'note', description: 'Записать свободную заметку' },
  { command: 'idea', description: 'Сохранить идею' },
  { command: 'status', description: 'Статус задач и вопросов' },
  { command: 'myideas', description: 'Мои идеи' },
  { command: 'link', description: 'Привязать аккаунт (/link <код>)' },
  { command: 'help', description: 'Помощь и список команд' },
];

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
      'usage: bun run setup:telegram-bot -- --token <token> --tenant-id <tenantId> --public-host-url <url> [--webhook-secret <secret>]',
    );
    process.exit(1);
  }
  const webhookSecret =
    out['webhook-secret'] ?? randomBytes(16).toString('hex');
  return {
    token,
    tenantId,
    publicHostUrl: publicHostUrl.replace(/\/+$/, ''),
    webhookSecret,
  };
}

/**
 * Шифрование совместимое с `CryptoService.encrypt`. Формат:
 * `gcm:v1:<iv-hex>:<tag-hex>:<ciphertext-base64>`. См.
 * `backend/src/common/crypto/crypto.service.ts`.
 */
function encryptForCryptoService(plaintext: string): string {
  const raw = process.env['CRYPTO_MASTER_KEY'];
  if (!raw) {
    throw new Error('CRYPTO_MASTER_KEY не задан в .env');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `CRYPTO_MASTER_KEY должен быть 32 байта (base64), получено ${key.length}`,
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `gcm:v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('base64')}`;
}

async function callTelegram(
  token: string,
  method: string,
  body: unknown,
): Promise<{ ok: boolean; description?: string; result?: unknown }> {
  const url = `${TELEGRAM_API_BASE}/bot${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await res.json()) as {
    ok: boolean;
    description?: string;
    result?: unknown;
  };
}

async function main(): Promise<void> {
  dotenv.config();
  const args = parseArgs();
  const webhookUrl = `${args.publicHostUrl}/api/v1/webhooks/telegram-bot/${args.tenantId}`;

  console.log(`[setup-telegram-bot] tenantId=${args.tenantId}`);
  console.log(`[setup-telegram-bot] webhookUrl=${webhookUrl}`);

  // 1. getMe — проверка токена и подтягивание username.
  const me = await callTelegram(args.token, 'getMe', undefined);
  if (!me.ok) {
    console.error(`[setup-telegram-bot] getMe failed: ${me.description ?? 'unknown'}`);
    process.exit(1);
  }
  const botUsername = (me.result as { username?: string })?.username;
  console.log(`[setup-telegram-bot] getMe ok, username=@${botUsername ?? '<unknown>'}`);

  // 2. setWebhook.
  const setWebhook = await callTelegram(args.token, 'setWebhook', {
    url: webhookUrl,
    secret_token: args.webhookSecret,
    allowed_updates: ['message', 'callback_query', 'edited_message'],
    drop_pending_updates: false,
  });
  if (!setWebhook.ok) {
    console.error(
      `[setup-telegram-bot] setWebhook failed: ${setWebhook.description ?? 'unknown'}`,
    );
    process.exit(1);
  }
  console.log('[setup-telegram-bot] setWebhook ok');

  // 3. setMyCommands.
  const setCmd = await callTelegram(args.token, 'setMyCommands', {
    commands: COMMANDS,
  });
  if (!setCmd.ok) {
    console.error(
      `[setup-telegram-bot] setMyCommands failed: ${setCmd.description ?? 'unknown'}`,
    );
    process.exit(1);
  }
  console.log('[setup-telegram-bot] setMyCommands ok');

  // 4. Upsert Channel.
  const prisma = new PrismaClient();
  try {
    const config = {
      botToken: encryptForCryptoService(args.token),
      webhookSecret: encryptForCryptoService(args.webhookSecret),
      botUsername: botUsername ?? null,
    };
    const channel = await prisma.channel.upsert({
      where: {
        tenantId_kind: {
          tenantId: args.tenantId,
          kind: 'telegram_bot',
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
        kind: 'telegram_bot',
        direction: 'bidirectional',
        maxDataClass: 'internal',
        status: 'active',
        config,
      },
    });
    console.log(
      `[setup-telegram-bot] Channel upserted id=${channel.id} tenantId=${args.tenantId}`,
    );
    console.log('[setup-telegram-bot] DONE.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[setup-telegram-bot] FATAL:', err);
  process.exit(1);
});
