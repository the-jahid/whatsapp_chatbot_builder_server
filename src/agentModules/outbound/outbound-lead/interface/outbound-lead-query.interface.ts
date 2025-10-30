import type { OutboundLeadStatus } from '@prisma/client';

export type OutboundLeadSortBy =
  | 'createdAt'
  | 'lastAttemptAt'
  | 'status'
  | 'phoneNumber'
  | 'firstName';

export type SortOrder = 'asc' | 'desc';

export interface IOutboundLeadQuery {
  page?: number;           // default 1
  limit?: number;          // default 20 (max 100)

  outboundCampaignId?: string; // usually set from PATH by controller
  status?: OutboundLeadStatus | OutboundLeadStatus[];

  q?: string;              // search by phoneNumber/firstName

  createdFrom?: Date | string;
  createdTo?: Date | string;
  lastAttemptFrom?: Date | string;
  lastAttemptTo?: Date | string;

  sortBy?: OutboundLeadSortBy;  // default 'createdAt'
  sortOrder?: SortOrder;        // default 'desc'
}
