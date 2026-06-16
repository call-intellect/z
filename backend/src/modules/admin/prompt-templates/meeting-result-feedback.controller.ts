import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';

import { AiResultFeedbackService } from './ai-result-feedback.service';
import { CreateFeedbackSchema, type CreateFeedbackDto } from './dto/ai-result-feedback.dto';

@ApiExcludeController()
@Controller('api/v1/meetings/:meetingId/result/feedback')
@UseGuards(CookieAuthGuard)
export class MeetingResultFeedbackController {
  constructor(
    @Inject(AiResultFeedbackService)
    private readonly svc: AiResultFeedbackService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('me')
  async getOwn(
    @Param('meetingId') meetingId: string,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    const userId = this.assertUser(user);
    await this.assertCanAccessMeeting(meetingId, userId);
    const fb = await this.svc.getOwn({ meetingId, userId });
    return { feedback: fb };
  }

  @Post()
  async create(
    @Param('meetingId') meetingId: string,
    @Body(new ZodValidationPipe(CreateFeedbackSchema)) dto: CreateFeedbackDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    const userId = this.assertUser(user);
    await this.assertCanAccessMeeting(meetingId, userId);
    const feedback = await this.svc.upsert({ meetingId, userId, dto });
    return { feedback };
  }

  @Delete('me')
  async remove(
    @Param('meetingId') meetingId: string,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    const userId = this.assertUser(user);
    await this.assertCanAccessMeeting(meetingId, userId);
    return this.svc.deleteOwn({ meetingId, userId });
  }

  private assertUser(user: CurrentUserPayload | null | undefined): string {
    if (!user || !user.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_user_context' },
      });
    }
    return user.id;
  }

  private async assertCanAccessMeeting(meetingId: string, userId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { id: true, ownerId: true, tenantId: true },
    });
    if (!meeting) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'meeting_not_found', meetingId },
      });
    }
    if (meeting.ownerId === userId) return;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });
    if (user?.isSuperAdmin) return;

    if (meeting.tenantId) {
      const membership = await this.prisma.membership.findUnique({
        where: { orgId_userId: { orgId: meeting.tenantId, userId } },
        select: { role: true },
      });
      if (membership) return;
    }

    const participant = await this.prisma.participant.findFirst({
      where: { meetingId, userId },
      select: { id: true },
    });
    if (participant) return;

    throw new BadRequestException({
      ok: false,
      error: { code: 'no_access_to_meeting', meetingId },
    });
  }
}
