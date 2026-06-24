import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { ConfigModule } from './common/config/index';
import { CryptoModule } from './common/crypto/crypto.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { GraphModule } from './common/graph/graph.module';
import { DemoObserverGuard } from './common/guards/demo-observer.guard';
import { IdempotencyMiddleware } from './common/idempotency/idempotency.middleware';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { MetricsModule } from './common/metrics/metrics.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { ActivityFeedModule } from './modules/activity-feed/activity-feed.module';
import { AdminModule } from './modules/admin/admin.module';
import { AiModule } from './modules/ai/ai.module';
import { WorkersModule } from './modules/ai/workers.module';
import { AiChatQuotaModule } from './modules/ai-chat-quota/ai-chat-quota.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { MustChangePasswordGuard } from './modules/auth/guards/must-change-password.guard';
import { BehaviorMetricsModule } from './modules/behavior-metrics/behavior-metrics.module';
import { BillingModule } from './modules/billing/billing.module';
import { SubscriptionGuard } from './modules/billing/guards/subscription.guard';
import { BitrixModule } from './modules/bitrix/bitrix.module';
import { BrandVoiceModule } from './modules/brand-voice/brand-voice.module';
import { CardsModule } from './modules/cards/cards.module';
import { ChaptersModule } from './modules/chapters/chapters.module';
import { ChatModule } from './modules/chat/chat.module';
import { ChatV2Module } from './modules/chat-v2/chat-v2.module';
import { ChatboxModule } from './modules/chatbox/chatbox.module';
import { ClonesModule } from './modules/clones/clones.module';
import { CompanyFoundationModule } from './modules/company-foundation/company-foundation.module';
import { ConciergeModule } from './modules/concierge/concierge.module';
import { ConversationalModule } from './modules/conversational/conversational.module';
import { CoreQueueModule } from './modules/core-queue/core-queue.module';
import { CurationModule } from './modules/curation/curation.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DecisionsModule } from './modules/decisions/decisions.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { DestinationsModule } from './modules/destinations/destinations.module';
import { DialogLayerModule } from './modules/dialog-layer/dialog-layer.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { EntitlementGuard } from './modules/entitlements/entitlement.guard';
import { EntitlementsModule } from './modules/entitlements/entitlements.module';
import { EventsModule } from './modules/events/events.module';
import { ExperimentsModule } from './modules/experiments/experiments.module';
import { ExportsModule } from './modules/exports/exports.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { GoalsModule } from './modules/goals/goals.module';
import { HealthModule } from './modules/health/health.module';
import { HighlightsModule } from './modules/highlights/highlights.module';
import { IdeasModule } from './modules/ideas/ideas.module';
import { IngestEmailModule } from './modules/ingest/adapters/email/ingest-email.module';
import { IngestModule } from './modules/ingest/ingest.module';
import { InnLookupModule } from './modules/inn-lookup/inn-lookup.module';
import { InsightsModule } from './modules/insights/insights.module';
import { CrossmarkModule } from './modules/integrations-crossmark/crossmark.module';
import { JobDescriptionsModule } from './modules/job-descriptions/job-descriptions.module';
import { KnowledgeAccessModule } from './modules/knowledge-access/knowledge-access.module';
import { KnowledgeCloneModule } from './modules/knowledge-clone/knowledge-clone.module';
import { KnowledgeCoreApiModule } from './modules/knowledge-core/knowledge-core-api.module';
import { KnowledgeCoreModule } from './modules/knowledge-core/knowledge-core.module';
import { Specialist31Module } from './modules/knowledge-core/specialist-3-1.module';
import { Specialist32Module } from './modules/knowledge-core/specialist-3-2.module';
import { Specialist33Module } from './modules/knowledge-core/specialist-3-3.module';
import { Specialist34Module } from './modules/knowledge-core/specialist-3-4.module';
import { Specialist35Module } from './modules/knowledge-core/specialist-3-5.module';
import { Specialist36Module } from './modules/knowledge-core/specialist-3-6.module';
import { KpiModule } from './modules/kpi/kpi.module';
import { LivekitModule } from './modules/livekit/livekit.module';
import { LoggingModule } from './modules/logging/logging.module';
import { RequestContextMiddleware } from './modules/logging/request-context.middleware';
import { MailInboundModule } from './modules/mail/inbound/mail-inbound.module';
import { MailModule } from './modules/mail/mail.module';
import { MeModule } from './modules/me/me.module';
import { MeetingReportsModule } from './modules/meeting-reports/meeting-reports.module';
import { MeetingUploadsModule } from './modules/meeting-uploads/meeting-uploads.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { MeetingsBalanceModule } from './modules/meetings-balance/meetings-balance.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { OperationsModule } from './modules/operations/operations.module';
import { OrchestratorModule } from './modules/orchestrator/orchestrator.module';
import { OrgMembersModule } from './modules/org-members/org-members.module';
import { OrgsModule } from './modules/orgs/orgs.module';
import { ParticipantsModule } from './modules/participants/participants.module';
import { PendingActionsModule } from './modules/pending-actions/pending-actions.module';
import { PersonsModule } from './modules/persons/persons.module';
import { PracticeSkillsModule } from './modules/practice-skills/practice-skills.module';
import { ProactiveModule } from './modules/proactive/proactive.module';
import { ProbeModule } from './modules/probe/probe.module';
import { ProcessesModule } from './modules/processes/processes.module';
import { PromptEvolutionModule } from './modules/prompt-evolution/prompt-evolution.module';
import { PublicApiModule } from './modules/public-api/public-api.module';
import { PushModule } from './modules/push/push.module';
import { QualityScoreModule } from './modules/quality-score/quality-score.module';
import { QuotasModule } from './modules/quotas/quotas.module';
import { TenantMiddleware } from './modules/rbac/middleware/tenant.middleware';
import { RbacModule } from './modules/rbac/rbac.module';
import { RecognitionModule } from './modules/recognition/recognition.module';
import { RecordingsModule } from './modules/recordings/recordings.module';
import { ReferralsModule } from './modules/referrals/referrals.module';
import { RegulationsModule } from './modules/regulations/regulations.module';
import { RetentionModule } from './modules/retention/retention.module';
import { RoleMapModule } from './modules/role-map/role-map.module';
import { RoleProfilesAgentModule } from './modules/role-profiles/role-profiles-agent.module';
import { RoleProfilesModule } from './modules/role-profiles/role-profiles.module';
import { RolesDomainModule } from './modules/roles-domain/roles-domain.module';
import { RoomMessagesModule } from './modules/room-messages/room-messages.module';
import { SearchModule } from './modules/search/search.module';
import { SecurityModule } from './modules/security/security.module';
import { SharesModule } from './modules/shares/shares.module';
import { SkillsModule } from './modules/skills/skills.module';
import { SourcesModule } from './modules/sources/sources.module';
import { Specialist38HelpfulnessModule } from './modules/specialist-3-8-helpfulness/specialist-3-8-helpfulness.module';
import { StructureModule } from './modules/structure/structure.module';
import { SupportModule } from './modules/support/support.module';
import { TablesModule } from './modules/tables/tables.module';
import { TagsModule } from './modules/tags/tags.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { TrackerModule } from './modules/tracker/tracker.module';
import { UsersModule } from './modules/users/users.module';
import { CustomersModule } from './modules/customers/customers.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { VoiceModule } from './modules/voice/voice.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { WebhooksOutModule } from './modules/webhooks-out/webhooks-out.module';

