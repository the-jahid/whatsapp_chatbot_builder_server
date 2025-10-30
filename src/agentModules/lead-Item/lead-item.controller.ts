import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { LeadItemService } from './lead-item.service';
import {
  CreateLeadItemDto,
  UpdateLeadItemDto,
  GetAllLeadItemsQueryDto,
} from './dto/lead-item.dto';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiNotFoundResponse,
  ApiConflictResponse,
  ApiExtraModels,
  ApiNoContentResponse,
} from '@nestjs/swagger';
import { ZodValidationPipe } from 'src/common/pipes/zod.validation.pipe';
import { createLeadItemSchema, updateLeadItemSchema } from './schema/lead-item.schema';
import { getAllLeadItemsQuerySchema } from './schema/lead-item.query.schema';

// Envelope swagger decorators you showed in the screenshots
import {
  ApiOkEnvelope,
  ApiCreatedEnvelope,
} from 'src/common/swagger/api-envelope.decorators';


import { created, ok } from 'src/common/http/envelope';
import { LeadItemEntity } from './entities/lead-item.entity';
import { PaginatedLeadItemsEntity } from './entities/paginated-lead-items.entity';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';



@ApiTags('Lead Items')
@ApiExtraModels(LeadItemEntity, PaginatedLeadItemsEntity)
@Controller('lead-items')
// NOTE: For a more canonical REST path you could expose
// GET /agents/:agentId/lead-items via an Agents controller.
// Keeping your current path per request.
@UseGuards(ClerkAuthGuard)
export class LeadItemController {
  constructor(private readonly leadItemService: LeadItemService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new lead item (product/service)' })
  @ApiCreatedEnvelope(LeadItemEntity)
  @ApiNotFoundResponse({ description: 'Agent not found' })
  @ApiConflictResponse({ description: 'Duplicate name for this agent' })
  async create(
    @Body(new ZodValidationPipe(createLeadItemSchema)) createLeadItemDto: CreateLeadItemDto,
  ) {
    const item = await this.leadItemService.create(createLeadItemDto);
    return created(item, 'Lead item created');
  }

  @Get('agent/:agentId')
  @ApiOperation({ summary: 'Get all lead items for a specific agent' })
  @ApiParam({
    name: 'agentId',
    description: 'UUID of the agent',
    example: '1b2d1b1a-2f9a-42c6-8a1a-3b5d1a2e9c11',
  })
  @ApiQuery({ name: 'page', required: false, example: 1, description: 'Page number (>=1)' })
  @ApiQuery({ name: 'limit', required: false, example: 10, description: 'Page size (1..100)' })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['name', 'description', 'createdAt', 'updatedAt'],
    example: 'createdAt',
  })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'], example: 'desc' })
  @ApiQuery({ name: 'name', required: false, description: 'Case-insensitive substring match' })
  @ApiQuery({
    name: 'description',
    required: false,
    description: 'Case-insensitive substring match',
  })
  @ApiOkEnvelope(PaginatedLeadItemsEntity)
  async findAllForAgent(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Query(new ZodValidationPipe(getAllLeadItemsQuerySchema)) query: GetAllLeadItemsQueryDto,
  ) {
    const paged = await this.leadItemService.findAllForAgent(agentId, query);
    return ok(paged, 'Lead items loaded');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific lead item by its ID' })
  @ApiParam({ name: 'id', description: 'UUID of the lead item' })
  @ApiOkEnvelope(LeadItemEntity)
  @ApiNotFoundResponse({ description: 'Lead item not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const item = await this.leadItemService.findOne(id);
    return ok(item);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a lead item' })
  @ApiParam({ name: 'id', description: 'UUID of the lead item' })
  @ApiOkEnvelope(LeadItemEntity)
  @ApiNotFoundResponse({ description: 'Lead item not found' })
  @ApiConflictResponse({ description: 'Duplicate name for this agent' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateLeadItemSchema)) updateLeadItemDto: UpdateLeadItemDto,
  ) {
    const updated = await this.leadItemService.update(id, updateLeadItemDto);
    return ok(updated, 'Lead item updated');
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a lead item' })
  @ApiParam({ name: 'id', description: 'UUID of the lead item' })
  @ApiNoContentResponse({ description: 'Deleted' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.leadItemService.remove(id);
    // 204 No Content => no response body by design (keep REST-true)
  }
}
