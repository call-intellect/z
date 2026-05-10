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
import { ApiExcludeController } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import { CreateOrgSchema, type CreateOrgDto } from './dto/create-org.dto';
import { InviteMemberSchema, type InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberSchema, type UpdateMemberDto } from './dto/update-member.dto';
import { UpdateOrgSchema, type UpdateOrgDto } from './dto/update-org.dto';
import { OrgInvitationsService } from './org-invitations.service';
import { OrgsService } from './orgs.service';

/**
 * Org / Membership / Invitation API.
 *
 * Все эндпоинты требуют CookieAuthGuard. Org-scoped (по :id) сами проверяют
 * членство через RbacService — отдельный TenantGuard здесь не нужен, потому
 * что тут URL уже эксплицитно содержит orgId как путь.
 */
@ApiExcludeController()
@Controller('api/v1/orgs')
@UseGuards(CookieAuthGuard)
export class OrgsController {
  constructor(
    @Inject(OrgsService) private readonly orgs: OrgsService,
    @Inject(OrgInvitationsService) private readonly invitations: OrgInvitationsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(CreateOrgSchema)) body: CreateOrgDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ org: { id: string; name: string; slug: string } }> {
    const org = await this.orgs.createForOwner({
      name: body.name,
      ownerId: user.id,
    });
    return { org: { id: org.id, name: org.name, slug: org.slug } };
  }

  @Get('me')
  async listMine(@CurrentUser() user: CurrentUserPayload) {
    const orgs = await this.orgs.listForUser(user.id);
    return { orgs };
  }

  @Get(':id')
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const org = await this.orgs.getById(id, user.id);
    return { org };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateOrgSchema)) body: UpdateOrgDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const org = await this.orgs.update(id, user.id, body);
    return { org };
  }

  @Get(':id/members')
  async listMembers(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const members = await this.orgs.listMembers(id, user.id);
    return { members };
  }

  @Patch(':id/members/:userId')
  async updateMember(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body(new ZodValidationPipe(UpdateMemberSchema)) body: UpdateMemberDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const member = await this.orgs.updateMember(id, user.id, targetUserId, body.role);
    return { member };
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.OK)
  async removeMember(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    await this.orgs.removeMember(id, user.id, targetUserId);
    return { ok: true };
  }

  // ─────────────────────────── invitations ──────────────────────────

  @Post(':id/invitations')
  @HttpCode(HttpStatus.CREATED)
  async invite(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(InviteMemberSchema)) body: InviteMemberDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const invitation = await this.invitations.createInvitation({
      orgId: id,
      actorUserId: user.id,
      email: body.email,
      role: body.role,
    });
    return { invitation };
  }

  @Get(':id/invitations')
  async listInvitations(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const invitations = await this.invitations.listForOrg(id, user.id);
    return { invitations };
  }

  @Delete(':id/invitations/:invitationId')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Param('id') id: string,
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    await this.invitations.revoke(id, invitationId, user.id);
    return { ok: true };
  }
}

/**
 * Отдельный контроллер для accept-эндпоинта по token'у — без orgId в URL.
 */
@ApiExcludeController()
@Controller('api/v1/orgs/invitations')
@UseGuards(CookieAuthGuard)
export class OrgInvitationsAcceptController {
  constructor(
    @Inject(OrgInvitationsService) private readonly invitations: OrgInvitationsService,
  ) {}

  @Post(':token/accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @Param('token') token: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const result = await this.invitations.acceptInvitation(token, user.id);
    return result;
  }
}
