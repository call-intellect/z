import { createPrismaClient } from './_lib/prisma';

interface Args {
  user: string | null;
  conversationId: string | null;
  sinceDays: number;
  limit: number;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    user: null,
    conversationId: null,
    sinceDays: 3,
    limit: 10,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user' || a === '--email') out.user = argv[++i] ?? null;
    else if (a === '--conversation' || a === '--conv') out.conversationId = argv[++i] ?? null;
    else if (a === '--since-days') out.sinceDays = Number(argv[++i] ?? '3');
    else if (a === '--limit') out.limit = Number(argv[++i] ?? '10');
    else if (a === '--json') out.json = true;
  }
  return out;
}

const PARTIAL_PREFIX = 'Не успел собрать полный ответ за отведённые шаги';
const ABSTAIN_PREFIX = 'В памяти компании я этого не нашёл';

function preview(s: string, n = 280): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}

function toolNameFromMessage(content: string, toolCallsJson: unknown): string | null {
  try {
    const obj = JSON.parse(content) as Record<string, unknown>;
    if (typeof obj.tool === 'string') return obj.tool;
  } catch {
    /* not json */
  }
  if (Array.isArray(toolCallsJson) && toolCallsJson.length > 0) {
    const first = toolCallsJson[0] as Record<string, unknown>;
    if (typeof first?.name === 'string') return first.name;
  }
  return null;
}

