import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';

import { AppModule } from '../src/app.module';
import { ChatV2TableContextService } from '../src/modules/knowledge-core/services/chat-v2-table-context.service';

const ORG = 'cmr1qbvpx0001pwbwxbgmh1jl';
const BANK = '../docs/testing/strela-recall-questions.json';
const ANGLES = new Set(['risks', 'blockers', 'goals']);

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const tableContext = app.get(ChatV2TableContextService);
  const bank: Array<{ id: string; angle: string; question: string }> = JSON.parse(
    readFileSync(BANK, 'utf8'),
  );
  const qs = bank.filter((q) => ANGLES.has(q.angle));

  let reached = 0;
  for (const q of qs) {
    const rows = await tableContext.fetchTableContext({
      tenantId: ORG,
      queries: [q.question],
      entityIds: [],
      entityHints: [],
      aggregation: false,
      structuralIntent: true,
    });
    const tables = [...new Set(rows.map((r) => r.tableName))];
    if (rows.length > 0) reached++;
    console.log(`${q.id} [${q.angle}] rows=${rows.length} tables=${JSON.stringify(tables)}`);
    if (rows.length > 0) {
      console.log(`     e.g. ${rows.slice(0, 2).map((r) => r.cells.slice(0, 90)).join(' || ')}`);
    }
  }
  console.log(`\nДостигли таблиц: ${reached}/${qs.length}`);
  await app.close();
}

main().catch((e) => {
  console.error('PROBE ERROR:', e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
