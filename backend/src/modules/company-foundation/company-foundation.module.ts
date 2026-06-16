import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { CompanyController } from './controllers/company.controller';
import { DepartmentDomainsController } from './controllers/department-domains.controller';
import { DomainsController } from './controllers/domains.controller';
import { MaturityController } from './controllers/maturity.controller';
import { CompanyProfileService } from './services/company-profile.service';
import { DepartmentDomainLinkService } from './services/department-domain-link.service';
import { FunctionalDomainService } from './services/functional-domain.service';
import { MaturityScorerService } from './services/maturity-scorer.service';
import { CompanyProfileBuilderCron } from './workers/company-profile-builder.cron';
import { DepartmentDetectorCron } from './workers/department-detector.cron';
import { DomainExpanderCron } from './workers/domain-expander.cron';
import { MaturityScorerCron } from './workers/maturity-scorer.cron';

@Module({
  imports: [PrismaModule],
  controllers: [
    CompanyController,
    DomainsController,
    MaturityController,
    DepartmentDomainsController,
  ],
  providers: [
    CompanyProfileService,
    FunctionalDomainService,
    DepartmentDomainLinkService,
    MaturityScorerService,
    CompanyProfileBuilderCron,
    DepartmentDetectorCron,
    DomainExpanderCron,
    MaturityScorerCron,
  ],
  exports: [
    CompanyProfileService,
    FunctionalDomainService,
    DepartmentDomainLinkService,
    MaturityScorerService,
  ],
})
export class CompanyFoundationModule {}
