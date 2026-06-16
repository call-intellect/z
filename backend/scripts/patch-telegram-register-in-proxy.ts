import { randomBytes } from 'node:crypto';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { TypedConfigService } from '../src/common/config/index';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TelegramProxyAdminClient } from '../src/modules/conversational/adapters/telegram-bot/telegram-proxy-admin.client';

import { createPrismaClient } from './_lib/prisma';
import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

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
  const proxyExplicitlyDisabled = ['false', '0'].includes(
    (process.env['TELEGRAM_PROXY_ENABLED'] ?? '').toLowerCase(),
  );
  const hasToken = !!process.env['TELEGRAM_PROXY_TOKEN'];
  if (proxyExplicitlyDisabled || !hasToken) {
    log(
      'TELEGRAM_PROXY выключен или TELEGRAM_PROXY_TOKEN не задан — регистрация бота пропущена (Nest не поднимаем). ' +
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
    if (!cfg.telegramProxy.token) {
      log(
        'TELEGRAM_PROXY_TOKEN не задан в env — ' +
          'регистрация бота в прокси пропущена (конфигурация ещё не готова). ' +
          'Задай токен прокси в .env и запусти скрипт снова. Обновление не требуется сейчас.',
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
    const webhookUrl = args.webhookUrlOverride ?? `${publicHostUrl}/api/v1/webhooks/telegram-bot`;
    if (!/^https:\/\//i.test(webhookUrl)) {
      log(
        `webhookUrl должен быть https://... — получено: ${webhookUrl}. ` +
          'Проверь PUBLIC_HOST_URL в .env или передай --webhook-url=https://... . Регистрация пропущена.',
      );
      return;
    }
    const targetUrl = `${webhookUrl}/s/${secret}`;
    const botName =
      typeof cfgRaw['botUsername'] === 'string' && cfgRaw['botUsername']
        ? (cfgRaw['botUsername'] as string)
        : 'Kora Bot';

    log(
      `Канал: id=${channel.id}, токен=****${token.slice(-4)}, secret_rotated=${secretGenerated}, webhook_url=${webhookUrl}`,
    );
    log(`Прокси: ${cfg.telegramProxy.apiBase}`);

    if (args.dryRun) {
      log('--dry-run — пропускаем upsertBot и запись в БД.');
      return;
    }

    let proxyBotId: string;
    try {
      const info = await proxyAdmin.upsertBot({
        name: botName,
        token,
        targetUrl,
      });
      proxyBotId = info.id;
    } catch (err) {
      const proxyLastSyncError = err instanceof Error ? err.message : String(err);
      log(
        `WARN: прокси отверг upsertBot: ${proxyLastSyncError}. ` +
          `Проверь TELEGRAM_PROXY_TOKEN и доступность ${cfg.telegramProxy.apiBase}, затем запусти скрипт снова. ` +
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
      webhookUrl,
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

silenceRedisShutdownNoise();
main(parseArgs(process.argv.slice(2))).catch((err) => {
  // eslint-disable-next-line no-console
  console.error('patch-telegram-register-in-proxy FAILED:', err);
  process.exit(1);
});
