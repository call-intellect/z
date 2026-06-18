export type TierKey = 'tier_standard' | 'tier_basic' | 'tier_pro' | 'tier_enterprise';

export type FeatureKey =
  | 'feature.meeting'
  | 'feature.ai_report'
  | 'feature.card_rollup'
  | 'feature.chat_per_meeting'
  | 'feature.theme'
  | 'feature.graph'
  | 'feature.chat_org'
  | 'feature.dashboard_director'
  | 'feature.adapter_telegram'
  | 'feature.adapter_email'
  | 'feature.adapter_call'
  | 'feature.adapter_web_form'
  | 'feature.public_api'
  | 'feature.export_advanced'
  | 'feature.goals_strategy'
  | 'feature.strict_visibility'
  | 'feature.custom_prompt_templates'
  | 'feature.prompt_experiments'
  | 'feature.multi_reports_per_meeting'
  | 'feature.memory_regulations_for_members'
  | 'feature.memory_entities_for_members'
  | 'feature.chatbox'
  | 'feature.bitrix'
  | 'feature.support_desk';

export type QuotaKey =
  | 'blocks_per_org'
  | 'chat_requests_per_day_per_user'
  | 'sources_meeting'
  | 'sources_other'
  | 'ingest_bytes_per_month'
  | 'links_per_day'
  | 'prompt_templates_per_org'
  | 'prompt_experiments_concurrent'
  | 'multi_reports_limit_per_meeting';

export interface TierConfig {
  features: Record<FeatureKey, boolean>;
  quotas: Record<QuotaKey, number>;
}

export const ALL_FEATURES: readonly FeatureKey[] = [
  'feature.meeting',
  'feature.ai_report',
  'feature.card_rollup',
  'feature.chat_per_meeting',
  'feature.theme',
  'feature.graph',
  'feature.chat_org',
  'feature.dashboard_director',
  'feature.adapter_telegram',
  'feature.adapter_email',
  'feature.adapter_call',
  'feature.adapter_web_form',
  'feature.public_api',
  'feature.export_advanced',
  'feature.goals_strategy',
  'feature.strict_visibility',
  'feature.custom_prompt_templates',
  'feature.prompt_experiments',
  'feature.multi_reports_per_meeting',
  'feature.memory_regulations_for_members',
  'feature.memory_entities_for_members',
  'feature.chatbox',
  'feature.bitrix',
  'feature.support_desk',
] as const;

export const ALL_QUOTAS: readonly QuotaKey[] = [
  'blocks_per_org',
  'chat_requests_per_day_per_user',
  'sources_meeting',
  'sources_other',
  'ingest_bytes_per_month',
  'links_per_day',
  'prompt_templates_per_org',
  'prompt_experiments_concurrent',
  'multi_reports_limit_per_meeting',
] as const;

export const ALL_TIERS: readonly TierKey[] = [
  'tier_standard',
  'tier_basic',
  'tier_pro',
  'tier_enterprise',
] as const;

const BASIC_QUOTAS: Record<QuotaKey, number> = {
  blocks_per_org: 5_000,
  chat_requests_per_day_per_user: 30,
  sources_meeting: 10,
  sources_other: 0,
  ingest_bytes_per_month: 100 * 1024 * 1024,
  links_per_day: 1_000,
  prompt_templates_per_org: 0,
  prompt_experiments_concurrent: 0,
  multi_reports_limit_per_meeting: 0,
};

const PRO_QUOTAS: Record<QuotaKey, number> = {
  blocks_per_org: 50_000,
  chat_requests_per_day_per_user: 300,
  sources_meeting: 100,
  sources_other: 50,
  ingest_bytes_per_month: 1024 * 1024 * 1024,
  links_per_day: 10_000,
  prompt_templates_per_org: 10,
  prompt_experiments_concurrent: 3,
  multi_reports_limit_per_meeting: 5,
};

const ENTERPRISE_QUOTAS: Record<QuotaKey, number> = {
  blocks_per_org: 500_000,
  chat_requests_per_day_per_user: 3_000,
  sources_meeting: 1_000,
  sources_other: 500,
  ingest_bytes_per_month: 10 * 1024 * 1024 * 1024,
  links_per_day: 100_000,
  prompt_templates_per_org: 50,
  prompt_experiments_concurrent: 3,
  multi_reports_limit_per_meeting: 100,
};

const BASIC_FEATURES: Record<FeatureKey, boolean> = {
  'feature.meeting': true,
  'feature.ai_report': true,
  'feature.card_rollup': true,
  'feature.chat_per_meeting': true,
  'feature.adapter_web_form': true,
  'feature.chatbox': true,
  'feature.bitrix': true,
  'feature.theme': false,
  'feature.graph': false,
  'feature.chat_org': false,
  'feature.dashboard_director': false,
  'feature.adapter_telegram': false,
  'feature.adapter_email': false,
  'feature.adapter_call': false,
  'feature.public_api': false,
  'feature.export_advanced': false,
  'feature.goals_strategy': false,
  'feature.strict_visibility': false,
  'feature.custom_prompt_templates': false,
  'feature.prompt_experiments': false,
  'feature.multi_reports_per_meeting': false,
  'feature.memory_regulations_for_members': false,
  'feature.memory_entities_for_members': false,
  'feature.support_desk': false,
};

const PRO_FEATURES: Record<FeatureKey, boolean> = {
  ...BASIC_FEATURES,
  'feature.theme': true,
  'feature.graph': true,
  'feature.chat_org': true,
  'feature.dashboard_director': true,
  'feature.adapter_telegram': true,
  'feature.adapter_email': true,
  'feature.adapter_call': true,
  'feature.public_api': true,
  'feature.export_advanced': true,
  'feature.custom_prompt_templates': true,
  'feature.prompt_experiments': true,
  'feature.multi_reports_per_meeting': true,
};

const ENTERPRISE_FEATURES: Record<FeatureKey, boolean> = {
  ...PRO_FEATURES,
  'feature.goals_strategy': true,
  'feature.strict_visibility': true,
};

const STANDARD_FEATURES: Record<FeatureKey, boolean> = {
  ...ENTERPRISE_FEATURES,
  'feature.memory_regulations_for_members': false,
  'feature.memory_entities_for_members': false,
};

const STANDARD_QUOTAS: Record<QuotaKey, number> = {
  ...ENTERPRISE_QUOTAS,
};

export const TIER_CONFIG: Record<TierKey, TierConfig> = {
  tier_standard: {
    features: STANDARD_FEATURES,
    quotas: STANDARD_QUOTAS,
  },
  tier_basic: {
    features: BASIC_FEATURES,
    quotas: BASIC_QUOTAS,
  },
  tier_pro: {
    features: PRO_FEATURES,
    quotas: PRO_QUOTAS,
  },
  tier_enterprise: {
    features: ENTERPRISE_FEATURES,
    quotas: ENTERPRISE_QUOTAS,
  },
};

export function isTierKey(value: string): value is TierKey {
  return (ALL_TIERS as readonly string[]).includes(value);
}

export function isFeatureKey(value: string): value is FeatureKey {
  return (ALL_FEATURES as readonly string[]).includes(value);
}

export function isQuotaKey(value: string): value is QuotaKey {
  return (ALL_QUOTAS as readonly string[]).includes(value);
}
