import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { AddAgentSchema, type AddAgentDto } from '../dto/add-agent.dto';
import { ContourSeedSchema, type ContourSeedDto } from '../dto/contour-seed.dto';
import { SupportAdminGuard } from '../guards/support-admin.guard';
import { SupportContourService } from '../services/support-contour.service';

@ApiTags('support / admin')
@ApiBearerAuth()
@Controller('api/v1/support/admin')
@UseGuards(CookieAuthGuard, SupportAdminGuard)
export class SupportAdminController {
  constructor(
    @Inject(SupportContourService)
    private readonly contour: SupportContourService,
  ) {}

  @Get('agents')
  @ApiOperation({ summary: 'Сотрудники поддержки (члены контура)' })
  async listAgents(): Promise<{
    members: { personId: string; name: string }[];
  }> {
    return this.contour.listAgents();
  }

  @Post('agents')
  @HttpCode(200)
  @ApiOperation({ summary: 'Выдать галочку «сотрудник поддержки»' })
  async addAgent(
    @Body(new ZodValidationPipe(AddAgentSchema)) body: AddAgentDto,
  ): Promise<{ ok: true; added: boolean }> {
    return this.contour.addAgent(body.personId);
  }

  @Delete('agents/:personId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Снять галочку «сотрудник поддержки»' })
  async removeAgent(@Param('personId') personId: string): Promise<void> {
    await this.contour.removeAgent(personId);
  }

  @Post('contour/seed')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ручной засев контура поддержки (Р-4)' })
  async seed(
    @Body(new ZodValidationPipe(ContourSeedSchema)) body: ContourSeedDto,
  ): Promise<{ created: number; skipped: number }> {
    return this.contour.seedContour(body.items);
  }
}
