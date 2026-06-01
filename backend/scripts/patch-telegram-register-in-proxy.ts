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

import { createPrismaClient } from './_lib/prisma';

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
  // Pre-check ДО подъёма AppModule: если прокси явно выключен / нет admin-кредов
  // / нет глобального telegram-канала — делать нечего, выходим без Nest. Иначе
  // app.close() рвёт ioredis/BullMQ и засыпает лог флудом «Connection is closed»
  // на каждом выкате. Сам proxy.enabled-флаг (с дефолтом) проверяется уже внутри.
  const proxyExplicitlyDisabled = ['false', '0'].includes(
    (process.env['TELEGRAM_PROXY_ENABLED'] ?? '').toLowerCase(),
  );
  const hasCreds =
    !!process.env['TELEGRAM_PROXY_ADMIN_EMAIL'] &&
    !!process.env['TELEGRAM_PROXY_ADMIN_PASSWORD'];
  if (proxyExplicitlyDisabled || !hasCreds) {
    log(
      'TELEGRAM_PROXY выключен или admin-креды не заданы — регистрация бота пропущена (Nest не поднимаем). ' +
        'Задай TELEGRAM_PROXY_* в .env и запусти скрипт снова.',
    );
    return;
  }
  const preCheck = createPrismaClient();
  try {
    const ch = await preCheck.channel.findFirst({
      where: { tenantId: null, kind: 'telegram_bot' },
    });
    if (!ch) {
      log(
        'Глобальный telegram-канал не найден — пропуск (настрой токен в /admin/system/telegram-bot и запусти снова).',
      );
      return;
    }
  } finally {
    await preCheck.$disconnect();
  }

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
      log(
        'TELEGRAM_PROXY_ADMIN_EMAIL / TELEGRAM_PROXY_ADMIN_PASSWORD не заданы в env — ' +
          'регистрация бота в прокси пропущена (конфигурация ещё не готова). ' +
          'Задай креды прокси в .env и запусти скрипт снова. Обновление не требуется сейчас.',
      );
      return;
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
      log(
        'Channel.config.botToken пустой — токен бота ещё не установлен. ' +
          'Установи токен в /admin/system/telegram-bot и запусти скрипт снова. ' +
          'Регистрация пропущена, обновление не требуется сейчас.',
      );
      return;
    }
    const token = crypto.isEncrypted(tokenEnc) ? crypto.decrypt(tokenEnc) : tokenEnc;
    if (!token) {
      log(
        'Не удалось расшифровать Channel.config.botToken (возможно сменился CRYPTO_MASTER_KEY). ' +
          'Переустанови токен в /admin/system/telegram-bot. Регистрация пропущена.',
      );
      return;
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
      log(
        `targetUrl должен быть https://... — получено: ${targetUrl}. ` +
          'Проверь PUBLIC_HOST_URL в .env или передай --webhook-url=https://... . Регистрация пропущена.',
      );
      return;
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
    try {
      const info = await proxyAdmin.upsertBot({
        token,
        secretToken: secret,
        targetUrl,
      });
      proxyBotId = info.id;
    } catch (err) {
      // Прокси — нестабильная внешняя зависимость (сеть / протухший JWT).
      // Не валим весь `apply-prod-deploy` из-за неё: фиксируем причину в
      // Channel.config.proxyLastSyncError для observability и выходим чисто.
      // Оператор перезапустит скрипт после восстановления прокси.
      const proxyLastSyncError = err instanceof Error ? err.message : String(err);
      log(
        `WARN: прокси отверг upsertBot: ${proxyLastSyncError}. ` +
          `Проверь TELEGRAM_PROXY_ADMIN_* и доступность ${cfg.telegramProxy.apiBase}, затем запусти скрипт снова. ` +
          'Регистрация бота отложена — остальной выкат не блокируется.',
      );
      await prisma.channel.update({
        where: { id: channel.id },
        data: {
          config: { ...cfgRaw, proxyLastSyncError } as never,
        },
      });
      return;
    }

    const newSecretEnc = secretGenerated ? crypto.encrypt(secret) : existingSecretEnc;
    const newConfig: Record<string, unknown> = {
      ...cfgRaw,
      proxyBotId,
      proxyRegisteredAt: new Date().toISOString(),
      proxyLastSyncError: null,
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
