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
  type CreateTagDto,
  CreateTagSchema,
  type SetMeetingTagsDto,
  SetMeetingTagsSchema,
  type UpdateTagDto,
  UpdateTagSchema,
} from './dto/tag.dto';
import { TagsService } from './tags.service';

@Controller('api/v1')
@UseGuards(CookieAuthGuard)
export class TagsController {
  constructor(@Inject(TagsService) private readonly tags: TagsService) {}

  @Get('tags')
  async list(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ items: ReturnType<TagsController['mapTag']>[] }> {
    const items = await this.tags.list(user.id);
    return { items: items.map((t) => this.mapTag(t)) };
  }

  @Post('tags')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(CreateTagSchema)) body: CreateTagDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReturnType<TagsController['mapTag']>> {
    const tag = await this.tags.create(user.id, body);
    return this.mapTag(tag);
  }

  @Patch('tags/:id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTagSchema)) body: UpdateTagDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReturnType<TagsController['mapTag']>> {
    const tag = await this.tags.update(id, user.id, body);
    return this.mapTag(tag);
  }

  @Delete('tags/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload): Promise<void> {
    await this.tags.delete(id, user.id);
  }

  @Get('meetings/:id/tags')
  async listMeetingTags(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ items: ReturnType<TagsController['mapTag']>[] }> {
    const items = await this.tags.listMeetingTags(meetingId, user.id);
    return { items: items.map((t) => this.mapTag(t)) };
  }

  @Post('meetings/:id/tags')
  @HttpCode(HttpStatus.OK)
  async setMeetingTags(
    @Param('id') meetingId: string,
    @Body(new ZodValidationPipe(SetMeetingTagsSchema)) body: SetMeetingTagsDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true; count: number }> {
    return this.tags.setMeetingTags(meetingId, user.id, body);
  }

  private mapTag(t: { id: string; name: string; color: string; createdAt: Date }): {
    id: string;
    name: string;
    color: string;
    createdAt: string;
  } {
    return {
      id: t.id,
      name: t.name,
      color: t.color,
      createdAt: t.createdAt.toISOString(),
    };
  }
}
