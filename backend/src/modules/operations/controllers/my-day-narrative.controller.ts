import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import {
  DayLetterQuerySchema,
  emptyPersonalDayNarrativeDto,
  type DayLetterQuery,
  type PersonalDayNarrativeDto,
} from '../dto/personal-day-narrative.dto';
import { PersonalDayNarrativeService } from '../services/personal-day-narrative.service';
import { SelfPersonResolverService } from '../services/self-person-resolver.service';
import { yesterdayLocalDate } from '../utils/local-date';

@ApiTags('me-day-letter')
@Controller('api/v1/me')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MyDayNarrativeController {
  constructor(
    @Inject(SelfPersonResolverService)
    private readonly selfPerson: SelfPersonResolverService,
    @Inject(PersonalDayNarrativeService)
    private readonly narratives: PersonalDayNarrativeService,
  ) {}

  @Get('day-letter')
  @ApiOperation({ summary: 'Моё вечернее письмо-отчёт «Твой день» (self-scope)' })
  async getDayLetter(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(DayLetterQuerySchema)) q: DayLetterQuery,
  ): Promise<PersonalDayNarrativeDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    const dateLocal = q.date ?? yesterdayLocalDate(new Date(), 'Europe/Moscow');

    const personId = await this.resolveSelfPersonId(tenantId!, uid);
    if (!personId) return emptyPersonalDayNarrativeDto(dateLocal);

    return this.narratives.getForPerson({ tenantId: tenantId!, personId, dateLocal });
  }

  @Post('day-letter/:id/opened')
  @ApiOperation({ summary: 'Отметить письмо открытым (self-scope, проверка владения)' })
  async markOpened(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    if (!id || id.length === 0) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'id_required', message: 'Не передан id письма' },
      });
    }

    const personId = await this.resolveSelfPersonId(tenantId!, uid);
    if (!personId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'not_found', message: 'Письмо не найдено' },
      });
    }

    const ok = await this.narratives.markOpened({ tenantId: tenantId!, personId, id });
    if (!ok) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'not_found', message: 'Письмо не найдено' },
      });
    }
    return { ok: true };
  }

  private async resolveSelfPersonId(tenantId: string, userId: string): Promise<string | null> {
    try {
      const person = await this.selfPerson.resolveSelfPerson({ tenantId, userId });
      return person.id;
    } catch (err) {
      if (err instanceof ForbiddenException && this.isNoPersonError(err)) {
        return null;
      }
      throw err;
    }
  }

  private isNoPersonError(err: ForbiddenException): boolean {
    const response = err.getResponse();
    return (
      typeof response === 'object' &&
      response !== null &&
      (response as { error?: { code?: string } }).error?.code === 'no_person'
    );
  }

  private requireUser(req: Request): string {
    const uid = req.user?.id;
    if (!uid) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'no_user', message: 'Требуется авторизация' },
      });
    }
    return uid;
  }

  private requireTenant(tenantId: string | undefined): void {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Не передан tenantId' },
      });
    }
  }
}
