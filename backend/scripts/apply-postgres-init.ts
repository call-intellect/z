import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL не задан в env');
  }

  const sqlPath = join(__dirname, 'postgres-init.sql');
  const sql = readFileSync(sqlPath, 'utf8');

  // eslint-disable-next-line no-console
  console.log(`=== apply-postgres-init START (${sqlPath}) ===`);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(sql);
    // eslint-disable-next-line no-console
    console.log('✓ postgres-init.sql выполнен');
  } finally {
    await client.end();
  }

  // eslint-disable-next-line no-console
  console.log('=== apply-postgres-init DONE ===');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('apply-postgres-init FAILED:', err);
  process.exit(1);
});
