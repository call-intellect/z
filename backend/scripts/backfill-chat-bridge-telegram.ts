import { readFile } from 'node:fs/promises';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { TelegramExportImportService } from '../src/modules/message-bridge/telegram-export.service';

interface ScriptArgs {
  tenantId: string;
  file: string;
}

function parseArgs(argv: string[]): ScriptArgs {
  const get = (name: string): string | undefined => {
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.split('=').slice(1).join('=');
    const idx = argv.indexOf(`--${name}`);
    if (idx >= 0 && argv[idx + 1] && !argv[idx + 1]!.startsWith('--')) return argv[idx + 1];
    return undefined;
  };
  const tenantId = get('tenant');
  const file = get('file');
  if (!tenantId) throw new Error('backfill-chat-bridge-telegram: укажите --tenant=<orgId>');
  if (!file) throw new Error('backfill-chat-bridge-telegram: укажите --file=<путь к result.json>');
  return { tenantId, file };
}

async function main(): Promise<void> {
  const { tenantId, file } = parseArgs(process.argv.slice(2));
  console.log(`=== backfill-chat-bridge-telegram START tenant=${tenantId} file=${file} ===`);

  const raw = await readFile(file, 'utf8');
  const exportJson: unknown = JSON.parse(raw);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const importer = app.get(TelegramExportImportService);
    const result = await importer.importTelegramExport(tenantId, exportJson);
    console.log(
      `=== backfill-chat-bridge-telegram DONE: imported=${result.imported}, skipped=${result.skipped} ===`,
    );
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-chat-bridge-telegram FAILED:', err);
    process.exit(1);
  });
