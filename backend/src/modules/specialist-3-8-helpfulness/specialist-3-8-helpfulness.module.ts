import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { ProbeModule } from '../probe/probe.module';
import { RbacModule } from '../rbac/rbac.module';

import { HelpfulnessAdminController } from './controllers/helpfulness-admin.controller';
import { HelpfulnessController } from './controllers/helpfulness.controller';
import { HelpfulnessProbeCron } from './cron/helpfulness-probe.cron';
import { HelpfulnessSpotlightCron } from './cron/helpfulness-spotlight.cron';
import { HelpfulnessTraitDecayCron } from './cron/helpfulness-trait-decay.cron';
import { SocialContributionProfileCron } from './cron/social-contribution-profile.cron';
import { HelpfulnessApiService } from './services/helpfulness-api.service';
import { SocialContributionPreferenceService } from './services/social-contribution-preference.service';
import { Specialist38HelpfulnessService } from './services/specialist-3-8-helpfulness.service';
import { Specialist38ProbeService } from './services/specialist-3-8-probe.service';
import { Specialist38HelpfulnessWorker } from './workers/specialist-3-8-helpfulness.worker';

@Global()
@Module({
  imports: [PrismaModule, ProbeModule, RbacModule],
  controllers: [HelpfulnessController, HelpfulnessAdminController],
  providers: [
    Specialist38HelpfulnessService,
    Specialist38ProbeService,
    HelpfulnessApiService,
    SocialContributionPreferenceService,
    Specialist38HelpfulnessWorker,
    SocialContributionProfileCron,
    HelpfulnessSpotlightCron,
    HelpfulnessTraitDecayCron,
    HelpfulnessProbeCron,
  ],
  exports: [
    Specialist38HelpfulnessService,
    Specialist38ProbeService,
    HelpfulnessApiService,
    Specialist38HelpfulnessWorker,
  ],
})
export class Specialist38HelpfulnessModule {}
