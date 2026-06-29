import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { PasswordModule } from '../accounts/password.module';
import { BillingModule } from '../billing/billing.module';
import { ConversationalLinkCodeService } from '../conversational/link-code.service';
import { MailModule } from '../mail/mail.module';
import { PersonsModule } from '../persons/persons.module';
import { TablesModule } from '../tables/tables.module';

import { CapabilitiesService } from './capabilities.service';
import { OrgInvitationRemindersCron } from './cron/org-invitation-reminders.cron';
import { OrgInvitationsService } from './org-invitations.service';
import { OrgInvitationsAcceptController, OrgsController } from './orgs.controller';
import { OrgsService } from './orgs.service';

@Module({
  imports: [PrismaModule, MailModule, BillingModule, TablesModule, PersonsModule, PasswordModule],
  controllers: [OrgsController, OrgInvitationsAcceptController],
  providers: [
    OrgsService,
    OrgInvitationsService,
    ConversationalLinkCodeService,
    OrgInvitationRemindersCron,
    CapabilitiesService,
  ],
  exports: [OrgsService, OrgInvitationsService, CapabilitiesService],
})
export class OrgsModule {}
