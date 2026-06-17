import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import {
  type CreateTemplateDto,
  CreateTemplateSchema,
  type UpdateTemplateDto,
  UpdateTemplateSchema,
} from './dto/template.dto';
import { TemplatesService } from './templates.service';

@Controller('api/v1/templates')
@UseGuards(CookieAuthGuard)
export class TemplatesController {
  constructor(@Inject(TemplatesService) private readonly templates: TemplatesService) {}

  @Get()
  async list(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ items: ReturnType<TemplatesController['mapTemplate']>[] }> {
    const items = await this.templates.list(user.id);
    return { items: items.map((t) => this.mapTemplate(t)) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(CreateTemplateSchema)) body: CreateTemplateDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReturnType<TemplatesController['mapTemplate']>> {
    const tpl = await this.templates.create(user.id, body);
    return this.mapTemplate(tpl);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTemplateSchema)) body: UpdateTemplateDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReturnType<TemplatesController['mapTemplate']>> {
    const tpl = await this.templates.update(id, user.id, body);
    return this.mapTemplate(tpl);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload): Promise<void> {
    await this.templates.delete(id, user.id);
  }

  private mapTemplate(t: {
    id: string;
    name: string;
    basedOnType: string | null;
    prompt: string | null;
    sectionsConfig: string[];
    createdAt: Date;
    updatedAt: Date;
  }): {
    id: string;
    name: string;
    basedOnType: string | null;
    prompt: string | null;
    sectionsConfig: string[];
    createdAt: string;
    updatedAt: string;
  } {
    return {
      id: t.id,
      name: t.name,
      basedOnType: t.basedOnType,
      prompt: t.prompt,
      sectionsConfig: t.sectionsConfig,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }
}
