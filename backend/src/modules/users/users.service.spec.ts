import { Test } from '@nestjs/testing';
import type { User } from '@prisma/client';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { PrismaService } from '../../common/prisma/prisma.service';

import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

/**
 * Юнит-тесты `UsersService.upsertFromCrossmark` с mock-PrismaService.
 *
 * `prisma.$transaction(cb)` мокаем как простой await cb(prisma) — внутри
 * репозиторий получает тот же мок. Это позволяет проверить порядок вызовов
 * без реальной БД.
 */
describe('UsersService.upsertFromCrossmark', () => {
  let service: UsersService;
  let usersRepo: {
    findByExternalId: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    touchLastSeen: ReturnType<typeof vi.fn>;
  };
  let prisma: {
    $transaction: ReturnType<typeof vi.fn>;
    user: {
      update: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(async () => {
    usersRepo = {
      findByExternalId: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      touchLastSeen: vi.fn(),
    };

    prisma = {
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
      user: {
        update: vi.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersRepository, useValue: usersRepo },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  const baseInput = {
    externalId: 'ext-123',
    email: 'alice@x.com',
    name: 'Alice',
  };

  const stubUser = (over: Partial<User> = {}): User => ({
    id: 'u1',
    externalId: 'ext-123',
    email: 'alice@x.com',
    name: 'Alice',
    role: 'user',
    isSuperAdmin: false,
    signupSource: 'crossmark',
    passwordHash: null,
    mustChangePassword: false,
    createdAt: new Date('2026-01-01'),
    lastSeenAt: null,
    deletedAt: null,
    ...over,
  });

  it('создаёт нового пользователя если по externalId никого нет', async () => {
    usersRepo.findByExternalId.mockResolvedValue(null);
    usersRepo.create.mockResolvedValue(stubUser());

    const result = await service.upsertFromCrossmark(baseInput);

    expect(usersRepo.findByExternalId).toHaveBeenCalledWith('ext-123', prisma);
    expect(usersRepo.create).toHaveBeenCalledWith(
      { externalId: 'ext-123', email: 'alice@x.com', name: 'Alice' },
      prisma,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(result.id).toBe('u1');
  });

  it('возвращает существующего пользователя без update если данные совпадают', async () => {
    const existing = stubUser();
    usersRepo.findByExternalId.mockResolvedValue(existing);

    const result = await service.upsertFromCrossmark(baseInput);

    expect(usersRepo.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(result).toBe(existing);
  });

  it('обновляет name если он изменился', async () => {
    const existing = stubUser({ name: 'Old Name' });
    usersRepo.findByExternalId.mockResolvedValue(existing);
    const updated = stubUser({ name: 'Alice' });
    prisma.user.update.mockResolvedValue(updated);

    const result = await service.upsertFromCrossmark(baseInput);

    expect(usersRepo.create).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { name: 'Alice' },
    });
    expect(result.name).toBe('Alice');
  });

  it('обновляет email и name если оба изменились', async () => {
    const existing = stubUser({ email: 'old@x.com', name: 'Old' });
    usersRepo.findByExternalId.mockResolvedValue(existing);
    const updated = stubUser();
    prisma.user.update.mockResolvedValue(updated);

    await service.upsertFromCrossmark(baseInput);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { email: 'alice@x.com', name: 'Alice' },
    });
  });
});
