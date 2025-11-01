// ===================================================
// Controller: src/agent/agent.controller.ts
// Enriched responses: { data, links, meta{...} } for single,
// and { data, meta{pagination}, links{pages}, http{status/meta} } for lists
// Includes model-options endpoints so the UI can dynamically render providers/models
// and uses the DTO helpers to correctly map UI -> server DTO on create.
// Ordering note: "models/*" routes are defined BEFORE ":id" to avoid conflicts.
// ===================================================
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiExtraModels,
  ApiProperty,
  ApiProduces,
  getSchemaPath,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  Agent,
  MemoryType,
  AIModel,
  OpenAIModel,
  GeminiModel,
  ClaudeModel,
} from '@prisma/client';

import { AgentService, GetAllAgentsQuery } from './agent.service';
import {
  CreateAgentDto,
  CreateAgentInputDto,
  UpdateAgentDto,
  toCreateAgentDto,
} from './dto/agent.dto';

import { ZodValidationPipe } from 'src/common/pipes/zod.validation.pipe';
import { createAgentInputSchema, updateAgentSchema } from './schemas/agent.schema';
import {
  getAllAgentsQuerySchema,
  GetAllAgentsQueryDto,
} from './schemas/agent.query.schema';

import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { UserService } from 'src/user/services/user.service';

type ReqWithAuth = Request & {
  auth?: { clerkUserId?: string; sessionId?: string };
};

// ---------------------------------------------------
// Response DTOs
// ---------------------------------------------------
class AgentResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) prompt!: string | null;
  /** Masked alias for UI (e.g., ****abcd). Never returns raw key. */
  @ApiProperty({ nullable: true }) apiKey!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() isLeadsActive!: boolean;
  @ApiProperty() isEmailActive!: boolean;

  /** NEW feature flags (exposed) */
  @ApiProperty() isVoiceResponseAvailable!: boolean;
  @ApiProperty() isImageDataExtraction!: boolean;

  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ enum: MemoryType }) memoryType!: MemoryType;

  /** BUFFER memory window size (nullable for legacy) */
  @ApiProperty({ nullable: true, example: 20 }) historyLimit!: number | null;

  @ApiProperty() isKnowledgebaseActive!: boolean;
  @ApiProperty() isBookingActive!: boolean;

  @ApiProperty({ enum: AIModel }) modelType!: AIModel;
  @ApiProperty() useOwnApiKey!: boolean;
  /** Masked as well. */
  @ApiProperty({ nullable: true }) userProvidedApiKey!: string | null;
  @ApiProperty({ enum: OpenAIModel, nullable: true }) openAIModel!: OpenAIModel | null;
  @ApiProperty({ enum: GeminiModel, nullable: true }) geminiModel!: GeminiModel | null;
  @ApiProperty({ enum: ClaudeModel, nullable: true }) claudeModel!: ClaudeModel | null;
}

class ResourceLinksDto {
  @ApiProperty() self!: string;
  @ApiProperty() update!: string;
  @ApiProperty() delete!: string;
}

class PaginationMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
}

class PaginationLinksDto {
  @ApiProperty() self!: string;
  @ApiProperty() first!: string;
  @ApiProperty({ nullable: true }) prev!: string | null;
  @ApiProperty({ nullable: true }) next!: string | null;
  @ApiProperty() last!: string;
}

/** Meta mirroring the HTTP status line (used on list endpoints). */
class HttpMetaDto {
  @ApiProperty({ example: 200 }) statusCode!: number;
  @ApiProperty({ example: 'OK' }) message!: string;
  @ApiProperty({ type: String, format: 'date-time' }) timestamp!: string;
  @ApiProperty({ example: '/agents?...' }) path!: string;
}

class SingleAgentEnvelopeDto {
  @ApiProperty({ type: AgentResponseDto }) data!: AgentResponseDto;
  @ApiProperty({ type: ResourceLinksDto }) links!: ResourceLinksDto;
  @ApiProperty({ type: HttpMetaDto }) meta!: HttpMetaDto;
}

