import { Inject, Injectable } from '@nestjs/common';
import { type Prisma, type Task, type TaskStatus } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

export interface TaskListFilters {
  userId: string;
  page: number;
  limit: number;
  status?: TaskStatus[];
  meetingId?: string;
  dueBefore?: Date;
  q?: string;
}

@Injectable()
export class TasksRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Task | null> {
    return this.prisma.task.findUnique({ where: { id } });
  }

  async list(filters: TaskListFilters): Promise<{ items: Task[]; total: number }> {
    const where: Prisma.TaskWhereInput = {
      userId: filters.userId,
      ...(filters.status && filters.status.length > 0 ? { status: { in: filters.status } } : {}),
      ...(filters.meetingId ? { meetingId: filters.meetingId } : {}),
      ...(filters.dueBefore ? { dueDate: { lte: filters.dueBefore } } : {}),
      ...(filters.q ? { title: { contains: filters.q, mode: 'insensitive' } } : {}),
    };
    const skip = (filters.page - 1) * filters.limit;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: filters.limit,
      }),
      this.prisma.task.count({ where }),
    ]);
    return { items, total };
  }

  listByMeeting(meetingId: string, userId: string): Promise<Task[]> {
    return this.prisma.task.findMany({
      where: { meetingId, userId },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    });
  }

  create(data: {
    meetingId: string;
    userId: string;
    title: string;
    description: string | null;
    assigneeRaw: string | null;
    dueDate: Date | null;
    createdManually: boolean;
  }): Promise<Task> {
    return this.prisma.task.create({
      data: {
        meetingId: data.meetingId,
        userId: data.userId,
        title: data.title,
        description: data.description,
        assigneeRaw: data.assigneeRaw,
        dueDate: data.dueDate,
        createdManually: data.createdManually,
      },
    });
  }

  update(id: string, data: Prisma.TaskUpdateInput, tx?: Prisma.TransactionClient): Promise<Task> {
    const client = tx ?? this.prisma;
    return client.task.update({ where: { id }, data });
  }

  delete(id: string): Promise<Task> {
    return this.prisma.task.delete({ where: { id } });
  }

  async bulkUpdateStatus(ids: string[], userId: string, status: TaskStatus): Promise<number> {
    const result = await this.prisma.task.updateMany({
      where: { id: { in: ids }, userId },
      data: { status },
    });
    return result.count;
  }

  async bulkDelete(ids: string[], userId: string): Promise<number> {
    const result = await this.prisma.task.deleteMany({
      where: { id: { in: ids }, userId },
    });
    return result.count;
  }
}
