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

/**
 * SBA α-9 wave 3 — Company Foundation module.
 *
 * Объединяет сервисы и контроллеры для:
 *   - CompanyProfile (1:1 на Org — единая запись идентичности компании)
 *   - FunctionalDomain (функциональная иерархия + seed-templates)
 *   - DepartmentDomainLink (m:n связь Department ↔ Domain)
 *   - MaturityScorer (расчёт зрелости Role/Department/Company)
 *
 * Worker'ы:
 *   - CompanyProfileBuilderCron — lazy-create CompanyProfile для всех Org.
 *   - DepartmentDetectorCron    — auto-link Entity{type=org_unit} → Department.
 *   - DomainExpanderCron        — auto-create FunctionalDomain из кластеров тем.
 *   - MaturityScorerCron        — суточный пересчёт зрелости.
 *
 * Зависимости (через @Global): PrismaModule, RbacModule, AuthModule, AuditModule,
 * MetricsModule, RedisModule, ScheduleModule.
 */
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
