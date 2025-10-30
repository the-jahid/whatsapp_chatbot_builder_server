// src/agent-modules/outbound-campaign/dto/set-status.dto.ts
import { z } from 'zod';
import { SetStatusSchema } from '../schema';


export type SetStatusDto = z.infer<typeof SetStatusSchema>;
