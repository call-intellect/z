import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { ChatV2Module } from '../chat-v2/chat-v2.module';

import { Specialist34CardHandler } from './services/specialist-3-4-card-handler.service';

/**
 * SBA α-6 — модуль регистрации специалиста 3.4 в `CardSpecialistRegistry`.
 *
 * Вынесен отдельно от `KnowledgeCoreModule`, чтобы не создавать зависимости
 * KnowledgeCoreModule → ChatV2Module (циклы по make-compile ловятся, но
 * концептуально KnowledgeCoreModule — фундаментный слой, ChatV2Module — выше).
 *
 * Содержит только `Specialist34CardHandler`, который в `onModuleInit`
 * вызывает `cardSpecialistRegistry.register('3-4-project-customer', this)`.
 *
 * Регистрируется в `AppModule` ПОСЛЕ `ChatV2Module` (где живёт
 * CardSpecialistRegistry).
 */
@Module({
  imports: [PrismaModule, ChatV2Module],
  providers: [Specialist34CardHandler],
  exports: [Specialist34CardHandler],
})
export class Specialist34Module {}
