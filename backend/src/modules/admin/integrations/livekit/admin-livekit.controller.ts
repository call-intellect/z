import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../../super-admin.audit.interceptor';

import { AdminLiveKitService } from './admin-livekit.service';
import {
  SwitchTurnModeSchema,
  type SwitchTurnModeDto,
} from './dto/admin-livekit.dto';

/**
 * Admin-redesign Фаза 6 — `AdminLiveKitController`.
 *
 * UI Z-Admin `/admin/integrations/livekit` — снимки health для SFU / Egress /
 * TURN + переключение turn_mode без рестарта.
 *
 * Все эндпоинты — `CookieAuthGuard + SuperAdminGuard` и
 * `SuperAdminAuditInterceptor`.
 */
@ApiTags('admin-integrations-livekit')
@Controller('api/v1/admin/integrations/livekit')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminLiveKitController {
  constructor(
    @Inject(AdminLiveKitService) private readonly svc: AdminLiveKitService,
  ) {}

  @Get('sfu')
  @ApiOperation({
    summary:
      'SFU health: число активных rooms + суммарно participants. Использует RoomServiceClient.listRooms().',
  })
  getSfu() {
    return this.svc.getSfu();
  }

  @Get('egress')
  @ApiOperation({
    summary:
      'Активные egress-задачи (EgressClient.listEgress({active: true})).',
  })
  getEgress() {
    return this.svc.getEgress();
  }

  @Get('turn')
  @ApiOperation({
    summary: 'Текущая ENV-конфигурация TURN + динамический override.',
  })
  getTurn() {
    return this.svc.getTurn();
  }

  @Post('switch-mode')
  @ApiOperation({
    summary:
      'Переключить TURN-mode на builtin/external через AdminSetting livekit.turn_mode (severity=high audit).',
  })
  switchTurnMode(
    @Body(new ZodValidationPipe(SwitchTurnModeSchema)) dto: SwitchTurnModeDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.switchTurnMode({
      mode: dto.mode,
      ...(dto.reason ? { reason: dto.reason } : {}),
      userId: user?.id ?? null,
    });
  }
}
