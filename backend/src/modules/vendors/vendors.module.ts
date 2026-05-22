import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { VendorsService } from './services/vendors.service';
import { VendorsController } from './vendors.controller';

/**
 * VendorsModule (SBA α-3 — категория A онтологии).
 *
 * REST API поставщиков: `/api/v1/vendors` (read-only на α-3).
 * Полный CRUD появится в α-6 вместе со Specialist 3-4 (project-customer).
 *
 * Vendor связан 1:1 с Entity{type=vendor} через `Vendor.entityId`. На α-3
 * запись Vendor создаётся вручную через `EntityResolutionService.findOrCreateVendorEntity`
 * (например, из block-ingest при упоминании поставщика). Внешнее API создания
 * (POST /api/v1/vendors) — в α-6.
 */
@Module({
  imports: [PrismaModule],
  controllers: [VendorsController],
  providers: [VendorsService],
  exports: [VendorsService],
})
export class VendorsModule {}
