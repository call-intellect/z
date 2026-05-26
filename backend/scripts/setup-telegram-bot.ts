/**
 * β-9 (2026-05-25) — Setup script для ГЛОБАЛЬНОГО Telegram Bot канала.
 *
 * До β-9: per-tenant модель (`--tenant-id <X>`), один бот на каждую Org.
 * С β-9: один глобальный бот `@kora_bot` на всю платформу. Главный
 * администратор Z вызывает этот скрипт ОДИН РАЗ (при первичной настройке
 * или после ротации токена), после чего весь трафик идёт через
 * `Channel WHERE tenantId IS NULL AND kind='telegram_bot'`.
 *
 * Что делает:
 *   1. getMe — проверяет токен, тянет username бота.
 *   2. setWebhook у Telegram (URL = `<PUBLIC_HOST_URL>/api/v1/webhooks/telegram-bot`
 *      БЕЗ `:tenantId`, secret_token = `--webhook-secret` или случайный).
 *      `allowed_updates=['message','edited_message']`.
 *   3. setMyCommands([]) — очищает menu-хамбургер бота (β-1 zero-button).
 *   4. Upsert ГЛОБАЛЬНОЙ записи `Channel` (`tenantId IS NULL`).
 *      Prisma не поддерживает composite-unique upsert по null, поэтому
 *      делаем «find OR create OR update».
 *
 * Все секреты шифруются совместимым с `CryptoService` форматом
 * (`gcm:v1:...`) через `CRYPTO_MASTER_KEY` из .env.
 *
 * Usage (из backend/):
 *   bun run setup:telegram-bot -- \
 *       --token <BOT_TOKEN> \
 *       --public-host-url https://api.kora.ai \
 *       [--webhook-secret <SECRET>]
 *
 * Идемпотентность: повторный запуск перезатирает токен/secret глобального
 * канала и переустанавливает webhook у Telegram (нормально — токен мог
 * обновиться, secret поменялся).
 */

import { createCipheriv, randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';
import * as dotenv from 'dotenv';

interface CliArgs {
  token: string;
  publicHostUrl: string;
  webhookSecret: string;
}

const TELEGRAM_API_BASE =
  process.env['TELEGRAM_BOT_API_BASE'] ?? 'https://api.telegram.org';

// β-1 zero-button (2026-05-23): slash-команды удалены. setMyCommands
// вызывается с пустым массивом, чтобы Telegram очистил menu-хамбургер.
const COMMANDS: Array<{ command: string; description: string }> = [];

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
  // β-9: --tenant-id больше не принимается. Если передали — предупредим
  // и проигнорируем (миграция глобальная).
  if (out['tenant-id']) {
    console.warn(
      '[setup-telegram-bot] WARN: флаг --tenant-id больше не используется (β-9: глобальный бот). Игнорирую.',
    );
  }
  const token = out['token'];
  const publicHostUrl = out['public-host-url'] ?? process.env['PUBLIC_HOST_URL'];
  if (!token || !publicHostUrl) {
    console.error(
      'usage: bun run setup:telegram-bot -- --token <token> --public-host-url <url> [--webhook-secret <secret>]',
    );
    process.exit(1);
  }
  const webhookSecret =
    out['webhook-secret'] ?? randomBytes(16).toString('hex');
  return {
    token,
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
  // β-9: webhook URL без `:tenantId`.
  const webhookUrl = `${args.publicHostUrl}/api/v1/webhooks/telegram-bot`;

  console.log('[setup-telegram-bot] mode=GLOBAL (β-9)');
  console.log(`[setup-telegram-bot] webhookUrl=${webhookUrl}`);

  // 1. getMe — проверка токена и подтягивание username.
  const me = await callTelegram(args.token, 'getMe', undefined);
  if (!me.ok) {
    console.error(`[setup-telegram-bot] getMe failed: ${me.description ?? 'unknown'}`);
    process.exit(1);
  }
  const botUsername = (me.result as { username?: string })?.username;
  console.log(`[setup-telegram-bot] getMe ok, username=@${botUsername ?? '<unknown>'}`);

  // 2. setWebhook. β-1 zero-button: без callback_query.
  const setWebhook = await callTelegram(args.token, 'setWebhook', {
    url: webhookUrl,
    secret_token: args.webhookSecret,
    allowed_updates: ['message', 'edited_message'],
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

  // 4. Upsert ГЛОБАЛЬНОГО Channel'а (tenantId IS NULL).
  //    Prisma upsert по composite-unique с null невозможен — делаем
  //    find-then-update / find-then-create вручную.
  const prisma = createPrismaClient();
  try {
    const config = {
      botToken: encryptForCryptoService(args.token),
      webhookSecret: encryptForCryptoService(args.webhookSecret),
      botUsername: botUsername ?? null,
    };
    const existing = await prisma.channel.findFirst({
      where: { tenantId: null, kind: 'telegram_bot' },
    });
    if (existing) {
      const updated = await prisma.channel.update({
        where: { id: existing.id },
        data: {
          config,
          status: 'active',
          direction: 'bidirectional',
          maxDataClass: 'internal',
          brokenReason: null,
        },
      });
      console.log(
        `[setup-telegram-bot] Global Channel updated id=${updated.id} (status=active)`,
      );
    } else {
      const created = await prisma.channel.create({
        data: {
          tenantId: null,
          kind: 'telegram_bot',
          direction: 'bidirectional',
          maxDataClass: 'internal',
          status: 'active',
          config,
        },
      });
      console.log(
        `[setup-telegram-bot] Global Channel created id=${created.id}`,
      );
    }
    console.log('[setup-telegram-bot] DONE.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[setup-telegram-bot] FATAL:', err);
  process.exit(1);
});
