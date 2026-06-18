import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { OrgMembersController } from './org-members.controller';
import { OrgMembersService } from './services/org-members.service';

@Module({
  imports: [PrismaModule],
  controllers: [OrgMembersController],
  providers: [OrgMembersService],
  exports: [OrgMembersService],
})
export class OrgMembersModule {}
