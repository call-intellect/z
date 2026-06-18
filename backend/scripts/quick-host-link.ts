import { createHmac } from 'node:crypto';

const PARTNER_KEY = process.env['CROSSMARK_KEY'];
if (!PARTNER_KEY) {
  console.error(
    '[quick-host-link] не задан CROSSMARK_KEY. Сделай так:\n' +
      '  KEY=$(bun run scripts/create-integration-key.ts demo | tail -1)\n' +
      '  CROSSMARK_KEY="$KEY" bun run scripts/quick-host-link.ts',
  );
  process.exit(1);
}

const externalId = process.argv[2] ?? 'host-1';
const email = process.argv[3] ?? 'host@local.dev';
const name = process.argv[4] ?? 'Иван Петров';
const type = process.argv[5] ?? 'sales';

const backendUrl = process.env['BACKEND_URL'] ?? 'http://localhost:3000';

async function main(): Promise<void> {
  const body = JSON.stringify({
    host: { external_id: externalId, email, name },
    type,
    title: `Тест-встреча ${new Date().toLocaleString('ru-RU')}`,
  });
  const ts = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', PARTNER_KEY!).update(`${ts}.${body}`).digest('hex');

  const res = await fetch(`${backendUrl}/integrations/crossmark/v1/meetings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PARTNER_KEY}`,
      'X-Crossmark-Signature': signature,
      'X-Crossmark-Timestamp': ts,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[quick-host-link] ${res.status}: ${text}`);
    process.exit(1);
  }

  const json = (await res.json()) as { meeting_id: string; deep_link: string; expires_at: string };
  console.log('[quick-host-link] Встреча создана.');
  console.log(`  meeting_id = ${json.meeting_id}`);
  console.log(`  type       = ${type}`);
  console.log(`  expires_at = ${json.expires_at}`);
  console.log('');
  console.log('Открой в браузере (deep-link установит cookie хоста):');
  console.log(`  ${json.deep_link}`);
  console.log('');
  console.log('После открытия — переходи в:');
  console.log('  http://localhost:3001/meetings           # список встреч');
  console.log('  http://localhost:3001/meetings/create    # создать новую');
}

main().catch((err: unknown) => {
  console.error('[quick-host-link] ошибка:', err);
  process.exit(1);
});
