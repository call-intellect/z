import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  MarkWrongBodySchema,
  type KnowledgeProfileDto,
  type MarkWrongBody,
  type MarkWrongResponseDto,
} from './dto/knowledge-clone.dto';
import { KnowledgeCloneService } from './services/knowledge-clone.service';

@ApiTags('knowledge-clone')
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class KnowledgeCloneController {
  constructor(
    @Inject(KnowledgeCloneService)
    private readonly clones: KnowledgeCloneService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('me/knowledge-profile')
  @ApiOperation({
    summary: 'Свой профиль знаний (что Кора знает обо мне)',
  })
  async getMyProfile(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<KnowledgeProfileDto> {
    const t = this.requireTenant(tenantId);
    return this.clones.getMyProfile({ tenantId: t, userId: user.id });
  }

  @Get('persons/:id/knowledge-profile')
  @ApiOperation({
    summary: 'Профиль знаний сотрудника',
  })
  async getPersonProfile(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<KnowledgeProfileDto> {
    const t = this.requireTenant(tenantId);
    const ctx = await this.rbac.loadContext(user.id, t);
    if (!ctx) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет доступа к этой организации',
        },
      });
    }
    const role = ctx.isSuperAdmin ? 'owner' : ctx.role;
    return this.clones.getPersonProfile({
      tenantId: t,
      requesterUserId: user.id,
      requesterRole: ['owner', 'admin', 'manager'].includes(role)
        ? (role as 'owner' | 'admin' | 'manager')
        : 'unknown',
      personId: id,
    });
  }

  @Post('me/knowledge-profile/mark-wrong')
  @ApiOperation({
    summary: 'Пометить область знаний в своём профиле как неверную',
  })
  async markWrong(
    @Body(new ZodValidationPipe(MarkWrongBodySchema)) body: MarkWrongBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<MarkWrongResponseDto> {
    const t = this.requireTenant(tenantId);
    return this.clones.markWrong({ tenantId: t, userId: user.id, body });
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
}
