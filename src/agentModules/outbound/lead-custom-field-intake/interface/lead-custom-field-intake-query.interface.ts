export type LeadCustomFieldIntakeSortBy = 'createdAt' | 'name';
export type SortOrder = 'asc' | 'desc';

export interface ILeadCustomFieldIntakeQuery {
  page?: number;       // default 1
  limit?: number;      // default 20 (max 100)

  outboundCampaignId?: string; // optional filter if needed
  q?: string;          // search by name (contains/ilike)

  sortBy?: LeadCustomFieldIntakeSortBy; // default 'createdAt'
  sortOrder?: SortOrder;                // default 'desc'
}



