class PaginatedAgentsEnvelopeDto {
  @ApiProperty({ type: [AgentResponseDto] }) data!: AgentResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta!: PaginationMetaDto;
  @ApiProperty({ type: PaginationLinksDto }) links!: PaginationLinksDto;
  @ApiProperty({ type: HttpMetaDto }) http!: HttpMetaDto; // avoid name collision with pagination meta
}

/** Small DTO for model option rows */
class ModelOptionDto {
  @ApiProperty() value!: string;
  @ApiProperty() label!: string;
}

/** Envelope for all model options at once */
class AllModelOptionsDto {
  @ApiProperty({ type: [ModelOptionDto] }) providers!: ModelOptionDto[];
  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(ModelOptionDto) },
    example: {
      CHATGPT: [{ value: 'gpt_4o_mini', label: 'Gpt 4o Mini' }],
      GEMINI: [{ value: 'gemini_1_5_flash', label: 'Gemini 1.5 Flash' }],
      CLAUDE: [{ value: 'claude_3_5_sonnet_latest', label: 'Claude 3.5 Sonnet Latest' }],
    },
  })
  modelsByProvider!: Record<string, ModelOptionDto[]>;
}

@ApiTags('agents')
@ApiBearerAuth()
@ApiProduces('application/json')
@ApiExtraModels(
  AgentResponseDto,
  ResourceLinksDto,
  PaginationMetaDto,
  PaginationLinksDto,
  HttpMetaDto,
  SingleAgentEnvelopeDto,
  PaginatedAgentsEnvelopeDto,
  ModelOptionDto,
  AllModelOptionsDto,
)
@UseGuards(ClerkAuthGuard)
@Controller('agents')
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly userService: UserService,
  ) {}

  // -----------------------------------------------
  // Helpers
  // -----------------------------------------------
  private maskKey(k?: string | null, keep = 4): string | null {
    if (!k) return null;
    const s = String(k);
    if (!s.length) return null;
    const tail = s.slice(-keep);
    return '****' + tail;
  }

  private toAgentResponseDto(a: Agent): AgentResponseDto {
    const masked = this.maskKey((a as any).userProvidedApiKey);
    return {
      id: a.id,
      name: a.name,
      prompt: a.prompt,
      apiKey: masked, // alias (masked)
      isActive: a.isActive,
      isLeadsActive: a.isLeadsActive,
      isEmailActive: a.isEmailActive,
      isVoiceResponseAvailable: (a as any).isVoiceResponseAvailable ?? false,
      isImageDataExtraction: (a as any).isImageDataExtraction ?? false,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      userId: a.userId,
      memoryType: a.memoryType,
      historyLimit: (a as any).historyLimit ?? null,
      isKnowledgebaseActive: (a as any).isKnowledgebaseActive ?? false,
      isBookingActive: (a as any).isBookingActive ?? false,
      modelType: a.modelType as AIModel,
      useOwnApiKey: (a as any).useOwnApiKey ?? false,
      userProvidedApiKey: masked,
      openAIModel: a.openAIModel as OpenAIModel | null,
      geminiModel: a.geminiModel as GeminiModel | null,
      claudeModel: a.claudeModel as ClaudeModel | null,
    };
  }

  private getBaseUrl(req: Request): string {
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const host = (req.headers['x-forwarded-host'] as string) || req.get('host');
    return `${proto}://${host}`;
  }

  private buildPageUrl(req: Request, page: number, limit: number): string {
    const base = this.getBaseUrl(req);
    const url = new URL(base + (req as any).path);
    const current = req.query as Record<string, string | string[] | undefined>;
    for (const [k, v] of Object.entries(current)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((vv) => url.searchParams.append(k, vv));
      else url.searchParams.set(k, v);
    }
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(limit));
    return url.toString();
  }

  private buildPaginationLinks(req: Request, meta: PaginationMetaDto): PaginationLinksDto {
    const { page, limit, totalPages } = meta;
    const self = this.buildPageUrl(req, page, limit);
    const first = this.buildPageUrl(req, 1, limit);
    const last = this.buildPageUrl(req, Math.max(totalPages, 1), limit);
    const prev = page > 1 ? this.buildPageUrl(req, page - 1, limit) : null;
    const next = page < totalPages ? this.buildPageUrl(req, page + 1, limit) : null;
    return { self, first, prev, next, last };
  }

  private buildResourceLinks(req: Request, id: string): ResourceLinksDto {
    const base = this.getBaseUrl(req);
    const self = `${base}/agents/${id}`;
    return { self, update: self, delete: self };
  }

  private buildHttpMeta(req: Request, statusCode: number, message: string): HttpMetaDto {
    return {
      statusCode,
      message,
      timestamp: new Date().toISOString(),
      path: (req as any).originalUrl || (req as any).url,
    };
  }

  // -------------------------------------------------
  // Model options (dynamic enums for UI pickers)
  //  NOTE: these are defined BEFORE ":id" to avoid route conflicts.
