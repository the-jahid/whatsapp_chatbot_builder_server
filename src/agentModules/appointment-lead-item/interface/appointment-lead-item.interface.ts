/**
 * AppointmentLeadItem interfaces
 * Mirrors the Prisma model:
 *  - id: string
 *  - name: string
 *  - description?: string | null
 *  - agentId: string
 *  - createdAt: Date
 *  - updatedAt: Date
 */

export interface AppointmentLeadItemEntity {
  id: string;
  name: string;
  description?: string | null;
  agentId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Create payload (service/repo input) */
export interface CreateAppointmentLeadItemInput {
  agentId: string;
  name: string;
  description?: string;
}

/** Update payload (partial) */
export interface UpdateAppointmentLeadItemInput {
  name?: string;
  description?: string;
}

/** List/query params */
export interface QueryAppointmentLeadItems {
  agentId: string;
  search?: string;     // free-text on name/description
  cursor?: string;     // last item id for cursor pagination
  take?: number;       // page size (default in service; cap at 100)
}

/** Generic paginated result shape */
export interface PaginatedResult<T> {
  items: T[];
  nextCursor?: string; // present if more pages available
  total?: number;      // optional if you compute counts
}

/**
 * Repository contract (thin wrapper over Prisma).
 * Implement this with PrismaService in: repository/appointment-lead-item.repository.ts
 */
export interface IAppointmentLeadItemRepository {
  create(data: CreateAppointmentLeadItemInput): Promise<AppointmentLeadItemEntity>;
  update(id: string, data: UpdateAppointmentLeadItemInput): Promise<AppointmentLeadItemEntity>;
  delete(id: string): Promise<void>;
  findById(id: string): Promise<AppointmentLeadItemEntity | null>;
  findMany(query: QueryAppointmentLeadItems): Promise<PaginatedResult<AppointmentLeadItemEntity>>;
  existsByName(agentId: string, name: string): Promise<boolean>;
}

/**
 * Service contract (application/business layer).
 * Implement this in: appointment-lead-item.service.ts
 */
export interface IAppointmentLeadItemService {
  create(input: CreateAppointmentLeadItemInput): Promise<AppointmentLeadItemEntity>;
  update(id: string, input: UpdateAppointmentLeadItemInput): Promise<AppointmentLeadItemEntity>;
  delete(id: string): Promise<void>;
  getById(id: string): Promise<AppointmentLeadItemEntity | null>;
  list(query: QueryAppointmentLeadItems): Promise<PaginatedResult<AppointmentLeadItemEntity>>;
}
