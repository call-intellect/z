import { z } from "zod";

import { apiClient } from "./api-client";

export const SkillTraitConceptStatusSchema = z.enum([
  "active",
  "merged_into",
  "archived",
]);
export type SkillTraitConceptStatus = z.infer<
  typeof SkillTraitConceptStatusSchema
>;

const SkillTraitConceptListItemSchema = z.object({
  id: z.string(),
  canonicalName: z.string(),
  description: z.string().nullable(),
  variants: z.array(z.string()),
  status: SkillTraitConceptStatusSchema,
  mergedIntoId: z.string().nullable(),
  traitCount: z.number().int().min(0),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
});

export const SkillTraitConceptsListResponseSchema = z.object({
  items: z.array(SkillTraitConceptListItemSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});

const SkillTraitConceptRecentTraitSchema = z.object({
  id: z.string(),
  category: z.string(),
  statement: z.string(),
  confidence: z.string(),
  profileId: z.string(),
  personName: z.string().nullable(),
  lastConfirmedAt: z.string(),
});

export const SkillTraitConceptDetailSchema =
  SkillTraitConceptListItemSchema.extend({
    recentTraits: z.array(SkillTraitConceptRecentTraitSchema),
  });

export type SkillTraitConceptListItem = z.infer<
  typeof SkillTraitConceptListItemSchema
>;
export type SkillTraitConceptsListResponse = z.infer<
  typeof SkillTraitConceptsListResponseSchema
>;
export type SkillTraitConceptDetail = z.infer<
  typeof SkillTraitConceptDetailSchema
>;
export type SkillTraitConceptRecentTrait = z.infer<
  typeof SkillTraitConceptRecentTraitSchema
>;

export const MergeSkillTraitConceptSchema = z.object({
  targetId: z.string().min(1),
  reason: z.string().min(3).max(500),
});
export type MergeSkillTraitConceptRequest = z.infer<
  typeof MergeSkillTraitConceptSchema
>;

export const ArchiveSkillTraitConceptSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type ArchiveSkillTraitConceptRequest = z.infer<
  typeof ArchiveSkillTraitConceptSchema
>;

export const adminSkillTraitConceptsApi = {
  async list(params: {
    status?: SkillTraitConceptStatus;
    page?: number;
    pageSize?: number;
    q?: string;
  }): Promise<SkillTraitConceptsListResponse> {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    if (params.q) qs.set("q", params.q);
    const url =
      `/api/v1/admin/skill-trait-concepts` +
      (qs.size ? `?${qs.toString()}` : "");
    const raw = await apiClient.get<unknown>(url);
    return SkillTraitConceptsListResponseSchema.parse(raw);
  },

  async detail(id: string): Promise<SkillTraitConceptDetail> {
    const raw = await apiClient.get<unknown>(
      `/api/v1/admin/skill-trait-concepts/${encodeURIComponent(id)}`,
    );
    return SkillTraitConceptDetailSchema.parse(raw);
  },

  async merge(
    id: string,
    body: MergeSkillTraitConceptRequest,
  ): Promise<{ ok: true }> {
    const validated = MergeSkillTraitConceptSchema.parse(body);
    const raw = await apiClient.post<{ ok: true }>(
      `/api/v1/admin/skill-trait-concepts/${encodeURIComponent(id)}/merge`,
      validated,
    );
    return raw;
  },

  async archive(
    id: string,
    body: ArchiveSkillTraitConceptRequest,
  ): Promise<{ ok: true }> {
    const validated = ArchiveSkillTraitConceptSchema.parse(body);
    const raw = await apiClient.post<{ ok: true }>(
      `/api/v1/admin/skill-trait-concepts/${encodeURIComponent(id)}/archive`,
      validated,
    );
    return raw;
  },
};
