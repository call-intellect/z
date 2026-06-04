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
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TranscriptCleaningService } from '../ai/services/transcript-cleaning.service';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { RequireSubscription } from '../billing/guards/require-subscription.decorator';

import { CreateOrgSchema, type CreateOrgDto } from './dto/create-org.dto';
import { InviteMemberSchema, type InviteMemberDto } from './dto/invite-member.dto';
import type { TeamRosterItem } from './dto/team-roster.dto';
import { UpdateMemberSchema, type UpdateMemberDto } from './dto/update-member.dto';
import { UpdateOrgSchema, type UpdateOrgDto } from './dto/update-org.dto';
import { OrgInvitationsService } from './org-invitations.service';
import { OrgsService } from './orgs.service';

/**
 * Фаза D — PATCH /api/v1/orgs/:id/settings/transcript-cleaning.
 * Тело — { auto: boolean }. Только owner/admin (проверка в сервисе).
 */
const PatchTranscriptCleaningSchema = z.object({ auto: z.boolean() });
type PatchTranscriptCleaningDto = z.infer<typeof PatchTranscriptCleaningSchema>;

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
    @Inject(TranscriptCleaningService)
    private readonly transcriptCleaning: TranscriptCleaningService,
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
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
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

  /**
   * Фаза D (sub-TZ §8.3) — настройка автозапуска очистки транскрипта.
   * При auto=true новые встречи получают cleaning автоматически после ai.merge.
   * При auto=false — только по ручному `POST .../transcript/clean`.
   */
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
  async listMembers(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
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

  // ─────────────────────────── invitations ──────────────────────────

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
  async listInvitations(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
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

  /**
   * β-9 (2026-05-25) — перевыпуск приглашения: новый linkCode + magicToken,
   * повторная отправка письма (если email указан). Доступ — owner/admin.
   */
  @Post(':id/invitations/:invitationId/resend')
  @RequireSubscription()
  @HttpCode(HttpStatus.OK)
  async resendInvitation(
    @Param('id') id: string,
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const invitation = await this.invitations.resendInvitation(
      id,
      invitationId,
      user.id,
    );
    return { invitation };
  }

  /**
   * β-9 (2026-05-25) — сброс привязки Telegram-бота сотрудника директором
   * (на случай смены телефона/потери доступа). Удаляет все ChannelBinding
   * пользователя для kind='telegram_bot'. Доступ — owner/admin.
   */
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
