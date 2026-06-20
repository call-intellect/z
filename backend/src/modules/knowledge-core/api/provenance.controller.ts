import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Optional,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { TypedConfigService } from '../../../common/config/index';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import {
  ProvenanceService,
  type ProvenanceEntityType,
  type ProvenanceNode,
} from '../services/provenance.service';

import { ProvenanceEntityTypeSchema, type ProvenanceResponse } from './dto/provenance.dto';

const DEFAULT_CONFIDENCE_REVIEW_THRESHOLD = 0.6;

@ApiTags('knowledge-core')
@Controller('api/v1/provenance')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ProvenanceController {
  constructor(
    @Inject(ProvenanceService) private readonly provenance: ProvenanceService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService | null = null,
  ) {}

  @Get(':entityType/:entityId')
  @ApiOperation({ summary: 'Провенанс сущности — источники, цитаты, deep-link' })
  async resolve(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProvenanceResponse> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const parsed = ProvenanceEntityTypeSchema.safeParse(entityType);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'invalid_entity_type' });
    }
    const type: ProvenanceEntityType = parsed.data;

    const resolved = await this.provenance.resolve(type, entityId, {
      tenantId,
      userId: user.id,
    });

    const threshold =
      (await this.cfg?.getDynamic<number>(
        'provenance.confidence_review_threshold',
        undefined,
        DEFAULT_CONFIDENCE_REVIEW_THRESHOLD,
      )) ?? DEFAULT_CONFIDENCE_REVIEW_THRESHOLD;

    const nodes: ProvenanceNode[] = resolved.map((n) => ({
      ...n,
      needsReview:
        n.source.type === 'document' &&
        n.confidence !== null &&
        n.confidence < threshold,
    }));

    const meetingRefIds = new Set<string>();
    for (const n of nodes) {
      if (n.source.type === 'meeting' && n.source.refId) {
        meetingRefIds.add(n.source.refId);
      }
    }

    return {
      nodes,
      coverage: {
        blocks: nodes.length,
        meetings: meetingRefIds.size,
      },
    };
  }

  @Get('voice-note/:rawEventId/audio')
  @ApiOperation({
    summary: 'Presigned-ссылка на оригинал голосового сообщения источника',
  })
  async voiceNoteAudio(
    @Param('rawEventId') rawEventId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ url: string; expiresAt: string }> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }

    const result = await this.provenance.resolveVoiceNoteAudioUrl(rawEventId, {
      tenantId,
      userId: user.id,
    });

    if (result.status === 'not_found') {
      throw new NotFoundException({ code: 'voice_note_audio_not_found' });
    }
    if (result.status === 'forbidden') {
      throw new ForbiddenException({ code: 'voice_note_audio_forbidden' });
    }

    return { url: result.url, expiresAt: result.expiresAt.toISOString() };
  }
}
