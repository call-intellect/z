import { Body, Controller, HttpCode, HttpStatus, Ip, Headers, Inject, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PublicAttributionBodySchema, type PublicAttributionBody } from '../dto/referrals.dto';
import { AttributionService } from '../services/attribution.service';

@ApiTags('public-referrals')
@Controller('api/v1/public/referrals')
export class PublicReferralsController {
  constructor(@Inject(AttributionService) private readonly attribution: AttributionService) {}

  @Post('attribution')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Beacon от лендинга: зафиксировать касание (slug+fingerprint+referer).',
    description: 'Public-эндпоинт. Rate-limit 10/мин/IP. Не возвращает ничего (204).',
  })
  async record(
    @Body(new ZodValidationPipe(PublicAttributionBodySchema))
    body: PublicAttributionBody,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<void> {
    await this.attribution.record({
      slug: body.slug,
      fingerprint: body.fingerprint ?? null,
      referer: body.referer ?? null,
      ip,
      userAgent: userAgent ?? null,
    });
  }
}
