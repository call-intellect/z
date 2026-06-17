export interface IntegrationEmailToTaskDto {
  enabled: boolean;
  alias: string | null;
}

export interface IntegrationTelegramSubscriptionDto {
  isActive: boolean;
  telegramLinked: boolean;
}

export interface IntegrationLastImportDto {
  source: string;
  completedAt: string;
}

export interface IntegrationsStatusResponseDto {
  emailToTask: IntegrationEmailToTaskDto;
  telegramSubscription: IntegrationTelegramSubscriptionDto;
  webhooksCount: number;
  lastImport: IntegrationLastImportDto | null;
}
