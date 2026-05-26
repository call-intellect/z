/**
 * 2026-05-26 — Регистрация (или обновление) глобального Telegram-бота
 * в прокси `telegram.crossmark.ru`.
 *
 * См. ТЗ plans/tz/2026-05-26-telegram-via-crossmark-proxy.md §6.
 *
 * Что делает:
 *   1. Находит глобальный канал `Channel WHERE tenantId IS NULL AND
 *      kind='telegram_bot'`. Если нет — печатает инструкцию и выходит с
 *      кодом 0 (это норма для свежего бутстрапа; админ настроит токен
 *      через `/admin/system/telegram-bot`, потом запустит скрипт снова).
 *   2. Расшифровывает `config.botToken` и `config.webhookSecret` через
 *      `CryptoService`.
 *   3. Если `webhookSecret` пуст — генерирует новый.
 *   4. Логинится в прокси, делает `upsertBot({ token, secretToken,
 *      targetUrl })`. Прокси сам зарегистрирует `setWebhook` у Telegram.
 *   5. Сохраняет `proxyBotId`, `proxyRegisteredAt`, `proxyLastSyncError=null`,
 *      `webhookSecret` (encrypted) обратно в `Channel.config`.
 *
 * Идемпотентен: повторный запуск либо ничего не меняет (если бот уже
 * зарегистрирован с теми же параметрами), либо обновляет registration
 * через `PUT /api/bots/:id`.
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/patch-telegram-register-in-proxy.ts
 *
 * Доп. флаги:
 *   --dry-run      — показать что будет сделано, не дёргать прокси и не писать в БД.
 *   --rotate-secret — сгенерировать новый webhookSecret, даже если в БД уже есть.
 *   --webhook-url=<url> — переопределить URL (default = computeWebhookUrl()).
 */

import { randomBytes } from 'node:crypto';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { TypedConfigService } from '../src/common/config/index';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TelegramProxyAdminClient } from '../src/modules/conversational/adapters/telegram-bot/telegram-proxy-admin.client';

interface CliArgs {
  dryRun: boolean;
  rotateSecret: boolean;
  webhookUrlOverride: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  let dryRun = false;
  let rotateSecret = false;
  let webhookUrlOverride: string | null = null;
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true;
    else if (a === '--rotate-secret') rotateSecret = true;
    else if (a.startsWith('--webhook-url=')) {
      webhookUrlOverride = a.slice('--webhook-url='.length).trim();
    } else if (a === '--help' || a === '-h') {
      log(
        'Usage: bun run scripts/patch-telegram-register-in-proxy.ts [--dry-run] [--rotate-secret] [--webhook-url=https://...]',
      );
      process.exit(0);
    }
  }
  return { dryRun, rotateSecret, webhookUrlOverride };
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

function generateWebhookSecret(): string {
  return randomBytes(16).toString('hex');
}

async function main(args: CliArgs): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const crypto = app.get(CryptoService);
    const cfg = app.get(TypedConfigService);
    const proxyAdmin = app.get(TelegramProxyAdminClient);

    log(`=== patch-telegram-register-in-proxy START (dryRun=${args.dryRun}) ===`);

    if (!cfg.telegramProxy.enabled) {
      log('TELEGRAM_PROXY_ENABLED=false — прокси выключен. Скрипт ничего не делает.');
      return;
    }
    if (!cfg.telegramProxy.adminEmail || !cfg.telegramProxy.adminPassword) {
      throw new Error(
        'TELEGRAM_PROXY_ADMIN_EMAIL / TELEGRAM_PROXY_ADMIN_PASSWORD не заданы в env. ' +
          'Без них скрипт не может залогиниться в прокси.',
      );
    }

    const channel = await prisma.channel.findFirst({
      where: { tenantId: null, kind: 'telegram_bot' },
    });
    if (!channel) {
      log(
        'Глобальный Telegram-канал не найден. Это норма для свежего бутстрапа.\n' +
          'Действия:\n' +
          '  1. Залогинься в админку Z как super-admin.\n' +
          '  2. Открой /admin/system/telegram-bot.\n' +
          '  3. Установи токен бота — канал создастся автоматически.\n' +
          '  4. Запусти этот скрипт снова — он зарегистрирует бота в прокси.',
      );
      return;
    }

    const cfgRaw = (channel.config as Record<string, unknown> | null) ?? {};
    const tokenEnc = String(cfgRaw['botToken'] ?? '');
    if (!tokenEnc) {
      throw new Error(
        'Channel.config.botToken пустой. Установи токен в /admin/system/telegram-bot.',
      );
    }
    const token = crypto.isEncrypted(tokenEnc) ? crypto.decrypt(tokenEnc) : tokenEnc;
    if (!token) {
      throw new Error('Не удалось расшифровать токен.');
    }

    const existingSecretEnc = String(cfgRaw['webhookSecret'] ?? '');
    let secret: string;
    let secretGenerated = false;
    if (existingSecretEnc && !args.rotateSecret) {
      try {
        secret = crypto.isEncrypted(existingSecretEnc)
          ? crypto.decrypt(existingSecretEnc)
          : existingSecretEnc;
      } catch (err) {
        log(
          `WARN: не удалось расшифровать существующий webhookSecret (${err instanceof Error ? err.message : err}); генерирую новый.`,
        );
        secret = generateWebhookSecret();
        secretGenerated = true;
      }
    } else {
      secret = generateWebhookSecret();
      secretGenerated = true;
    }
    if (!secret) {
      secret = generateWebhookSecret();
      secretGenerated = true;
    }

    const publicHostUrl = cfg.publicHostUrl.replace(/\/+$/, '');
    const targetUrl =
      args.webhookUrlOverride ?? `${publicHostUrl}/api/v1/webhooks/telegram-bot`;
    if (!/^https:\/\//i.test(targetUrl)) {
      throw new Error(`targetUrl должен быть https://... — получено: ${targetUrl}`);
    }

    log(
      `Канал: id=${channel.id}, токен=****${token.slice(-4)}, secret_rotated=${secretGenerated}, target_url=${targetUrl}`,
    );
    log(`Прокси: ${cfg.telegramProxy.apiBase}`);

    if (args.dryRun) {
      log('--dry-run — пропускаем upsertBot и запись в БД.');
      return;
    }

    let proxyBotId: string;
    let proxyLastSyncError: string | null = null;
    try {
      const info = await proxyAdmin.upsertBot({
        token,
        secretToken: secret,
        targetUrl,
      });
      proxyBotId = info.id;
    } catch (err) {
      proxyLastSyncError = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Прокси отверг upsertBot: ${proxyLastSyncError}. Проверь TELEGRAM_PROXY_ADMIN_* и доступность ${cfg.telegramProxy.apiBase}.`,
      );
    }

    const newSecretEnc = secretGenerated ? crypto.encrypt(secret) : existingSecretEnc;
    const newConfig: Record<string, unknown> = {
      ...cfgRaw,
      proxyBotId,
      proxyRegisteredAt: new Date().toISOString(),
      proxyLastSyncError,
      webhookUrl: targetUrl,
      webhookSecret: newSecretEnc,
    };
    await prisma.channel.update({
      where: { id: channel.id },
      data: { config: newConfig as never },
    });

    log(`✓ Бот зарегистрирован в прокси. proxyBotId=${proxyBotId}`);
  } finally {
    await app.close();
  }
}

main(parseArgs(process.argv.slice(2))).catch((err) => {
  // eslint-disable-next-line no-console
  console.error('patch-telegram-register-in-proxy FAILED:', err);
  process.exit(1);
});
