// /src/leads/controllers/lead.controller.ts

import { Controller, Get, Delete, Param, Query, UsePipes, ValidationPipe, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';


import { Lead } from '@prisma/client';
import { QueryLeadDto } from './dto/lead.dto';
import { LeadService, PaginatedLeadsResult } from './lead.service';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';

@ApiTags('Leads')
@Controller('leads')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@UseGuards(ClerkAuthGuard)
export class LeadController {
  constructor(private readonly leadService: LeadService) {}

  @Get()
  @ApiOperation({ summary: 'Get all leads', description: 'Retrieves a paginated and filtered list of all leads in the system. Intended for admin-level access.' })
  @ApiResponse({ status: 200, description: 'A paginated list of leads.' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters provided.' })
  findAllLeads(@Query() query: QueryLeadDto): Promise<PaginatedLeadsResult> {
    return this.leadService.findAllLeads(query);
  }

  @Get('/agent/:agentId')
  @ApiOperation({ summary: 'Get leads by agent ID', description: 'Retrieves a paginated and filtered list of leads for a specific agent.' })
  @ApiParam({ name: 'agentId', type: 'string', description: 'The UUID of the agent.' })
  @ApiResponse({ status: 200, description: 'A paginated list of leads for the specified agent.' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters provided.' })
  findLeadsByAgent(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Query() query: QueryLeadDto,
  ): Promise<PaginatedLeadsResult> {
    return this.leadService.findLeadsByAgent(agentId, query);
  }

  @Get('/:id/agent/:agentId')
  @ApiOperation({ summary: 'Get a single lead by ID for a specific agent', description: 'Retrieves a single lead, ensuring it belongs to the specified agent.' })
  @ApiParam({ name: 'id', type: 'string', description: 'The UUID of the lead.' })
  @ApiParam({ name: 'agentId', type: 'string', description: 'The UUID of the agent who owns the lead.' })
  @ApiResponse({ status: 200, description: 'The requested lead object.' })
  @ApiResponse({ status: 404, description: 'Lead not found for the specified agent.' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
  ): Promise<Lead> {
    return this.leadService.findOne(id, agentId);
  }

  @Delete('/:id/agent/:agentId')
  @ApiOperation({ summary: 'Delete a lead', description: 'Removes a lead from the database, ensuring it belongs to the specified agent before deletion.' })
  @ApiParam({ name: 'id', type: 'string', description: 'The UUID of the lead to delete.' })
  @ApiParam({ name: 'agentId', type: 'string', description: 'The UUID of the agent who owns the lead.' })
  @ApiResponse({ status: 200, description: 'The deleted lead object.' })
  @ApiResponse({ status: 404, description: 'Lead not found for the specified agent.' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
  ): Promise<Lead> {
    return this.leadService.remove(id, agentId);
  }
}
