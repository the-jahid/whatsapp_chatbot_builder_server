// src/agent-modules/lead-custom-field-intake/lead-custom-field-intake.controller.ts
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

import { LeadCustomFieldIntakeService } from './lead-custom-field-intake.service';

// DTO types
import { CreateLeadCustomFieldIntakeDto } from './dto/create-lead-custom-field-intake.dto';
import { UpdateLeadCustomFieldIntakeDto } from './dto/update-lead-custom-field-intake.dto';
import { QueryLeadCustomFieldIntakesDto } from './dto/query-lead-custom-field-intakes.dto';

// Zod schemas (runtime validation)
import {
  CreateLeadCustomFieldIntakeSchema,
  UpdateLeadCustomFieldIntakeSchema,
} from './schema/lead-custom-field-intake.schema';
import { QueryLeadCustomFieldIntakesSchema } from './schema/query-lead-custom-field-intakes.schema';

/** Accept ANY UUID version; trims input before checking */
@Injectable()
class AnyUuidPipe implements PipeTransform<string> {
  private readonly re =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  transform(value: string): string {
    const v = (value ?? '').trim();
    if (!this.re.test(v)) {
      throw new BadRequestException('Validation failed (uuid is expected)');
    }
    return v;
  }
}

@Controller()
export class LeadCustomFieldIntakeController {
  constructor(private readonly svc: LeadCustomFieldIntakeService) {}

  // generic Zod validator → throws 400 with details
  private validate<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return parsed.data;
  }

  // ---------------------------------------------------------------------------
  // CREATE (campaignId in PATH)
  // POST /outbound-campaigns/:campaignId/custom-fields
  // ---------------------------------------------------------------------------
  @Post('outbound-campaigns/:campaignId/custom-fields')
  async createForCampaign(
    @Param('campaignId', new AnyUuidPipe()) campaignId: string,
    @Body() body: CreateLeadCustomFieldIntakeDto,
  ) {
    const dto = this.validate(CreateLeadCustomFieldIntakeSchema, body);
    return this.svc.create(campaignId, dto);
  }

  // ---------------------------------------------------------------------------
  // LIST in campaign
  // GET /outbound-campaigns/:campaignId/custom-fields
  // ---------------------------------------------------------------------------
  @Get('outbound-campaigns/:campaignId/custom-fields')
  async findMany(
    @Param('campaignId', new AnyUuidPipe()) campaignId: string,
    @Query() q: QueryLeadCustomFieldIntakesDto,
  ) {
    const dto = this.validate(QueryLeadCustomFieldIntakesSchema, q);
    return this.svc.findMany(campaignId, dto);
  }

  // ---------------------------------------------------------------------------
  // GET ONE / UPDATE / DELETE (by id)
  // ---------------------------------------------------------------------------

  // GET /custom-fields/:id
  @Get('custom-fields/:id')
  async findOne(@Param('id', new AnyUuidPipe()) id: string) {
    return this.svc.findOne(id);
  }

  // PATCH /custom-fields/:id
  @Patch('custom-fields/:id')
  async update(
    @Param('id', new AnyUuidPipe()) id: string,
    @Body() body: UpdateLeadCustomFieldIntakeDto,
  ) {
    const dto = this.validate(UpdateLeadCustomFieldIntakeSchema, body);
    return this.svc.update(id, dto);
  }

  // DELETE /custom-fields/:id
  @Delete('custom-fields/:id')
  async remove(@Param('id', new AnyUuidPipe()) id: string) {
    return this.svc.remove(id);
  }
}