function looksLikeRawChatV2Json(text: string): boolean {
  return (
    text.includes('"conversationId"') &&
    text.includes('"messageId"') &&
    text.includes('"text"')
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.user && !args.conversationId) {
    process.stderr.write(
      'Usage: bun run scripts/diag-concierge.ts --user <email> [--since-days N] [--limit N] [--json]\n' +
        '   or: bun run scripts/diag-concierge.ts --conversation <id> [--json]\n',
    );
    process.exit(1);
  }

  const prisma = createPrismaClient();
  try {
    const since = new Date(Date.now() - args.sinceDays * 24 * 60 * 60 * 1000);

    let conversationIds: string[] = [];
    let usersInfo: Array<{ id: string; email: string; signupSource: string | null }> = [];

    if (args.conversationId) {
      conversationIds = [args.conversationId];
    } else if (args.user) {
      const users = await prisma.user.findMany({
        where: { email: args.user },
        select: { id: true, email: true, signupSource: true },
      });
      usersInfo = users;
      if (users.length === 0) {
        process.stdout.write(`Пользователь с email ${args.user} не найден.\n`);
        return;
      }
      const convs = await prisma.conciergeConversation.findMany({
        where: {
          userId: { in: users.map((u) => u.id) },
          OR: [{ lastMessageAt: { gte: since } }, { startedAt: { gte: since } }],
        },
        orderBy: { lastMessageAt: 'desc' },
        take: args.limit,
        select: { id: true },
      });
      conversationIds = convs.map((c) => c.id);
    }

    if (conversationIds.length === 0) {
      process.stdout.write(
        `Разговоров не найдено (email=${args.user ?? '-'}, за последние ${args.sinceDays} дн.).\n`,
      );
      return;
    }

    const report: unknown[] = [];

    for (const convId of conversationIds) {
      const conv = await prisma.conciergeConversation.findUnique({
        where: { id: convId },
        select: {
          id: true,
          tenantId: true,
          userId: true,
          startedAt: true,
          lastMessageAt: true,
          archivedAt: true,
          pageContextJson: true,
        },
      });
      if (!conv) continue;

      const messages = await prisma.conciergeMessage.findMany({
        where: { conversationId: convId },
        orderBy: { createdAt: 'asc' },
        select: { role: true, content: true, toolCallsJson: true, createdAt: true },
      });

      const toolMessages = messages.filter((m) => m.role === 'tool');
      const toolsCalled = toolMessages
        .map((m) => toolNameFromMessage(m.content, m.toolCallsJson))
        .filter((x): x is string => x !== null);
      const askChatV2Count = toolsCalled.filter((t) => t === 'ask_chat_v2').length;

      const assistantMsgs = messages.filter((m) => m.role === 'assistant');
      const finalAssistant = assistantMsgs[assistantMsgs.length - 1] ?? null;
      const finalText = finalAssistant?.content ?? '';

      const passthrough =
        finalAssistant?.toolCallsJson != null &&
        typeof finalAssistant.toolCallsJson === 'object' &&
        (finalAssistant.toolCallsJson as Record<string, unknown>).askChatV2Passthrough === true;

      const isPartialDump = finalText.startsWith(PARTIAL_PREFIX);
      const dumpedRawChatV2 = isPartialDump && looksLikeRawChatV2Json(finalText);
      const isHonestAbstain = finalText.startsWith(ABSTAIN_PREFIX);

      const verdict = dumpedRawChatV2
        ? 'СБОЙ: исчерпан лимит шагов → вывалил сырой JSON ask_chat_v2 (buildPartialAnswer)'
        : isPartialDump
          ? 'СБОЙ: исчерпан лимит шагов (buildPartialAnswer), без сырого chat-v2 JSON'
          : passthrough
            ? 'OK: passthrough — отдан чистый текст ask_chat_v2'
            : isHonestAbstain
              ? 'OK: честный отказ chat-v2 (нет данных)'
              : 'OK/прочее: финальный текст собран моделью';

      const entry = {
        conversationId: conv.id,
        tenantId: conv.tenantId,
        userId: conv.userId,
        startedAt: conv.startedAt,
        lastMessageAt: conv.lastMessageAt,
        archived: conv.archivedAt != null,
        totalMessages: messages.length,
        userTurns: messages.filter((m) => m.role === 'user').length,
        toolSteps: toolMessages.length,
        toolsCalled,
        askChatV2Count,
        passthrough,
        finalStartsWithPartial: isPartialDump,
        dumpedRawChatV2Json: dumpedRawChatV2,
        finalTextPreview: preview(finalText),
        verdict,
        timeline: messages.map((m) => ({
          at: m.createdAt,
          role: m.role,
          tool: m.role === 'tool' ? toolNameFromMessage(m.content, m.toolCallsJson) : null,
          preview: preview(m.content, 160),
        })),
      };
      report.push(entry);
    }

    if (args.json) {
      process.stdout.write(`${JSON.stringify({ users: usersInfo, report }, null, 2)}\n`);
      return;
    }

    if (usersInfo.length > 0) {
      process.stdout.write(`\nПользователь: ${args.user}\n`);
      for (const u of usersInfo) {
        process.stdout.write(`  • userId=${u.id} signupSource=${u.signupSource ?? '-'}\n`);
      }
    }

    for (const e of report as Array<Record<string, unknown>>) {
      process.stdout.write(`\n${'═'.repeat(72)}\n`);
      process.stdout.write(`Разговор ${e.conversationId}  (tenant=${e.tenantId})\n`);
      process.stdout.write(
        `  начат: ${String(e.startedAt)}  последнее: ${String(e.lastMessageAt)}  архив: ${e.archived}\n`,
      );
      process.stdout.write(
        `  сообщений: ${e.totalMessages}  реплик юзера: ${e.userTurns}  tool-шагов: ${e.toolSteps}\n`,
      );
      process.stdout.write(
        `  инструменты: [${(e.toolsCalled as string[]).join(', ') || '—'}]  ask_chat_v2×${e.askChatV2Count}  passthrough=${e.passthrough}\n`,
      );
      process.stdout.write(`  ВЕРДИКТ: ${e.verdict}\n`);
      process.stdout.write(`  финал: ${e.finalTextPreview}\n`);
      process.stdout.write(`  — таймлайн —\n`);
      for (const t of e.timeline as Array<Record<string, unknown>>) {
        const tool = t.tool ? ` [${t.tool}]` : '';
        process.stdout.write(`    ${String(t.role).padEnd(9)}${tool}  ${t.preview}\n`);
      }
    }
    process.stdout.write('\n');
  } finally {
    await prisma.$disconnect();
  }
}

void main();
