import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/typed-config.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class AdminSettingsBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminSettingsBootstrapService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const rows = await this.prisma.adminSetting.findMany({
        select: { key: true, value: true },
      });
      this.cfg.hydrateSync(rows.map((r) => [r.key, r.value]));
      this.logger.log(`AdminSettings: hydrated ${rows.length} keys into TypedConfigService cache`);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'AdminSettings: bootstrap hydrate failed, продолжаем с пустым cacheMap',
      );
    }
  }
}
