import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Inject,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  PatchDocumentUseCasesSchema,
  type PatchDocumentUseCasesDto,
  type PatchDocumentUseCasesResponseDto,
} from '../dto/document-use-cases.dto';
import { BrandVoiceService } from '../services/brand-voice.service';

@ApiTags('documents')
@Controller('api/v1/documents')
@UseGuards(CookieAuthGuard, TenantGuard)
export class DocumentUseCasesController {
  constructor(
    @Inject(BrandVoiceService) private readonly svc: BrandVoiceService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Patch(':id/use-cases')
  @ApiOperation({
    summary:
      'Обновить набор use-case-меток у документа (admin). Open enum: use_in_process | use_for_generation | reference | brand_corpus.',
  })
  async patch(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PatchDocumentUseCasesSchema))
    body: PatchDocumentUseCasesDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PatchDocumentUseCasesResponseDto> {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const ok = await this.rbac.canWrite(user.id, tenantId, 'document');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Управлять use-case-метками документов могут только владелец/администратор',
        },
      });
    }
    try {
      const updated = await this.svc.updateDocumentUseCases({
        tenantId,
        userId: user.id,
        documentId: id,
        useCases: body.useCases,
      });
      return {
        id: updated.id,
        useCases: updated.useCases,
        updatedAt: updated.updatedAt.toISOString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('не найден')) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'document_not_found', message },
        });
      }
      if (message.includes('другой Org')) {
        throw new ForbiddenException({
          ok: false,
          error: { code: 'foreign_tenant', message },
        });
      }
      throw err;
    }
  }
}
