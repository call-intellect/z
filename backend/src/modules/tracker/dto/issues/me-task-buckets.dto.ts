import { z } from 'zod';

export const MyTaskBucketsQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  limitPerBucket: z.coerce.number().int().min(1).max(100).default(50),
});
export type MyTaskBucketsQuery = z.infer<typeof MyTaskBucketsQuerySchema>;

export type TaskBucketReason = 'overdue' | 'stuck' | 'overdue_and_stuck';

export interface TaskBucketItemDto {
  id: string;
  identifier: string;
  title: string;
  dueDate: string | null;
  completedAt: string | null;
  stateCategory: string | null;
  projectName: string | null;
  lastActivityAt: string | null;
  hasJournal: boolean;
  reason: TaskBucketReason | null;
}

export interface TaskBucketsResponseDto {
  overdueStuck: TaskBucketItemDto[];
  inProgress: TaskBucketItemDto[];
  noDueDate: TaskBucketItemDto[];
  done: TaskBucketItemDto[];
  counts: {
    overdueStuck: number;
    inProgress: number;
    noDueDate: number;
    done: number;
  };
}

export const MyMethodCapturePendingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type MyMethodCapturePendingQuery = z.infer<typeof MyMethodCapturePendingQuerySchema>;

export interface MethodCapturePendingItemDto {
  id: string;
  identifier: string;
  title: string;
  completedAt: string | null;
  complexity: number;
}

export interface MethodCapturePendingResponseDto {
  items: MethodCapturePendingItemDto[];
}