// -------------------------------------------------
  @Get('models')
  @ApiOperation({ summary: 'Get all providers + model options' })
  @ApiOkResponse({
    description: 'Providers and models grouped by provider.',
    content: { 'application/json': { schema: { $ref: getSchemaPath(AllModelOptionsDto) } } },
  })
  async getAllModelOptions(): Promise<AllModelOptionsDto> {
    return this.agentService.getAllModelOptions() as AllModelOptionsDto;
  }

  @Get('models/providers')
  @ApiOperation({ summary: 'Get list of AI providers (AIModel enum)' })
  @ApiOkResponse({
    description: 'Array of provider options.',
    type: [ModelOptionDto],
  })
  async getProviders(): Promise<ModelOptionDto[]> {
    return this.agentService.listProviders() as unknown as ModelOptionDto[];
  }

  @Get('models/openai')
  @ApiOperation({ summary: 'Get list of OpenAI models (OpenAIModel enum)' })
  @ApiOkResponse({
    description: 'Array of OpenAI model options.',
    type: [ModelOptionDto],
  })
  async getOpenAIModels(): Promise<ModelOptionDto[]> {
    return this.agentService.listOpenAIModels() as unknown as ModelOptionDto[];
  }

  @Get('models/gemini')
  @ApiOperation({ summary: 'Get list of Gemini models (GeminiModel enum)' })
  @ApiOkResponse({
    description: 'Array of Gemini model options.',
    type: [ModelOptionDto],
  })
  async getGeminiModels(): Promise<ModelOptionDto[]> {
    return this.agentService.listGeminiModels() as unknown as ModelOptionDto[];
  }

  @Get('models/claude')
  @ApiOperation({ summary: 'Get list of Claude models (ClaudeModel enum)' })
  @ApiOkResponse({
    description: 'Array of Claude model options.',
    type: [ModelOptionDto],
  })
  async getClaudeModels(): Promise<ModelOptionDto[]> {
    return this.agentService.listClaudeModels() as unknown as ModelOptionDto[];
  }

  // -------------------------------------------------
  // Create (201)
  // -------------------------------------------------
  @Post()
  @ApiOperation({ summary: 'Create a new agent (auth required)' })
  @ApiCreatedResponse({
    description: 'The agent has been successfully created.',
    content: { 'application/json': { schema: { $ref: getSchemaPath(SingleAgentEnvelopeDto) } } },
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @ApiConflictResponse({ description: 'Conflict (e.g., duplicate name for this user).' })
  async create(
    @Req() req: ReqWithAuth,
    @Body(new ZodValidationPipe(createAgentInputSchema)) body: CreateAgentInputDto,
  ): Promise<SingleAgentEnvelopeDto> {
    const me = await this.userService.getFromAuth(req.auth ?? {});
    const dto: CreateAgentDto = toCreateAgentDto(body, me.id);
    const agent = await this.agentService.create(dto);

    return {
      data: this.toAgentResponseDto(agent),
      links: this.buildResourceLinks(req as any, agent.id),
      meta: this.buildHttpMeta(req as any, HttpStatus.CREATED, 'Created'),
    };
  }

  // -------------------------------------------------
  // List MY agents (200) -> GET /agents
  // -------------------------------------------------
  @Get()
  @ApiOperation({ summary: 'List my agents (auth required)' })
  @ApiOkResponse({
    description: 'A paginated list of the current user’s agents.',
    content: { 'application/json': { schema: { $ref: getSchemaPath(PaginatedAgentsEnvelopeDto) } } },
  })
  @ApiBadRequestResponse({ description: 'Invalid query parameters.' })
  @ApiQuery({ name: 'page', required: false, example: '1' })
  @ApiQuery({ name: 'limit', required: false, example: '25' })
  @ApiQuery({ name: 'sort', required: false, example: 'createdAt:desc,name:asc' })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: [
      'id',
      'name',
      'prompt',
      'apiKey',
      'isActive',
      'memoryType',
      'isLeadsActive',
      'isEmailActive',
      'isKnowledgebaseActive',
      'isBookingActive',
      'useOwnApiKey',
      'historyLimit',
      'modelType',
      'openAIModel',
      'geminiModel',
      'claudeModel',
      'isVoiceResponseAvailable',
      'isImageDataExtraction',
      'createdAt',
      'updatedAt',
    ],
  })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'id', required: false })
  @ApiQuery({ name: 'ids', required: false, example: 'uuid1,uuid2' })
  @ApiQuery({ name: 'isActive', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'isLeadsActive', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'isEmailActive', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'isKnowledgebaseActive', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'isBookingActive', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'useOwnApiKey', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'isVoiceResponseAvailable', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'isImageDataExtraction', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'memoryType', required: false, enum: MemoryType })
  @ApiQuery({ name: 'modelType', required: false, enum: AIModel })
  @ApiQuery({ name: 'openAIModel', required: false, enum: OpenAIModel })
  @ApiQuery({ name: 'geminiModel', required: false, enum: GeminiModel })
  @ApiQuery({ name: 'claudeModel', required: false, enum: ClaudeModel })
  @ApiQuery({ name: 'historyLimit', required: false, example: '20' })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'prompt', required: false })
  @ApiQuery({ name: 'apiKey', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'createdAtFrom', required: false, example: '2025-01-01T00:00:00Z' })
  @ApiQuery({ name: 'createdAtTo', required: false, example: '2025-12-31T23:59:59Z' })
  @ApiQuery({ name: 'updatedAtFrom', required: false, example: '2025-01-01T00:00:00Z' })
  @ApiQuery({ name: 'updatedAtTo', required: false, example: '2025-12-31T23:59:59Z' })
  async findAllMine(
    @Req() req: ReqWithAuth,
    @Query(new ZodValidationPipe(getAllAgentsQuerySchema)) query: GetAllAgentsQueryDto,
  ): Promise<PaginatedAgentsEnvelopeDto> {
    const me = await this.userService.getFromAuth(req.auth ?? {});
    const result = await this.agentService.getAllForUser(
      me.id,
      query as unknown as GetAllAgentsQuery,
    );

    const paginationMeta: PaginationMetaDto = {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };

    return {
      data: result.data.map((a) => this.toAgentResponseDto(a)),
      meta: paginationMeta,
      links: this.buildPaginationLinks(req as any, paginationMeta),
      http: this.buildHttpMeta(req as any, HttpStatus.OK, 'OK'),
    };
  }

  // -------------------------------------------------
  // (Optional) List by explicit :userId for admin/UIs still calling this
  // -------------------------------------------------
  @Get('/user/:userId')
  @ApiOperation({ summary: 'List agents for a specific user (paginated & filterable)' })
  @ApiOkResponse({
    description: 'A paginated list of the user’s agents.',
    content: { 'application/json': { schema: { $ref: getSchemaPath(PaginatedAgentsEnvelopeDto) } } },
  })
  @ApiBadRequestResponse({ description: 'Invalid query parameters.' })
  @ApiForbiddenResponse({ description: 'You can only list your own agents.' })
  async findAllByUser(
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Req() req: ReqWithAuth,
    @Query(new ZodValidationPipe(getAllAgentsQuerySchema)) query: GetAllAgentsQueryDto,
  ): Promise<PaginatedAgentsEnvelopeDto> {
    const me = await this.userService.getFromAuth(req.auth ?? {});
    if (me.id !== userId) throw new ForbiddenException('You can only list your own agents.');

    const result = await this.agentService.getAll(
      userId,
      query as unknown as GetAllAgentsQuery,
    );

    const paginationMeta: PaginationMetaDto = {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };

    return {
      data: result.data.map((a) => this.toAgentResponseDto(a)),
      meta: paginationMeta,
      links: this.buildPaginationLinks(req as any, paginationMeta),
      http: this.buildHttpMeta(req as any, HttpStatus.OK, 'OK'),
    };
  }

  // -------------------------------------------------
  // Read One (200)
  //  NOTE: placed AFTER 'models/*' to avoid route conflicts.
