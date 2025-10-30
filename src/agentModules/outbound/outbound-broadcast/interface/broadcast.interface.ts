// src/modules/outbound-broadcast/interface/broadcast.interface.ts
import type { Broadcast, BroadcastStatus } from '@prisma/client';

/** Canonical entity from Prisma */
export type BroadcastEntity = Broadcast;

/** Useful literal union for sorting */
export type BroadcastOrderBy =
  | 'createdAt:desc'
  | 'createdAt:asc'
  | 'updatedAt:desc'
  | 'updatedAt:asc';

/** Query shape (kept in sync with Query schema) */
export interface BroadcastQuery {
  outboundCampaignId?: string;
  status?: BroadcastStatus;
  isEnabled?: boolean;
  isPaused?: boolean;

  take?: number; // default 20
  skip?: number; // default 0
  cursor?: string; // broadcast.id
  orderBy?: BroadcastOrderBy; // default 'createdAt:desc'
}

/** Counter deltas for progress updates */
export interface BroadcastCountersInput {
  queued?: number;
  sent?: number;
  failed?: number;
}

/** Toggle flags */
export interface ToggleEnabledInput {
  id: string;
  isEnabled: boolean;
}

export interface TogglePausedInput {
  id: string;
  isPaused: boolean;
}

/** Status transition */
export interface SetStatusInput {
  id: string;
  status: BroadcastStatus;
}

/** Attach/detach a template (null to detach) */
export interface AttachTemplateInput {
  id: string;
  templateId: string | null;
}

/** Update settings (no batching; single message gap only) */
export interface UpdateBroadcastSettingsInput {
  id: string;
  isEnabled?: boolean;
  isPaused?: boolean;
  startAt?: Date | null;
  selectedTemplateId?: string | null;

  /** Gap between consecutive messages in seconds (DB default: 120s) */
  messageGapSeconds?: number;
}
