import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { OrgMembersController } from './org-members.controller';
import { OrgMembersService } from './services/org-members.service';

/**
 * OrgMembersModule (Calendar MVP Фаза P4, 2026-05-25).
 *
 * Объединённый поиск по «членам Org» (User + Person) для ParticipantPicker
 * в EventForm. RbacModule / AuthModule — глобальные, не импортируем явно.
 */
@Module({
  imports: [PrismaModule],
  controllers: [OrgMembersController],
  providers: [OrgMembersService],
  exports: [OrgMembersService],
})
export class OrgMembersModule {}
