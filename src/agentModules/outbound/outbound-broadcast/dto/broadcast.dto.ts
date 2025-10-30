// src/modules/outbound-broadcast/dto/broadcast.dto.ts

import { z } from 'zod';
import {
  CreateBroadcastSchema,
  UpdateBroadcastSchema,
  QueryBroadcastSchema,
} from '../schema';

/** Create / Update DTOs inferred from Zod */
export type CreateBroadcastDto = z.infer<typeof CreateBroadcastSchema>;
export type UpdateBroadcastDto = z.infer<typeof UpdateBroadcastSchema>;

/** Query DTO for list endpoint (validated via Zod pipe) */
export type GetBroadcastsQueryDto = z.infer<typeof QueryBroadcastSchema>;

/** Re-export useful domain interfaces for callers */
export type {
  BroadcastEntity,
  BroadcastOrderBy,
  BroadcastQuery,
  BroadcastCountersInput,
  ToggleEnabledInput,
  TogglePausedInput,
  SetStatusInput,
  AttachTemplateInput,
} from '../interface';
