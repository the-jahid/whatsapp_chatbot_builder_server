// /src/leads/dto/lead.dto.ts

import { LeadStatus } from '@prisma/client';

/**
 * @interface CreateLeadDto
 * @description Data Transfer Object for creating a new lead.
 * It includes the necessary fields to associate the lead with an agent
 * and to provide initial information about its source and other data.
 */
export interface CreateLeadDto {
  /**
   * The unique identifier of the agent this lead belongs to.
   * @type {string}
   */
  agentId: string;

  /**
   * The source from which the lead was generated (e.g., 'Whatsapp', 'Website Form').
   * @type {string | null}
   * @optional
   */
  source?: string | null;

  /**
   * Flexible JSON field to store any unstructured data related to the lead,
   * such as initial conversation details or form submission data.
   * @type {Record<string, any> | null}
   * @optional
   */
  data?: Record<string, any> | null;
}

/**
 * @interface UpdateLeadDto
 * @description Data Transfer Object for updating an existing lead.
 * All fields are optional, allowing for partial updates.
 */
export interface UpdateLeadDto {
  /**
   * The new status of the lead.
   * @type {LeadStatus}
   * @optional
   */
  status?: LeadStatus;

  /**
   * The updated source of the lead.
   * @type {string | null}
   * @optional
   */
  source?: string | null;

  /**
   * Updated JSON data for the lead.
   * @type {Record<string, any> | null}
   * @optional
   */
  data?: Record<string, any> | null;
}

/**
 * @interface LeadDto
 * @description Data Transfer Object representing a complete Lead entity.
 * This is typically what you would send back to the client.
 */
export interface LeadDto {
  id: string;
  status: LeadStatus;
  source: string | null;
  data: Record<string, any> | null;
  agentId: string;
  createdAt: Date;
  updatedAt: Date;
}




import { Type } from 'class-transformer';
import { IsOptional, IsString, IsEnum, IsInt, Min, Max, IsDate } from 'class-validator';

/**
 * @class QueryLeadDto
 * @description Data Transfer Object for advanced querying of leads.
 * Includes options for filtering, pagination, and sorting.
 */
export class QueryLeadDto {
  /**
   * Filter leads by their status.
   */
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  /**
   * Filter leads by a case-insensitive search of their source.
   */
  @IsOptional()
  @IsString()
  source?: string;

  /**
   * The field to sort the results by. Defaults to 'updatedAt'.
   * Allowed values could be extended (e.g., 'createdAt', 'status').
   */
  @IsOptional()
  @IsString()
  sortBy?: string = 'updatedAt';

  /**
   * The order for sorting. Defaults to 'desc'.
   */
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  /**
   * The page number for pagination. Defaults to 1.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  /**
   * The number of items per page. Defaults to 10. Max 100.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  /**
   * Filter for leads created after this date.
   */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  createdAfter?: Date;

  /**
   * Filter for leads created before this date.
   */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  createdBefore?: Date;
}


















