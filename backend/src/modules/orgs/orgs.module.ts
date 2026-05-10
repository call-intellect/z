import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { MailModule } from '../mail/mail.module';

import {
  OrgInvitationsAcceptController,
  OrgsController,
} from './orgs.controller';
import { OrgInvitationsService } from './org-invitations.service';
import { OrgsService } from './orgs.service';

/**
 * Org / Membership / Invitation module (Фаза 0 knowledge-core).
 *
 * RbacModule (глобальный) предоставляет RbacService, который тут используется
 * во всех сервисах для проверки прав.
 *
 * AccountsService (хук в register) импортирует OrgsService напрямую через
 * forwardRef если нужно (см. accounts.module.ts).
 */
@Module({
  imports: [PrismaModule, MailModule],
  controllers: [OrgsController, OrgInvitationsAcceptController],
  providers: [OrgsService, OrgInvitationsService],
  exports: [OrgsService, OrgInvitationsService],
})
export class OrgsModule {}
