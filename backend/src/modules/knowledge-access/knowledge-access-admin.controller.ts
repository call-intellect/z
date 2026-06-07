import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { OrgAdminGuard } from '../auth/guards/org-admin.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';

import {
  AddMemberSchema,
  type AddMemberDto,
  SetClosedDefaultSchema,
  type SetClosedDefaultDto,
  SetMatrixSchema,
  type SetMatrixDto,
} from './dto/knowledge-access.dto';
import { KnowledgeAccessAdminService } from './knowledge-access-admin.service';

/**
 * `/api/v1/knowledge-access` — управление доступом к знаниям через группы
 * (ТЗ 2026-06-06 knowledge-access-groups, Фаза 7 часть A).
 *
 * RBAC: owner / admin Org (через `OrgAdminGuard` после `CookieAuthGuard +
 * TenantGuard`). Все запросы tenant-scoped (`tenantId` из @CurrentOrg).
 *
 * Скрыт из публичного Swagger (`@ApiExcludeController`) — admin-only,
 * по образцу `OrgAdminKnowledgeController`.
 */
@ApiTags('knowledge-access')
@ApiExcludeController()
@Controller('api/v1/knowledge-access')
@UseGuards(CookieAuthGuard, TenantGuard, OrgAdminGuard)
export class KnowledgeAccessAdminController {
  constructor(
    @Inject(KnowledgeAccessAdminService)
    private readonly svc: KnowledgeAccessAdminService,
  ) {}

  @Get('groups')
  @ApiOperation({ summary: 'Список групп доступа компании (с числом участников)' })
  async listGroups(@CurrentOrg() tenantId: string) {
    return this.svc.listGroups(tenantId);
  }

  @Get('matrix')
  @ApiOperation({ summary: 'Матрица видимости отделов (направленная)' })
  async getMatrix(@CurrentOrg() tenantId: string) {
    return this.svc.getMatrix(tenantId);
  }

  @Put('matrix/:subjectGroupId')
  @ApiOperation({
    summary: 'Задать направленно список видимых отделов для отдела-субъекта',
  })
  async setMatrix(
    @CurrentOrg() tenantId: string,
    @Param('subjectGroupId') subjectGroupId: string,
    @Body(new ZodValidationPipe(SetMatrixSchema)) body: SetMatrixDto,
  ) {
    return this.svc.setMatrix(tenantId, subjectGroupId, body.visibleGroupIds);
  }

  @Get('groups/:groupId/members')
  @ApiOperation({ summary: 'Список членов группы' })
  async listMembers(
    @CurrentOrg() tenantId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.svc.listMembers(tenantId, groupId);
  }

  @Post('groups/:groupId/members')
  @ApiOperation({ summary: 'Добавить человека в группу (override)' })
  async addMember(
    @CurrentOrg() tenantId: string,
    @Param('groupId') groupId: string,
    @Body(new ZodValidationPipe(AddMemberSchema)) body: AddMemberDto,
  ) {
    return this.svc.addMember(tenantId, groupId, body.personId);
  }

  @Delete('groups/:groupId/members/:personId')
  @ApiOperation({ summary: 'Убрать человека из группы' })
  async removeMember(
    @CurrentOrg() tenantId: string,
    @Param('groupId') groupId: string,
    @Param('personId') personId: string,
  ) {
    return this.svc.removeMember(tenantId, groupId, personId);
  }

  @Patch('meeting-types/:typeId/closed-default')
  @ApiOperation({ summary: 'Дефолт закрытости встреч по типу (крутилка)' })
  async setClosedDefault(
    @Param('typeId') typeId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(SetClosedDefaultSchema)) body: SetClosedDefaultDto,
  ) {
    const userId = user?.id;
    if (!userId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'user_required', message: 'Не удалось определить пользователя' },
      });
    }
    return this.svc.setMeetingTypeClosedDefault(
      typeId,
      body.defaultClosedGroupKind,
      userId,
    );
  }
}
