import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { RbacModule } from '../rbac/rbac.module';

import { ClonesAdminController } from './clones-admin.controller';
import { ClonesController, MeCloneAccessController } from './clones.controller';
import { ClonesAdminService } from './services/clones-admin.service';
import { ClonesService } from './services/clones.service';

@Global()
@Module({
  imports: [PrismaModule, RbacModule],
  controllers: [ClonesController, ClonesAdminController, MeCloneAccessController],
  providers: [ClonesService, ClonesAdminService],
  exports: [ClonesService, ClonesAdminService],
})
export class ClonesModule {}
