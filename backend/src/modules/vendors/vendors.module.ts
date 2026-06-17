import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { VendorsService } from './services/vendors.service';
import { VendorsController } from './vendors.controller';

@Module({
  imports: [PrismaModule],
  controllers: [VendorsController],
  providers: [VendorsService],
  exports: [VendorsService],
})
export class VendorsModule {}
