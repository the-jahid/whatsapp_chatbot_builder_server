import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UsePipes,
  ValidationPipe,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';

import { AppointmentLeadItemService } from './appointment-lead-item.service';
import { CreateAppointmentLeadItemDto } from './dto/create-appointment-lead-item.dto';
import { UpdateAppointmentLeadItemDto } from './dto/update-appointment-lead-item.dto';
import { QueryAppointmentLeadItemsDto } from './dto/query-appointment-lead-items.dto';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';

@Controller('agents/:agentId/appointment-lead-items')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@UseGuards(ClerkAuthGuard)
export class AppointmentLeadItemController {
  constructor(private readonly service: AppointmentLeadItemService) {}

  // LIST
  @Get()
  async list(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query() query: QueryAppointmentLeadItemsDto,
  ) {
    const result = await this.service.list({ ...query, agentId });
    return { data: result.items, nextCursor: result.nextCursor };
  }

  // GET ONE
  @Get(':id')
  async getById(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const item = await this.service.getById(id);
    if (!item || item.agentId !== agentId) {
      // Hide existence if it belongs to another agent
      throw new NotFoundException('Appointment lead item not found');
    }
    return { data: item };
  }

  // CREATE
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() body: CreateAppointmentLeadItemDto,
  ) {
    const created = await this.service.create({
      agentId, // enforce from route
      name: body.name,
      description: body.description,
    });
    return { data: created };
  }

  // UPDATE
  @Patch(':id')
  async update(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateAppointmentLeadItemDto,
  ) {
    await this.ensureOwnership(agentId, id);
    const updated = await this.service.update(id, body);
    return { data: updated };
  }

  // DELETE
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    await this.ensureOwnership(agentId, id);
    await this.service.delete(id);
    return; // 204
  }

  // ----------------------
  // Helpers
  // ----------------------
  private async ensureOwnership(agentId: string, id: string) {
    const item = await this.service.getById(id);
    if (!item || item.agentId !== agentId) {
      throw new NotFoundException('Appointment lead item not found');
    }
  }
}

