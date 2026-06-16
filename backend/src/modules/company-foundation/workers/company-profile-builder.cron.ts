import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CompanyProfileService } from '../services/company-profile.service';

@Injectable()
export class CompanyProfileBuilderCron {
  private readonly logger = new Logger(CompanyProfileBuilderCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CompanyProfileService)
    private readonly svc: CompanyProfileService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron('15 * * * *')
  async run(): Promise<void> {
    try {
      const orgs = await this.prisma.org.findMany({ select: { id: true } });
      let lazyCreated = 0;
      for (const org of orgs) {
        const before = await this.svc.getRaw(org.id);
        await this.svc.getOrCreate(org.id);
        if (!before) lazyCreated++;
      }
      if (lazyCreated > 0) {
        this.logger.debug(
          { orgsScanned: orgs.length, lazyCreated },
          'company-profile-builder.cron: проход завершён',
        );
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'company-profile-builder.cron: непойманная ошибка',
      );
    }
  }
}
