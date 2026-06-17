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
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TranscriptCleaningService } from '../ai/services/transcript-cleaning.service';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { RequireSubscription } from '../billing/guards/require-subscription.decorator';

import { CapabilitiesService } from './capabilities.service';
import { UpsertCapabilitySchema, type UpsertCapabilityDto } from './dto/capability-override.dto';
import { CreateOrgSchema, type CreateOrgDto } from './dto/create-org.dto';
import { InviteMemberSchema, type InviteMemberDto } from './dto/invite-member.dto';
import type { TeamRosterItem } from './dto/team-roster.dto';
import { UpdateMemberSchema, type UpdateMemberDto } from './dto/update-member.dto';
import { UpdateOrgSchema, type UpdateOrgDto } from './dto/update-org.dto';
import { OrgInvitationsService } from './org-invitations.service';
import { OrgsService } from './orgs.service';

const PatchTranscriptCleaningSchema = z.object({ auto: z.boolean() });
type PatchTranscriptCleaningDto = z.infer<typeof PatchTranscriptCleaningSchema>;

@ApiExcludeController()
@Controller('api/v1/orgs')
@UseGuards(CookieAuthGuard)
export class OrgsController {
  constructor(
    @Inject(OrgsService) private readonly orgs: OrgsService,
    @Inject(OrgInvitationsService) private readonly invitations: OrgInvitationsService,
    @Inject(TranscriptCleaningService)
    private readonly transcriptCleaning: TranscriptCleaningService,
    @Inject(CapabilitiesService)
    private readonly capabilities: CapabilitiesService,
  ) {}

  @Post()
  @RequireSubscription()
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
  async byId(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    const org = await this.orgs.getById(id, user.id);
    return { org };
  }

  @Patch(':id')
  @RequireSubscription()
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateOrgSchema)) body: UpdateOrgDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const org = await this.orgs.update(id, user.id, body);
    return { org };
  }

  @Patch(':id/settings/transcript-cleaning')
  @RequireSubscription()
  async setTranscriptCleaningAuto(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PatchTranscriptCleaningSchema))
    body: PatchTranscriptCleaningDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ auto: boolean }> {
    return this.transcriptCleaning.setAuto({
      orgId: id,
      userId: user.id,
      auto: body.auto,
    });
  }

  @Get(':id/members')
  async listMembers(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    const members = await this.orgs.listMembers(id, user.id);
    return { members };
  }

  @Get(':id/team-roster')
  async teamRoster(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ roster: TeamRosterItem[] }> {
    const roster = await this.orgs.listTeamRoster(id, user.id);
    return { roster };
  }

  @Patch(':id/members/:userId')
  @RequireSubscription()
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
  @RequireSubscription()
  @HttpCode(HttpStatus.OK)
  async removeMember(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    await this.orgs.removeMember(id, user.id, targetUserId);
    return { ok: true };
  }

  @Post(':id/invitations')
  @RequireSubscription()
  @HttpCode(HttpStatus.CREATED)
  async invite(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(InviteMemberSchema)) body: InviteMemberDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const invitation = await this.invitations.createInvitation({
      orgId: id,
      actorUserId: user.id,
      email: body.email ?? null,
      name: body.name ?? null,
      role: body.role,
      personId: body.personId ?? null,
    });
    return { invitation };
  }

  @Get(':id/invitations')
  async listInvitations(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    const invitations = await this.invitations.listForOrg(id, user.id);
    return { invitations };
  }

  @Delete(':id/invitations/:invitationId')
  @RequireSubscription()
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Param('id') id: string,
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    await this.invitations.revoke(id, invitationId, user.id);
    return { ok: true };
  }

  @Post(':id/invitations/:invitationId/resend')
  @RequireSubscription()
  @HttpCode(HttpStatus.OK)
  async resendInvitation(
    @Param('id') id: string,
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const invitation = await this.invitations.resendInvitation(id, invitationId, user.id);
    return { invitation };
  }

  @Delete(':id/members/:userId/telegram-binding')
  @RequireSubscription()
  @HttpCode(HttpStatus.OK)
  async resetMemberTelegramBinding(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true; removed: number }> {
    const result = await this.invitations.resetMemberTelegramBinding({
      orgId: id,
      targetUserId,
      actorUserId: user.id,
    });
    return { ok: true, removed: result.removed };
  }

  @Get(':id/members/:userId/capabilities')
  async listCapabilities(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const capabilities = await this.capabilities.listForMember(id, user.id, targetUserId);
    return { capabilities };
  }

  @Put(':id/members/:userId/capabilities/:capability')
  @RequireSubscription()
  async upsertCapability(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Param('capability') capability: string,
    @Body(new ZodValidationPipe(UpsertCapabilitySchema)) body: UpsertCapabilityDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const item = await this.capabilities.upsert(id, user.id, targetUserId, capability, body);
    return { item };
  }

  @Delete(':id/members/:userId/capabilities/:capability')
  @RequireSubscription()
  @HttpCode(HttpStatus.OK)
  async removeCapability(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Param('capability') capability: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    return this.capabilities.remove(id, user.id, targetUserId, capability);
  }

  @Get(':id/effective-access')
  async effectiveAccess(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    const overrides = await this.capabilities.getEffectiveOverrides(user.id, id);
    return { overrides };
  }
}

@ApiExcludeController()
@Controller('api/v1/orgs/invitations')
@UseGuards(CookieAuthGuard)
export class OrgInvitationsAcceptController {
  constructor(@Inject(OrgInvitationsService) private readonly invitations: OrgInvitationsService) {}

  @Post(':token/accept')
  @HttpCode(HttpStatus.OK)
  async accept(@Param('token') token: string, @CurrentUser() user: CurrentUserPayload) {
    const result = await this.invitations.acceptInvitation(token, user.id);
    return result;
  }
}
