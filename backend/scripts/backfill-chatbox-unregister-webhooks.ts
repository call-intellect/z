import { CryptoService } from '../src/common/crypto/crypto.service';

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const API_PREFIX = '/api/v1';
const WEBHOOK_PATH_MARKER = '/api/v1/webhooks/chatbox/';
const DESCRIPTION_MARKER = 'Кора';
const TIMEOUT_MS = 20_000;

interface ChatboxWebhook {
  id: string;
  url?: string | null;
  description?: string | null;
}

interface Stats {
  integrations: number;
  webhooksSeen: number;
  matched: number;
  deleted: number;
  skipped: number;
  errors: number;
}

function baseUrl(): string {
  return (process.env['CHATBOX_API_BASE_URL'] ?? 'https://app.agent-lia.ru').replace(/\/+$/, '');
}

function makeCfgStub(): { crypto: { masterKey: string } } {
  const raw = process.env['CRYPTO_MASTER_KEY'] ?? '';
  if (!raw) {
    throw new Error(
      'backfill-chatbox-unregister-webhooks: ENV CRYPTO_MASTER_KEY не задан — токены не расшифровать.',
    );
  }
  return { crypto: { masterKey: raw } };
}

async function callChatbox(
  token: string,
  method: 'GET' | 'DELETE',
  path: string,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(`${baseUrl()}${API_PREFIX}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

function isOurWebhook(wh: ChatboxWebhook): boolean {
  const url = wh.url ?? '';
  const description = wh.description ?? '';
  return url.includes(WEBHOOK_PATH_MARKER) || description.includes(DESCRIPTION_MARKER);
}

function extractWebhooks(body: unknown): ChatboxWebhook[] {
  if (body && typeof body === 'object' && Array.isArray((body as { webhooks?: unknown }).webhooks)) {
    return (body as { webhooks: ChatboxWebhook[] }).webhooks;
  }
  return [];
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const crypto = new CryptoService(makeCfgStub() as never);

  const rows = await prisma.chatboxIntegration.findMany({
    select: { tenantId: true, workspaceId: true, workspaceName: true, tokenEnc: true },
  });

  const stats: Stats = {
    integrations: rows.length,
    webhooksSeen: 0,
    matched: 0,
    deleted: 0,
    skipped: 0,
    errors: 0,
  };

  console.log(
    `[unregister-chatbox-webhooks] start dryRun=${dryRun} integrations=${rows.length} base=${baseUrl()}`,
  );

  for (const row of rows) {
    const label = `tenant=${row.tenantId} ws=${row.workspaceName ?? row.workspaceId}`;
    let token: string;
    try {
      token = crypto.decrypt(row.tokenEnc);
    } catch (err) {
      stats.errors += 1;
      console.warn(`  ✗ ${label}: токен не расшифровать — ${err instanceof Error ? err.message : err}`);
      continue;
    }

    let listed: Awaited<ReturnType<typeof callChatbox>>;
    try {
      listed = await callChatbox(token, 'GET', `/workspaces/${encodeURIComponent(row.workspaceId)}/webhooks`);
    } catch (err) {
      stats.errors += 1;
      console.warn(`  ✗ ${label}: list webhooks упал — ${err instanceof Error ? err.message : err}`);
      continue;
    }
    if (!listed.ok) {
      stats.skipped += 1;
      console.warn(`  ↷ ${label}: list webhooks → HTTP ${listed.status} (пропуск)`);
      continue;
    }

    const webhooks = extractWebhooks(listed.body);
    stats.webhooksSeen += webhooks.length;
    const ours = webhooks.filter(isOurWebhook);
    stats.matched += ours.length;

    for (const wh of ours) {
      if (dryRun) {
        console.log(`  • ${label}: [dry-run] снял бы webhook ${wh.id} (${wh.url ?? wh.description ?? '—'})`);
        continue;
      }
      try {
        const del = await callChatbox(
          token,
          'DELETE',
          `/workspaces/${encodeURIComponent(row.workspaceId)}/webhooks/${encodeURIComponent(wh.id)}`,
        );
        if (del.ok || del.status === 404) {
          stats.deleted += 1;
          console.log(`  ✓ ${label}: webhook ${wh.id} снят`);
        } else {
          stats.errors += 1;
          console.warn(`  ✗ ${label}: delete webhook ${wh.id} → HTTP ${del.status}`);
        }
      } catch (err) {
        stats.errors += 1;
        console.warn(`  ✗ ${label}: delete webhook ${wh.id} упал — ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  console.log(
    `[unregister-chatbox-webhooks] done: integrations=${stats.integrations} ` +
      `webhooksSeen=${stats.webhooksSeen} matched=${stats.matched} deleted=${stats.deleted} ` +
      `skipped=${stats.skipped} errors=${stats.errors}`,
  );
}

main()
  .catch((err) => {
    console.error('[unregister-chatbox-webhooks] ERROR', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
