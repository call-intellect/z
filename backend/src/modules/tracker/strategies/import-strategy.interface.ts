import type { ImportLog } from '@prisma/client';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { MessageService } from '../../messaging/services/message.service';
import type { WorkChatService } from '../../messaging/services/work-chat.service';
import type { S3Service } from '../../recordings/s3.service';
import type { ImportErrorEntry } from '../dto/imports/import-log-response.dto';
import type { TrackerEventsService } from '../services/tracker-events.service';

export interface ImportStrategy {
  run(args: ImportStrategyArgs): Promise<ImportResult>;
}

export interface ImportStrategyArgs {
  importLog: ImportLog;
  params: Record<string, unknown>;
  services: ImportStrategyServices;
  onProgress(args: { processed: number; total: number; phase: string }): Promise<void>;
}

export interface ImportStrategyServices {
  prisma: PrismaService;
  s3: S3Service;
  metrics?: BusinessMetricsService;
  events: TrackerEventsService;
  workChat: WorkChatService;
  messageService: MessageService;
}

export interface ImportResult {
  totalProjects: number;
  totalIssues: number;
  totalComments: number;
  totalAttachments: number;
  unmatchedEmails: string[];
  errors: ImportErrorEntry[];
}
