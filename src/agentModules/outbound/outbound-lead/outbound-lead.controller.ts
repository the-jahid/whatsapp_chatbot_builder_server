// src/agent-modules/outbound-lead/outbound-lead.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Param,
  Patch,
  PipeTransform,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';

import { OutboundLeadService } from './outbound-lead.service';

// DTO types (inferred from Zod)
import { CreateOutboundLeadDto } from './dto/create-outbound-lead.dto';
import { UpdateOutboundLeadDto } from './dto/update-outbound-lead.dto';
import { QueryOutboundLeadsDto } from './dto/query-outbound-leads.dto';
import { SetLeadStatusDto } from './dto/set-status.dto';
import { RecordAttemptDto } from './dto/record-attempt.dto';
import { UpsertCustomFieldsDto } from './dto/upsert-custom-fields.dto';

// Zod schemas (runtime validation)
import {
  CreateOutboundLeadSchema,
  UpdateOutboundLeadSchema,
  SetLeadStatusSchema,
  RecordAttemptSchema,
  UpsertCustomFieldsSchema,
} from './schema/outbound-lead.schema';
import { QueryOutboundLeadsSchema } from './schema/query-outbound-leads.schema';

/** Accept ANY UUID version; trims input before checking */
@Injectable()
class AnyUuidPipe implements PipeTransform<string> {
  private readonly re =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  transform(value: string): string {
    const v = (value ?? '').trim();
    if (!this.re.test(v)) {
      // Keep message generic to avoid v4-only errors
      throw new BadRequestException('Validation failed (uuid is expected)');
    }
    return v;
  }
}

@Controller()
export class OutboundLeadController {
  constructor(private readonly svc: OutboundLeadService) {}

  // Helper: Zod -> 400 on failure
  private validate<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return parsed.data;
  }

  // ---------------------------------------------------------------------------
  // CREATE (campaignId in PATH)
  // POST /outbound-campaigns/:campaignId/leads
  // ---------------------------------------------------------------------------
  @Post('outbound-campaigns/:campaignId/leads')
  async createForCampaign(
    @Param('campaignId', new AnyUuidPipe()) campaignId: string,
    @Body() body: CreateOutboundLeadDto,
  ) {
    const dto = this.validate(CreateOutboundLeadSchema, body);
    return this.svc.create(campaignId, dto);
  }

  // ---------------------------------------------------------------------------
  // LIST within a campaign
  // GET /outbound-campaigns/:campaignId/leads
  // ---------------------------------------------------------------------------
  @Get('outbound-campaigns/:campaignId/leads')
  async findMany(
    @Param('campaignId', new AnyUuidPipe()) campaignId: string,
    @Query() q: QueryOutboundLeadsDto,
  ) {
    const dto = this.validate(QueryOutboundLeadsSchema, q);
    return this.svc.findMany(campaignId, dto);
  }

  // ---------------------------------------------------------------------------
  // GET ONE / UPDATE / DELETE (by id)
  // ---------------------------------------------------------------------------

  // GET /leads/:id
  @Get('leads/:id')
  async findOne(@Param('id', new AnyUuidPipe()) id: string) {
    return this.svc.findOne(id);
  }

  // PATCH /leads/:id
  @Patch('leads/:id')
  async update(
    @Param('id', new AnyUuidPipe()) id: string,
    @Body() body: UpdateOutboundLeadDto,
  ) {
    const dto = this.validate(UpdateOutboundLeadSchema, body);
    return this.svc.update(id, dto);
  }

  // DELETE /leads/:id
  @Delete('leads/:id')
  async remove(@Param('id', new AnyUuidPipe()) id: string) {
    return this.svc.remove(id);
  }

  // ---------------------------------------------------------------------------
  // ACTIONS
  // ---------------------------------------------------------------------------

  // PATCH /leads/:id/status
  @Patch('leads/:id/status')
  async setStatus(
    @Param('id', new AnyUuidPipe()) id: string,
    @Body() body: SetLeadStatusDto,
  ) {
    const dto = this.validate(SetLeadStatusSchema, body);
    return this.svc.setStatus(id, dto);
  }

  // PATCH /leads/:id/record-attempt
  @Patch('leads/:id/record-attempt')
  async recordAttempt(
    @Param('id', new AnyUuidPipe()) id: string,
    @Body() body: RecordAttemptDto,
  ) {
    const dto = this.validate(RecordAttemptSchema, body);
    return this.svc.recordAttempt(id, dto);
  }

  // PATCH /leads/:id/custom-fields
  @Patch('leads/:id/custom-fields')
  async upsertCustomFields(
    @Param('id', new AnyUuidPipe()) id: string,
    @Body() body: UpsertCustomFieldsDto,
  ) {
    const dto = this.validate(UpsertCustomFieldsSchema, body);
    return this.svc.upsertCustomFields(id, dto);
  }
}
