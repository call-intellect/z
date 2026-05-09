import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { UserTemplate } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';

import type { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';
import { TemplatesRepository } from './templates.repository';

@Injectable()
export class TemplatesService {
  constructor(
    @Inject(TemplatesRepository) private readonly repo: TemplatesRepository,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  list(userId: string): Promise<UserTemplate[]> {
    return this.repo.listByUser(userId);
  }

  async create(userId: string, dto: CreateTemplateDto): Promise<UserTemplate> {
    const max = this.cfg.workspace.maxUserTemplatesPerUser;
    const count = await this.repo.countByUser(userId);
    if (count >= max) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'templates_limit_reached',
          message: `Достигнут лимит шаблонов (${max})`,
        },
      });
    }
    return this.repo.create({
      userId,
      name: dto.name,
      ...(dto.basedOnType !== undefined ? { basedOnType: dto.basedOnType } : {}),
      ...(dto.prompt !== undefined ? { prompt: dto.prompt } : {}),
      sectionsConfig: dto.sectionsConfig,
    });
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateTemplateDto,
  ): Promise<UserTemplate> {
    const tpl = await this.repo.findById(id);
    if (!tpl || tpl.userId !== userId) {
      throw new NotFoundException('template_not_found');
    }
    return this.repo.update(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.basedOnType !== undefined ? { basedOnType: dto.basedOnType } : {}),
      ...(dto.prompt !== undefined ? { prompt: dto.prompt } : {}),
      ...(dto.sectionsConfig !== undefined
        ? { sectionsConfig: { set: dto.sectionsConfig } }
        : {}),
    });
  }

  async delete(id: string, userId: string): Promise<void> {
    const tpl = await this.repo.findById(id);
    if (!tpl || tpl.userId !== userId) {
      throw new NotFoundException('template_not_found');
    }
    await this.repo.delete(id);
  }
}
