import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { MessageService } from '../src/modules/messaging/services/message.service';
import { WorkChatService } from '../src/modules/messaging/services/work-chat.service';

import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

const BATCH_SIZE = 100;

interface Options {
  limit?: number;
  dryRun: boolean;
}

export interface BackfillComment {
  id: string;
  authorId: string;
  parentCommentId: string | null;
  content: string;
  contentHtml: string | null;
  contentStripped: string | null;
  access: string;
  authorType: string;
  draftState: string | null;
  cloneConfidence: { toString(): string } | null;
  groundednessScore: { toString(): string } | null;
  voiceUrl: string | null;
  voiceDuration: number | null;
  voiceTranscript: string | null;
  thanksUserIds: string[];
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  mentions: Array<{ mentionedUserId: string }>;
}

export function mapCommentToHistoricalArgs(args: {
  tenantId: string;
  conversationId: string;
  comment: BackfillComment;
  parentMessageId: string | null;
}): {
  tenantId: string;
  conversationId: string;
  authorUserId: string;
  content: string;
  contentHtml: string | null;
  contentStripped: string | null;
  access: string;
  authorType: string;
  parentMessageId: string | null;
  voice: { url: string | null; duration: number | null; transcript: string | null };
  mentions: string[];
  thanksUserIds: string[];
  draftState: string | null;
  cloneConfidence: string | null;
  groundednessScore: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  clientMessageId: string;
} {
  const { tenantId, conversationId, comment, parentMessageId } = args;
  return {
    tenantId,
    conversationId,
    authorUserId: comment.authorId,
    content: comment.content,
    contentHtml: comment.contentHtml,
    contentStripped: comment.contentStripped,
    access: comment.access,
    authorType: comment.authorType,
    parentMessageId,
    voice: {
      url: comment.voiceUrl,
      duration: comment.voiceDuration,
      transcript: comment.voiceTranscript,
    },
    mentions: comment.mentions.map((m) => m.mentionedUserId),
    thanksUserIds: comment.thanksUserIds,
    draftState: comment.draftState,
    cloneConfidence: comment.cloneConfidence?.toString() ?? null,
    groundednessScore: comment.groundednessScore?.toString() ?? null,
    createdAt: comment.createdAt,
    editedAt: comment.editedAt,
    deletedAt: comment.deletedAt,
    clientMessageId: `ic:${comment.id}`,
  };
}

interface Stats {
  issuesScanned: number;
  commentsScanned: number;
  migrated: number;
  skipped: number;
}

function parseArgs(argv: string[]): Options {
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const opts: Options = { dryRun: argv.includes('--dry-run') };
  if (limitArg) {
    const v = limitArg.split('=')[1];
    if (v) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --limit value: "${v}" (expected positive integer)`);
      }
      opts.limit = Math.floor(n);
    }
  }
  return opts;
}

async function main(opts: Options): Promise<void> {
  console.log(
    `=== backfill-issuecomment-to-message START (dryRun=${opts.dryRun}, limit=${opts.limit ?? '<none>'}) ===`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const stats: Stats = {
    issuesScanned: 0,
    commentsScanned: 0,
    migrated: 0,
    skipped: 0,
  };

  try {
    const prisma = app.get(PrismaService);
    const workChat = app.get(WorkChatService);
    const messages = app.get(MessageService);

    let cursorId: string | undefined = undefined;
    let processed = 0;

    while (true) {
      if (opts.limit && processed >= opts.limit) break;

      const issues = await prisma.issue.findMany({
        where: { comments: { some: { messageId: null } } },
        select: { id: true, tenantId: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      });
      if (issues.length === 0) break;

      for (const issue of issues) {
        if (opts.limit && processed >= opts.limit) break;
        stats.issuesScanned++;
        processed++;

        const pending = await prisma.issueComment.findMany({
          where: { issueId: issue.id, messageId: null },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: { mentions: { select: { mentionedUserId: true } } },
        });
        if (pending.length === 0) continue;

        let conversationId: string;
        if (opts.dryRun) {
          const existing = await prisma.issue.findUnique({
            where: { id: issue.id },
            select: { conversationId: true },
          });
          conversationId = existing?.conversationId ?? '<dry-run-conversation>';
        } else {
          conversationId = (await workChat.ensureWorkChat(issue.id)).conversationId;
        }

        const commentToMessage = new Map<string, string>();

        for (const comment of pending) {
          stats.commentsScanned++;
          try {
            const parentMessageId = comment.parentCommentId
              ? (commentToMessage.get(comment.parentCommentId) ?? null)
              : null;

            if (opts.dryRun) {
              console.log(
                `[DRY-RUN] would migrate IssueComment ${comment.id} (issue=${issue.id}) → Message clientMessageId=ic:${comment.id}`,
              );
              stats.migrated++;
              continue;
            }

            const { messageId } = await messages.insertHistorical(
              mapCommentToHistoricalArgs({
                tenantId: issue.tenantId,
                conversationId,
                comment,
                parentMessageId,
              }),
            );

            commentToMessage.set(comment.id, messageId);

            await prisma.issueComment.update({
              where: { id: comment.id },
              data: { messageId },
            });
            await prisma.issueAttachment.updateMany({
              where: { commentId: comment.id },
              data: { messageId },
            });
            await prisma.recognition.updateMany({
              where: { contextEntityType: 'issue_comment', contextEntityId: comment.id },
              data: { contextEntityType: 'message', contextEntityId: messageId },
            });

            stats.migrated++;
          } catch (err) {
            stats.skipped++;
            console.warn(
              `[error] commentId=${comment.id} issueId=${issue.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }

      cursorId = issues[issues.length - 1]?.id;
      if (issues.length < BATCH_SIZE) break;
    }

    console.log('=== Итоги backfill-issuecomment-to-message ===');
    console.log(`  issuesScanned   : ${stats.issuesScanned}`);
    console.log(`  commentsScanned : ${stats.commentsScanned}`);
    console.log(`  migrated        : ${stats.migrated}`);
    console.log(`  skipped         : ${stats.skipped}`);
    console.log(`  mode            : ${opts.dryRun ? 'DRY-RUN' : 'APPLY'}`);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  silenceRedisShutdownNoise();
  main(opts)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('backfill-issuecomment-to-message FAILED:', err);
      process.exit(1);
    });
}