@Module({
  imports: [
    ConfigModule,

    MetricsModule,

    ScheduleModule.forRoot(),

    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 32,
      verboseMemoryLeak: false,
    }),

    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 120,
      },
    ]),

    PrismaModule,
    RedisModule,

    IdempotencyModule,

    GraphModule,

    CryptoModule,

    UsersModule,

    AuthModule,

    RbacModule,

    LivekitModule,

    CoreQueueModule,

    IngestModule,

    AiModule,

    KnowledgeCoreModule,
    KnowledgeCoreApiModule,
    KnowledgeAccessModule,

    HealthModule,
    MeetingsBalanceModule,
    MeetingsModule,
    ParticipantsModule,
    RecordingsModule,
    WebhooksModule,
    RetentionModule,
    MeetingUploadsModule,

    AdminModule,
    CrossmarkModule,

    MailModule,
    OrgsModule,
    AccountsModule,
    OnboardingModule,

    SecurityModule,
    AuditModule,
    EntitlementsModule,
    QuotasModule,
    AiChatQuotaModule,
    ApiKeysModule,
    WebhooksOutModule,
    DestinationsModule,
    ExportsModule,
    ChatModule,
    PublicApiModule,

    TasksModule,
    ChaptersModule,
    HighlightsModule,
    SharesModule,
    TagsModule,
    TemplatesModule,

    TrackerModule,

    MailInboundModule,

    CardsModule,

    BehaviorMetricsModule,

    QualityScoreModule,

    MeetingReportsModule,

    DocumentsModule,

    SearchModule,

    RoomMessagesModule,

    DashboardModule,

    GoalsModule,

    IngestEmailModule,

    SourcesModule,

    ChatboxModule,

    BitrixModule,

    SupportModule,

    WorkersModule,

    RoleProfilesAgentModule,

    RoleMapModule,

    DepartmentsModule,
    RolesDomainModule,
    PersonsModule,
    AppointmentsModule,
    KpiModule,
    JobDescriptionsModule,
    SkillsModule,
    RoleProfilesModule,

    StructureModule,

    CompanyFoundationModule,

    MeModule,

    ConversationalModule,

    VendorsModule,
    CustomersModule,
    EventsModule,
    OrgMembersModule,

    CurationModule,

    PendingActionsModule,

    DialogLayerModule,

    ChatV2Module,

    Specialist34Module,

    Specialist31Module,

    RegulationsModule,

    ProcessesModule,

    Specialist32Module,

    Specialist33Module,

    DecisionsModule,

    Specialist35Module,

    InsightsModule,

    InnLookupModule,

    BillingModule,

    ReferralsModule,

    ActivityFeedModule,

    ExperimentsModule,

    ProbeModule,

    Specialist36Module,

    IdeasModule,

    Specialist38HelpfulnessModule,

    RecognitionModule,

    PushModule,

    KnowledgeCloneModule,

    ClonesModule,

    BrandVoiceModule,

    ConciergeModule,

    VoiceModule,

    OperationsModule,

    OrchestratorModule,

    ProactiveModule,

    FeedbackModule,

    PromptEvolutionModule,

    PracticeSkillsModule,

    TablesModule,

    LoggingModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_GUARD,
      useClass: SubscriptionGuard,
    },
    {
      provide: APP_GUARD,
      useClass: EntitlementGuard,
    },
    {
      provide: APP_GUARD,
      useClass: MustChangePasswordGuard,
    },
    {
      provide: APP_GUARD,
      useClass: DemoObserverGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');

    consumer.apply(RequestContextMiddleware).forRoutes('{*path}');

    consumer.apply(TenantMiddleware).forRoutes('api/v1/{*path}');

    consumer
      .apply(IdempotencyMiddleware)
      .forRoutes(
        { path: 'api/v1/projects/:projectId/issues', method: RequestMethod.POST },
        { path: 'api/v1/issues/:id/comments', method: RequestMethod.POST },
        { path: 'api/v1/intake', method: RequestMethod.POST },
        { path: 'api/v1/sprints/quick-create', method: RequestMethod.POST },
      );
  }
}
