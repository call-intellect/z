import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  CreateCommentSchema,
  type CreateCommentDto,
} from '../dto/comments/create-comment.dto';
import {
  UpdateCommentSchema,
  type UpdateCommentDto,
} from '../dto/comments/update-comment.dto';
import type { CommentResponseDto } from '../services/comments.service';
import { CommentsService } from '../services/comments.service';

/**
 * REST `/api/v1/issues/:id/comments` + `/api/v1/comments/:commentId`.
 * RBAC ResourceType='issue' (комментарий = логически дочерний ресурс).
 *
 * TODO Sprint 2: `Idempotency-Key` middleware на POST /comments.
 */
@ApiTags('tracker / comments')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class CommentsController {
  constructor(
    @Inject(CommentsService) private readonly svc: CommentsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('issues/:id/comments')
  @ApiOperation({ summary: 'Список комментариев задачи' })
  async list(
    @Param('id') issueId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CommentResponseDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findByIssue(issueId, t);
  }

  @Post('issues/:id/comments')
  @ApiOperation({ summary: 'Создать комментарий к задаче' })
  async create(
    @Param('id') issueId: string,
    @Body(new ZodValidationPipe(CreateCommentSchema)) body: CreateCommentDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CommentResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.create(issueId, body, t, user.id);
  }

  @Patch('comments/:commentId')
  @ApiOperation({ summary: 'Изменить комментарий (только автор)' })
  async update(
    @Param('commentId') commentId: string,
    @Body(new ZodValidationPipe(UpdateCommentSchema)) body: UpdateCommentDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CommentResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.update(commentId, body, t, user.id);
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить комментарий (автор или admin)' })
  async remove(
    @Param('commentId') commentId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    const ctx = await this.rbac.loadContext(user.id, t);
    const isAdmin = ctx?.role === 'admin' || ctx?.role === 'owner' || !!ctx?.isSuperAdmin;
    await this.svc.softDelete(commentId, t, user.id, isAdmin);
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на чтение задач' },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на комментирование' },
      });
    }
  }
}