// -------------------------------------------------
  @Get(':id')
  @ApiOperation({ summary: 'Get a specific agent by ID (auth required)' })
  @ApiOkResponse({
    description: 'The agent record.',
    content: { 'application/json': { schema: { $ref: getSchemaPath(SingleAgentEnvelopeDto) } } },
  })
  @ApiNotFoundResponse({ description: 'Agent not found.' })
  async findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: ReqWithAuth,
  ): Promise<SingleAgentEnvelopeDto> {
    const me = await this.userService.getFromAuth(req.auth ?? {});
    const agent = await this.agentService.getById(id, me.id);
    return {
      data: this.toAgentResponseDto(agent),
      links: this.buildResourceLinks(req as any, agent.id),
      meta: this.buildHttpMeta(req as any, HttpStatus.OK, 'OK'),
    };
  }

  // -------------------------------------------------
  // Update (200)
  // -------------------------------------------------
  @Patch(':id')
  @ApiOperation({ summary: 'Update an agent by ID (auth required)' })
  @ApiOkResponse({
    description: 'The agent has been successfully updated.',
    content: { 'application/json': { schema: { $ref: getSchemaPath(SingleAgentEnvelopeDto) } } },
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @ApiNotFoundResponse({ description: 'Agent not found.' })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: ReqWithAuth,
    @Body(new ZodValidationPipe(updateAgentSchema)) updateAgentDto: UpdateAgentDto,
  ): Promise<SingleAgentEnvelopeDto> {
    const me = await this.userService.getFromAuth(req.auth ?? {});
    // Support alias: apiKey -> userProvidedApiKey
    const patch: UpdateAgentDto = { ...(updateAgentDto as any) };
    if (Object.prototype.hasOwnProperty.call(updateAgentDto as any, 'apiKey')) {
      const k = String((updateAgentDto as any).apiKey ?? '').trim();
      (patch as any).userProvidedApiKey = k || null;
      delete (patch as any).apiKey;
    }
    const agent = await this.agentService.update(id, patch, me.id);
    return {
      data: this.toAgentResponseDto(agent),
      links: this.buildResourceLinks(req as any, agent.id),
      meta: this.buildHttpMeta(req as any, HttpStatus.OK, 'OK'),
    };
  }

  // -------------------------------------------------
  // Delete (204 No Content)
  // -------------------------------------------------
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an agent by ID (auth required)' })
  @ApiNoContentResponse({ description: 'The agent has been successfully deleted.' })
  @ApiNotFoundResponse({ description: 'Agent not found.' })
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: ReqWithAuth,
  ): Promise<void> {
    const me = await this.userService.getFromAuth(req.auth ?? {});
    await this.agentService.delete(id, me.id);
  }
}
