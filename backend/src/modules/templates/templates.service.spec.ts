import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';

import type { TemplatesRepository } from './templates.repository';
import { TemplatesService } from './templates.service';

describe('TemplatesService', () => {
  let repo: {
    listByUser: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    countByUser: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let cfg: TypedConfigService;

  beforeEach(() => {
    repo = {
      listByUser: vi.fn(async () => []),
      findById: vi.fn(),
      countByUser: vi.fn(async () => 0),
      create: vi.fn(async () => ({ id: 'tpl1' })),
      update: vi.fn(async () => ({ id: 'tpl1' })),
      delete: vi.fn(async () => ({ id: 'tpl1' })),
    };
    cfg = {
      workspace: { maxUserTemplatesPerUser: 20 },
    } as unknown as TypedConfigService;
  });

  function make(): TemplatesService {
    return new TemplatesService(
      repo as unknown as TemplatesRepository,
      cfg,
    );
  }

  it('create: успех — лимит не превышен', async () => {
    const svc = make();
    await svc.create('u1', { name: 'T', sectionsConfig: ['summary'] });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', name: 'T' }),
    );
  });

  it('create: лимит достигнут → 409', async () => {
    repo.countByUser.mockResolvedValue(20);
    const svc = make();
    await expect(
      svc.create('u1', { name: 'T', sectionsConfig: [] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('update: чужой template → NotFoundException', async () => {
    repo.findById.mockResolvedValue({ id: 'tpl1', userId: 'other' });
    const svc = make();
    await expect(
      svc.update('tpl1', 'u1', { name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('delete: owner совпадает → ok', async () => {
    repo.findById.mockResolvedValue({ id: 'tpl1', userId: 'u1' });
    const svc = make();
    await svc.delete('tpl1', 'u1');
    expect(repo.delete).toHaveBeenCalledWith('tpl1');
  });

  it('delete: template не найден → NotFoundException', async () => {
    repo.findById.mockResolvedValue(null);
    const svc = make();
    await expect(svc.delete('tpl1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
