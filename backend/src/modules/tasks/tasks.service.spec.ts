import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AuditLogService } from '../audit/audit-log.service';

import type { MeetingActionItemsService } from '../meetings/meeting-action-items.service';

import type { TasksDispatcherService } from './tasks-dispatcher.service';
import type { TasksRepository } from './tasks.repository';
import { TasksService } from './tasks.service';

describe('TasksService', () => {
  let prisma: { meeting: { findUnique: ReturnType<typeof vi.fn> } };
  let repo: {
    findById: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    listByMeeting: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    bulkUpdateStatus: ReturnType<typeof vi.fn>;
    bulkDelete: ReturnType<typeof vi.fn>;
  };
  let cfg: TypedConfigService;
  let dispatcher: { sendTask: ReturnType<typeof vi.fn> };
  let audit: { log: ReturnType<typeof vi.fn> };
  let actionItems: {
    isTrackerOnly: ReturnType<typeof vi.fn>;
    listForMeeting: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    prisma = { meeting: { findUnique: vi.fn() } };
    repo = {
      findById: vi.fn(),
      list: vi.fn(async () => ({ items: [], total: 0 })),
      listByMeeting: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 't1' })),
      update: vi.fn(async () => ({ id: 't1' })),
      delete: vi.fn(async () => ({ id: 't1' })),
      bulkUpdateStatus: vi.fn(async () => 3),
      bulkDelete: vi.fn(async () => 2),
    };
    cfg = {
      workspace: { maxBulkOperationIds: 200 },
    } as unknown as TypedConfigService;
    dispatcher = { sendTask: vi.fn(async () => undefined) };
    audit = { log: vi.fn(async () => undefined) };
    // Ф5.2 — по дефолту флаг OFF: listByMeeting читает Task через repo.
    actionItems = {
      isTrackerOnly: vi.fn(async () => false),
      listForMeeting: vi.fn(async () => []),
    };
  });

  function make(): TasksService {
    return new TasksService(
      prisma as unknown as PrismaService,
      repo as unknown as TasksRepository,
      cfg,
      dispatcher as unknown as TasksDispatcherService,
      audit as unknown as AuditLogService,
      actionItems as unknown as MeetingActionItemsService,
    );
  }

  describe('create (manual)', () => {
    it('успех — owner совпадает, createdManually=true', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        ownerId: 'u1',
        deletedAt: null,
      });
      const svc = make();
      await svc.create('m1', 'u1', { title: 'Задача' });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          meetingId: 'm1',
          userId: 'u1',
          title: 'Задача',
          createdManually: true,
        }),
      );
    });

    it('встреча чужая → NotFoundException (маскируем Forbidden)', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        ownerId: 'other',
        deletedAt: null,
      });
      const svc = make();
      await expect(
        svc.create('m1', 'u1', { title: 't' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('встреча soft-deleted → NotFoundException', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        ownerId: 'u1',
        deletedAt: new Date(),
      });
      const svc = make();
      await expect(
        svc.create('m1', 'u1', { title: 't' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('owner совпадает → обновляет', async () => {
      repo.findById.mockResolvedValue({ id: 't1', userId: 'u1' });
      const svc = make();
      await svc.update('t1', 'u1', { title: 'new' });
      expect(repo.update).toHaveBeenCalledWith('t1', expect.objectContaining({ title: 'new' }));
    });

    it('задача чужая → NotFoundException', async () => {
      repo.findById.mockResolvedValue({ id: 't1', userId: 'other' });
      const svc = make();
      await expect(svc.update('t1', 'u1', { title: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('задачи нет → NotFoundException', async () => {
      repo.findById.mockResolvedValue(null);
      const svc = make();
      await expect(svc.update('t1', 'u1', { title: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('bulk', () => {
    it('mark_done → repo.bulkUpdateStatus', async () => {
      const svc = make();
      const r = await svc.bulk('u1', { ids: ['a', 'b', 'c'], action: 'mark_done' });
      expect(repo.bulkUpdateStatus).toHaveBeenCalledWith(['a', 'b', 'c'], 'u1', 'done');
      expect(r).toEqual({ affected: 3, action: 'mark_done' });
    });

    it('delete → repo.bulkDelete', async () => {
      const svc = make();
      const r = await svc.bulk('u1', { ids: ['a', 'b'], action: 'delete' });
      expect(repo.bulkDelete).toHaveBeenCalledWith(['a', 'b'], 'u1');
      expect(r).toEqual({ affected: 2, action: 'delete' });
    });

    it('лимит превышен → BadRequestException', async () => {
      cfg = {
        workspace: { maxBulkOperationIds: 2 },
      } as unknown as TypedConfigService;
      const svc = make();
      await expect(
        svc.bulk('u1', { ids: ['1', '2', '3'], action: 'mark_done' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('дедуплицирует ids', async () => {
      const svc = make();
      await svc.bulk('u1', { ids: ['a', 'a', 'b'], action: 'mark_done' });
      expect(repo.bulkUpdateStatus).toHaveBeenCalledWith(['a', 'b'], 'u1', 'done');
    });
  });

  describe('send', () => {
    it('передаёт задачу диспетчеру', async () => {
      repo.findById.mockResolvedValue({ id: 't1', userId: 'u1' });
      const svc = make();
      const r = await svc.send('t1', 'u1', 'd1');
      expect(dispatcher.sendTask).toHaveBeenCalledWith(
        { id: 't1', userId: 'u1' },
        'd1',
      );
      expect(r).toEqual({ ok: true });
    });

    it('задача чужая → NotFoundException', async () => {
      repo.findById.mockResolvedValue({ id: 't1', userId: 'other' });
      const svc = make();
      await expect(svc.send('t1', 'u1', 'd1')).rejects.toBeInstanceOf(NotFoundException);
      expect(dispatcher.sendTask).not.toHaveBeenCalled();
    });
  });
});
