import type { Prisma, OutboundLeadStatus } from '@prisma/client';

export interface IOutboundLead {
  id: string;
  phoneNumber: string;
  firstName: string | null;
  timeZone: string;
  status: OutboundLeadStatus;

  attemptsMade: number;
  maxAttempts: number;
  lastAttemptAt: Date | null;

  outboundCampaignId: string;

  customFields?: Prisma.JsonValue | null;

  createdAt: Date;
  updatedAt: Date;
}
