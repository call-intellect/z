/**
 * Создаёт IntegrationKey (HMAC-ключ для партнёра — Crossmark и т.п.).
 *
 * Usage:
 *   bun run scripts/create-integration-key.ts <partner_name>
 *
 * Эффект:
 *   - Сгенерировать сырой ключ (32 байта энтропии = 64 hex-символа).
 *   - Записать в БД только sha256-хеш (`IntegrationKey.keyHash`).
 *   - Вывести сырой ключ в STDOUT — это ЕДИНСТВЕННЫЙ момент,
 *     когда он показывается. Сохранить его в безопасном хранилище.
 *
 * Используется:
 *   - при онбординге партнёра (Crossmark);
 *   - в smoke-test'е (`infra/smoke/smoke-test.sh`).
 */

import { createHash, randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

function generateKey(): string {
  return randomBytes(32).toString('hex');
}

function hashKey(plain: string): string {
  return createHash('sha256').update(plain, 'utf8').digest('hex');
}

async function main(): Promise<void> {
  const [, , rawPartnerName] = process.argv;
  if (!rawPartnerName || !rawPartnerName.trim()) {
    // eslint-disable-next-line no-console
    console.error('usage: bun run scripts/create-integration-key.ts <partner_name>');
    process.exit(1);
    return;
  }

  const partnerName = rawPartnerName.trim();
  if (partnerName.length > 100) {
    // eslint-disable-next-line no-console
    console.error('partner_name не может быть длиннее 100 символов.');
    process.exit(1);
    return;
  }

  const prisma = createPrismaClient();
  try {
    const plainKey = generateKey();
    const keyHash = hashKey(plainKey);
    const created = await prisma.integrationKey.create({
      data: { partnerName, keyHash },
      select: { id: true },
    });

    // eslint-disable-next-line no-console
    console.error(
      `[create-integration-key] OK. id=${created.id}, partner_name=${partnerName}.`,
    );
    // Сырой ключ — ОДИН раз в stdout (для пайпинга в env, файл или пользователю).
    process.stdout.write(`${plainKey}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[create-integration-key] FATAL:', err);
  process.exit(1);
});
