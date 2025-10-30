// src/agent-modules/outbound-campaign/interface/outbound-campaign.interface.ts
import { OutboundCampaignStatus } from '@prisma/client';

export interface OutboundCampaignEntity {
  id: string;
  name: string;
  status: OutboundCampaignStatus;
  createdAt: Date;
  updatedAt: Date;
  agentId: string;
}

export type SortOrder = 'asc' | 'desc';

export interface OutboundCampaignQuery {
  agentId: string;                // required to scope by agent
  status?: OutboundCampaignStatus;
  search?: string;                // partial match on name
  page?: number;                  // 1-based
  limit?: number;                 // default 20
  sortBy?: 'createdAt' | 'updatedAt' | 'name' | 'status';
  sortOrder?: SortOrder;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  hasNextPage: boolean;
}
