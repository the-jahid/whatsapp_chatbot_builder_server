// /src/leads/interfaces/lead.interface.ts

// FIX: Import Prisma to use its specific JSON type for perfect compatibility.
import { LeadStatus, Prisma } from '@prisma/client';

/**
 * @interface CreateLead
 * @description Defines the shape of the data required to create a new lead.
 * It uses Prisma.InputJsonValue to ensure the 'data' field is type-safe.
 */
export interface CreateLead {
  agentId: string;
  source?: string | null;
  // FIX: Use Prisma.InputJsonValue to match the expected type for JSON fields.
  data?: Prisma.InputJsonValue;
}

/**
 * @interface UpdateLead
 * @description Defines the shape of the data for updating an existing lead.
 * All properties are optional to allow for partial updates.
 */
export interface UpdateLead {
  status?: LeadStatus;
  source?: string | null;
  // FIX: Use Prisma.InputJsonValue for type safety on updates.
  data?: Prisma.InputJsonValue;
}
