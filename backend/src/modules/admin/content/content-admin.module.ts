import { Module } from '@nestjs/common';

import { CopyStringsAdminController } from './copy-strings/copy-strings-admin.controller';
import { CopyStringsAdminService } from './copy-strings/copy-strings-admin.service';
import { EmailTemplatesAdminController } from './email-templates/email-templates-admin.controller';
import { EmailTemplatesAdminService } from './email-templates/email-templates-admin.service';
import { GlobalChannelsAdminController } from './global-channels/global-channels-admin.controller';
import { GlobalChannelsAdminService } from './global-channels/global-channels-admin.service';
import { MeetingTypesAdminController } from './meeting-types/meeting-types-admin.controller';
import { MeetingTypesAdminService } from './meeting-types/meeting-types-admin.service';
import { SystemMessagesAdminController } from './system-messages/system-messages-admin.controller';
import { SystemMessagesAdminService } from './system-messages/system-messages-admin.service';

@Module({
  controllers: [
    MeetingTypesAdminController,
    EmailTemplatesAdminController,
    SystemMessagesAdminController,
    GlobalChannelsAdminController,
    CopyStringsAdminController,
  ],
  providers: [
    MeetingTypesAdminService,
    EmailTemplatesAdminService,
    SystemMessagesAdminService,
    GlobalChannelsAdminService,
    CopyStringsAdminService,
  ],
  exports: [
    MeetingTypesAdminService,
    EmailTemplatesAdminService,
    SystemMessagesAdminService,
    GlobalChannelsAdminService,
    CopyStringsAdminService,
  ],
})
export class ContentAdminModule {}
