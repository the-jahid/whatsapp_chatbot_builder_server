// ===================================================
// src/agent/agent.service.ts
// Plain CRUD + filters. User scoping is passed in by controller.
// Enforces unique name per user (case-insensitive).
// Adds default prompt on create and when prompt is cleared on update.
// Chat(): provider-agnostic LLM call with BUFFER memory using historyLimit.
// Also exposes helpers to fetch provider/model enum options dynamically.
// ===================================================
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Agent,
  Prisma,
  MemoryType,
  AIModel,
  OpenAIModel,
  GeminiModel,
  ClaudeModel,
} from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { CreateAgentDto, UpdateAgentDto } from './dto/agent.dto';
import { PrismaService } from 'src/prisma/prisma.service';

export interface PaginatedAgentsResult {
  data: Agent[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Sortable fields (keep in sync with your query schema)
type AgentSortableFields =
  | 'id'
  | 'name'
  | 'prompt'
  | 'apiKey' // legacy
  | 'isActive'
  | 'memoryType'
  | 'isLeadsActive'
  | 'isEmailActive'
  | 'isKnowledgebaseActive'
  | 'isBookingActive'
  | 'useOwnApiKey'
  | 'historyLimit'
  | 'modelType'
  | 'openAIModel'
  | 'geminiModel'
  | 'claudeModel'
  | 'isVoiceResponseAvailable'   // NEW
  | 'isImageDataExtraction'      // NEW
  | 'createdAt'
  | 'updatedAt';

export interface GetAllAgentsQuery {
  // pagination
  page?: string;
  limit?: string;

  // sorting (legacy & new)
  sortBy?: AgentSortableFields;
  sortOrder?: 'asc' | 'desc';
  sort?: string; // multi: "createdAt:desc,name:asc"

  // filters
  id?: string;
  ids?: string; // csv

  isActive?: string;
  isLeadsActive?: string;
  isEmailActive?: string;
  isKnowledgebaseActive?: string;
  isBookingActive?: string;
  useOwnApiKey?: string;

  // NEW boolean filters
  isVoiceResponseAvailable?: string;
  isImageDataExtraction?: string;

  memoryType?: MemoryType | string;
  modelType?: AIModel | string;
  openAIModel?: OpenAIModel | string;
  geminiModel?: GeminiModel | string;
  claudeModel?: ClaudeModel | string;

  historyLimit?: string; // numeric

  // partial text
  name?: string;
  prompt?: string;
  apiKey?: string; // legacy text search

  // global search
  search?: string;

  // date ranges (ISO)
  createdAtFrom?: string;
  createdAtTo?: string;
  updatedAtFrom?: string;
  updatedAtTo?: string;
}

const AGENT_SORTABLE_FIELDS = new Set<AgentSortableFields>([
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
  'isVoiceResponseAvailable', // NEW
  'isImageDataExtraction',    // NEW
  'createdAt',
  'updatedAt',
]);

const MEMORY_TYPES = new Set<string>(Object.values(MemoryType));
const AI_MODELS = new Set<string>(Object.values(AIModel));
const OPENAI_MODELS = new Set<string>(Object.values(OpenAIModel));
const CLAUDE_MODELS = new Set<string>(Object.values(ClaudeModel));
const GEMINI_MODELS = new Set<string>(Object.values(GeminiModel));

/** Build a sensible default prompt when the user does not provide one. */
function buildDefaultPrompt(agentName: string): string {
  const safeName = (agentName ?? 'Assistant').trim() || 'Assistant';
  return `You are ${safeName}, a helpful, concise AI assistant.

Guidelines:
- Be clear and to the point; prefer step-by-step answers when useful.
- Ask one clarifying question if the user's request is ambiguous.
- Use Markdown for lists, tables, and code blocks when it improves readability.
- If you don’t know, say so and suggest how to find out.
- Never invent private data or unverifiable facts.`;
}

function normalizeMemoryType(mt?: string | MemoryType): MemoryType | undefined {
  if (!mt) return undefined;
  const v = String(mt).trim().toUpperCase();
  return MEMORY_TYPES.has(v) ? (v as MemoryType) : undefined;
}
function normalizeEnum<T extends string>(
  raw: string | undefined,
  set: Set<string>,
): T | undefined {
  if (!raw) return undefined;
  const v = String(raw).trim();
  return set.has(v) ? (v as T) : undefined;
}

// ---------- Model mappers (adjust if your enum values differ from vendor IDs) ----------
function mapOpenAIModel(m?: OpenAIModel | null): string {
  return (m as unknown as string) || 'gpt-4o-mini';
}
function mapClaudeModel(m?: ClaudeModel | null): string {
  return (m as unknown as string) || 'claude-3-5-sonnet-latest';
}
function mapGeminiModel(m?: GeminiModel | null): string {
  return (m as unknown as string) || 'gemini-1.5-flash';
}

// ---------- Types for history ----------
type ChatHistoryItem = { role: 'user' | 'assistant'; content: string };

// ---------- Vendor callers (now accept history) ----------
async function callOpenAIChat(opts: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  temperature: number;
  history?: ChatHistoryItem[];
}): Promise<string> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: opts.system },
  ];
  for (const h of opts.history ?? []) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: 'user', content: opts.user });

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: opts.temperature,
      messages,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => res.statusText);
    throw new ServiceUnavailableException(`OpenAI error: ${t}`);
  }
  const j: any = await res.json();
  return j?.choices?.[0]?.message?.content ?? '';
}

async function callAnthropicChat(opts: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  temperature: number;
  history?: ChatHistoryItem[];
}): Promise<string> {
  // Build messages array in Anthropic shape
  const messages: Array<{ role: 'user' | 'assistant'; content: Array<{ type: 'text'; text: string }> }> = [];
  for (const h of opts.history ?? []) {
    messages.push({
      role: h.role,
      content: [{ type: 'text', text: h.content }],
    });
  }
  messages.push({ role: 'user', content: [{ type: 'text', text: opts.user }] });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: opts.temperature,
      system: opts.system,
      messages,
      max_tokens: 1024,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => res.statusText);
    throw new ServiceUnavailableException(`Anthropic error: ${t}`);
  }
  const j: any = await res.json();
  return (
    (j?.content || [])
      .map((b: any) => (b?.type === 'text' ? b.text : ''))
      .join('') || ''
  );
}

async function callGeminiChat(opts: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  temperature: number;
  history?: ChatHistoryItem[];
}): Promise<string> {
  // Build contents in Gemini shape. We also pass systemInstruction.
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
  for (const h of opts.history ?? []) {
    contents.push({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.content }],
    });
  }
  contents.push({ role: 'user', parts: [{ text: opts.user }] });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    opts.model,
  )}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { role: 'user', parts: [{ text: opts.system }] },
      contents,
      generationConfig: { temperature: opts.temperature },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => res.statusText);
    throw new ServiceUnavailableException(`Gemini error: ${t}`);
  }
  const j: any = await res.json();
  return (
    j?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') ??
    ''
  );
}

/** Option type used by the enum listing helpers below */
type Option<T extends string> = { value: T; label: string };
function titleizeEnum(v: string): string {
  return v
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

@Injectable()
export class AgentService {
  constructor(private prisma: PrismaService) {}

  // ---------------------------------------------------
  // Helpers
  // ---------------------------------------------------
  private parseIntSafe(
    value: string | undefined,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const n = Number.parseInt(value ?? '', 10);
    if (Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  private parseBool(value?: string): boolean | undefined {
    if (value == null) return undefined;
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
    return undefined;
  }

  private parseDate(value?: string): Date | undefined {
    if (!value) return undefined;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }

  private parseCsv(value?: string): string[] | undefined {
    if (!value) return undefined;
    const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
    return parts.length ? parts : undefined;
  }

  /**
   * Supports either:
   *   - legacy: sortBy + sortOrder
   *   - new: sort="createdAt:desc,name:asc"
   */
  private parseSort(
    query: GetAllAgentsQuery,
  ): Prisma.AgentOrderByWithRelationInput[] {
    const multi = (query.sort ?? '').trim();
    if (multi) {
      const orderBys: Prisma.AgentOrderByWithRelationInput[] = [];
      for (const item of multi
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        const [fieldRaw, dirRaw] = item.split(':').map((s) => s.trim());
        const field = fieldRaw as AgentSortableFields;
        if (!AGENT_SORTABLE_FIELDS.has(field)) continue;
        const dir = dirRaw?.toLowerCase() === 'asc' ? 'asc' : 'desc';
        orderBys.push({ [field]: dir as Prisma.SortOrder });
      }
      if (orderBys.length) return orderBys;
    }

    const sortBy = (query.sortBy ?? 'createdAt') as AgentSortableFields;
    const safeField = AGENT_SORTABLE_FIELDS.has(sortBy) ? sortBy : 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
    return [{ [safeField]: sortOrder }];
  }

  private buildWhere(
    userId: string | undefined,
    q: GetAllAgentsQuery,
  ): Prisma.AgentWhereInput {
    const and: Prisma.AgentWhereInput[] = [];

    // Optional scoping by user
    if (userId) and.push({ userId });

    // IDs
    const ids = this.parseCsv(q.ids);
    if (ids?.length) and.push({ id: { in: ids } });
    else if (q.id) and.push({ id: q.id });

    // Booleans
    const isActive = this.parseBool(q.isActive);
    const isLeadsActive = this.parseBool(q.isLeadsActive);
    const isEmailActive = this.parseBool(q.isEmailActive);
    const isKbActive = this.parseBool(q.isKnowledgebaseActive);
    const isBookingActive = this.parseBool(q.isBookingActive);
    const useOwnApiKey = this.parseBool(q.useOwnApiKey);

    // NEW feature flags
    const isVoiceResponseAvailable = this.parseBool(q.isVoiceResponseAvailable);
    const isImageDataExtraction = this.parseBool(q.isImageDataExtraction);

    if (typeof isActive === 'boolean') and.push({ isActive });
    if (typeof isLeadsActive === 'boolean') and.push({ isLeadsActive });
    if (typeof isEmailActive === 'boolean') and.push({ isEmailActive });
    if (typeof isKbActive === 'boolean') and.push({ isKnowledgebaseActive: isKbActive });
    if (typeof isBookingActive === 'boolean') and.push({ isBookingActive });
    if (typeof useOwnApiKey === 'boolean') and.push({ useOwnApiKey });

    if (typeof isVoiceResponseAvailable === 'boolean') {
      and.push({ isVoiceResponseAvailable });
    }
    if (typeof isImageDataExtraction === 'boolean') {
      and.push({ isImageDataExtraction });
    }

    // Enums
    const mt = normalizeMemoryType(q.memoryType);
    if (mt) and.push({ memoryType: mt });

    const modelType = normalizeEnum<AIModel>(q.modelType, AI_MODELS);
    if (modelType) and.push({ modelType });

    const oai = normalizeEnum<OpenAIModel>(q.openAIModel, OPENAI_MODELS);
    if (oai) and.push({ openAIModel: oai });

    const claude = normalizeEnum<ClaudeModel>(q.claudeModel, CLAUDE_MODELS);
    if (claude) and.push({ claudeModel: claude });

    const gemini = normalizeEnum<GeminiModel>(q.geminiModel, GEMINI_MODELS);
    if (gemini) and.push({ geminiModel: gemini });

    // Numeric
    if (q.historyLimit != null) {
      const n = this.parseIntSafe(q.historyLimit, -1, 0, 10_000);
      if (n >= 0) and.push({ historyLimit: n });
    }

    // Partial text
    if (q.name) and.push({ name: { contains: q.name, mode: 'insensitive' } });
    if (q.prompt)
      and.push({ prompt: { contains: q.prompt, mode: 'insensitive' } });
    if (q.apiKey)
      and.push({ apiKey: { contains: q.apiKey, mode: 'insensitive' } });

    // Global search
    if (q.search) {
      const term = q.search;
      and.push({
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { prompt: { contains: term, mode: 'insensitive' } },
          { apiKey: { contains: term, mode: 'insensitive' } },
        ],
      });
    }

    // Date ranges
    const createdFrom = this.parseDate(q.createdAtFrom);
    const createdTo = this.parseDate(q.createdAtTo);
    if (createdFrom || createdTo) {
      and.push({
        createdAt: {
          ...(createdFrom ? { gte: createdFrom } : {}),
          ...(createdTo ? { lte: createdTo } : {}),
        },
      });
    }

    const updatedFrom = this.parseDate(q.updatedAtFrom);
    const updatedTo = this.parseDate(q.updatedAtTo);
    if (updatedFrom || updatedTo) {
      and.push({
        updatedAt: {
          ...(updatedFrom ? { gte: updatedFrom } : {}),
          ...(updatedTo ? { lte: updatedTo } : {}),
        },
      });
    }

    return and.length ? { AND: and } : {};
  }

  // ---------------------------------------------------
  // Queries
  // ---------------------------------------------------

  /** Generic getAll. Pass `userId` to scope to a user; omit to search globally. */
  async getAll(
    userId: string | undefined,
    query: GetAllAgentsQuery,
  ): Promise<PaginatedAgentsResult> {
    const pageNumber = this.parseIntSafe(query.page, 1, 1, 10_000);
    const limitNumber = this.parseIntSafe(query.limit, 10, 1, 1000);
    const skip = (pageNumber - 1) * limitNumber;

    const where = this.buildWhere(userId, query);
    const orderBy = this.parseSort(query);

    const [agents, total] = await this.prisma.$transaction([
      this.prisma.agent.findMany({ where, skip, take: limitNumber, orderBy }),
      this.prisma.agent.count({ where }),
    ]);

    return {
      data: agents,
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.max(1, Math.ceil(total / limitNumber)),
    };
  }

  /** Convenience for “my agents”; used by controller’s GET /agents */
  async getAllForUser(
    userId: string,
    query: GetAllAgentsQuery,
  ): Promise<PaginatedAgentsResult> {
    return this.getAll(userId, query);
  }

  async getById(id: string, userId?: string): Promise<Agent> {
    const where: Prisma.AgentWhereInput = userId
      ? { AND: [{ id }, { userId }] }
      : { id };
    const agent = await this.prisma.agent.findFirst({ where });
    if (!agent) throw new NotFoundException(`Agent with ID "${id}" not found.`);
    return agent;
  }

  async create(createAgentDto: CreateAgentDto): Promise<Agent> {
    const { userId, name } = createAgentDto;

    if (!userId || !userId.trim()) {
      throw new BadRequestException('userId is required to create an agent.');
    }
    if (!name || !name.trim()) {
      throw new BadRequestException('Agent name is required.');
    }

    const uid = userId.trim();
    const normalizedName = name.trim();

    // Ensure user exists
    const user = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!user) {
      throw new NotFoundException(
        `User with ID "${uid}" not found. Cannot create agent.`,
      );
    }

    // Enforce unique name per user (case-insensitive)
    await this.assertUniqueName(uid, normalizedName);

    // Default prompt handling
    const rawPrompt = (createAgentDto as any)?.prompt ?? '';
    const normalizedPrompt =
      typeof rawPrompt === 'string' && rawPrompt.trim().length > 0
        ? rawPrompt.trim()
        : buildDefaultPrompt(normalizedName);

    try {
      const { prompt: _ignored, name: _n, userId: _u, ...rest } =
        createAgentDto as any;
      return await this.prisma.agent.create({
        data: {
          ...rest,
          userId: uid,
          name: normalizedName,
          prompt: normalizedPrompt,
        } as any,
      });
    } catch (e: any) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(
          `An agent named "${normalizedName}" already exists for this user.`,
        );
      }
      throw e;
    }
  }

  async update(
    id: string,
    updateAgentDto: UpdateAgentDto,
    userId?: string,
  ): Promise<Agent> {
    // Ensure ownership / existence
    const current = await this.getById(id, userId);

    // Enforce name uniqueness if renaming
    let data: UpdateAgentDto = { ...updateAgentDto };

    let effectiveName = current.name;

    if (typeof updateAgentDto.name === 'string') {
      const newName = updateAgentDto.name.trim();
      await this.assertUniqueName(current.userId, newName, id);
      data = { ...data, name: newName };
      effectiveName = newName;
    }

    // Prompt semantics:
    // - omitted => keep as-is
    // - empty/whitespace => replace with default
    // - non-empty => use provided
    if (Object.prototype.hasOwnProperty.call(updateAgentDto, 'prompt')) {
      const raw = (updateAgentDto as any).prompt;
      const trimmed = (typeof raw === 'string' ? raw : '').trim();
      data = {
        ...data,
        prompt:
          trimmed.length > 0 ? trimmed : buildDefaultPrompt(effectiveName),
      } as any;
    }

    try {
      return await this.prisma.agent.update({ where: { id }, data: data as any });
    } catch (e: any) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(
          `An agent named "${(data as any)?.name}" already exists for this user.`,
        );
      }
      throw e;
    }
  }

  async delete(id: string, userId?: string): Promise<Agent> {
    await this.getById(id, userId);
    return this.prisma.agent.delete({ where: { id } });
  }

  // ---- helper to ensure unique name per user (case-insensitive)
  private async assertUniqueName(
    userId: string,
    rawName: string,
    excludeId?: string,
  ) {
    const name = rawName.trim();
    if (!name) {
      throw new ConflictException('Agent name cannot be empty.');
    }

    const existing = await this.prisma.agent.findFirst({
      where: {
        userId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        `An agent named "${name}" already exists for this user.`,
      );
    }
  }

  // ---------------------------------------------------
  // Chat (used by WhatsApp handler)
  // ---------------------------------------------------

  /** Pull `historyLimit` messages from DB for BUFFER memory. */
  private async getBufferHistory(
    agentId: string,
    threadId: string, // WhatsApp JID or your logical thread id
    limit: number,
  ): Promise<ChatHistoryItem[]> {
    if (limit <= 0) return [];
    const rows = await this.prisma.conversation.findMany({
      where: { agentId, senderJid: threadId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { senderType: true, message: true },
    });
    return rows
      .reverse()
      .map((r) => ({
        role: r.senderType === 'HUMAN' ? 'user' : 'assistant',
        content: r.message ?? '',
      }));
  }

  /**
   * Generate a reply with the agent’s configured model.
   * Signature matches WhatsApp handler usage:
   *   chat(agentId, threadId, userMessage, { temperature?, historyLimit?, systemPromptOverride?, persist? })
   */
  async chat(
    agentId: string,
    threadId: string,
    userMessage: string,
    opts?: {
      temperature?: number;
      historyLimit?: number; // override; default to agent.historyLimit
      systemPromptOverride?: string;
      persist?: boolean; // reserved for future: save human+ai to DB
    },
  ): Promise<{ text: string }> {
    if (!userMessage || !userMessage.trim()) {
      throw new BadRequestException('Message is required.');
    }

    const agent = await this.getById(agentId); // no user scoping in WA handler
    if (!agent.isActive) {
      throw new BadRequestException('Agent is inactive.');
    }

    const temperature =
      typeof opts?.temperature === 'number' ? opts.temperature : 0.3;

    // system prompt = override → agent.prompt → default
    const system =
      (opts?.systemPromptOverride ?? 
        agent.prompt ?? 
        buildDefaultPrompt(agent.name)) + '';

    // history: only if BUFFER memory
    const effectiveLimit =
      typeof opts?.historyLimit === 'number'
        ? Math.max(0, opts.historyLimit)
        : Math.max(0, agent.historyLimit ?? 0);

    const history: ChatHistoryItem[] =
      agent.memoryType === MemoryType.BUFFER && effectiveLimit > 0
        ? await this.getBufferHistory(agent.id, threadId, effectiveLimit)
        : [];

    // choose provider + key
    switch (agent.modelType) {
      case AIModel.CHATGPT: {
        const apiKey = agent.useOwnApiKey
          ? agent.userProvidedApiKey
          : process.env.OPENAI_API_KEY;
        if (!apiKey) {
          throw new ServiceUnavailableException(
            'OpenAI API key is not configured.',
          );
        }
        const model = mapOpenAIModel(agent.openAIModel);
        const text = await callOpenAIChat({
          apiKey,
          model,
          system,
          user: userMessage,
          temperature,
          history,
        });
        return { text: text || '…' };
      }

      case AIModel.CLAUDE: {
        const apiKey = agent.useOwnApiKey
          ? agent.userProvidedApiKey
          : process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          throw new ServiceUnavailableException(
            'Anthropic API key is not configured.',
          );
        }
        const model = mapClaudeModel(agent.claudeModel);
        const text = await callAnthropicChat({
          apiKey,
          model,
          system,
          user: userMessage,
          temperature,
          history,
        });
        return { text: text || '…' };
      }

      case AIModel.GEMINI: {
        const apiKey = agent.useOwnApiKey
          ? agent.userProvidedApiKey
          : process.env.GOOGLE_API_KEY;
        if (!apiKey) {
          throw new ServiceUnavailableException(
            'Google (Gemini) API key is not configured.',
          );
        }
        const model = mapGeminiModel(agent.geminiModel);
        const text = await callGeminiChat({
          apiKey,
          model,
          system,
          user: userMessage,
          temperature,
          history,
        });
        return { text: text || '…' };
      }

      default:
        throw new BadRequestException(
          `Unsupported modelType: ${agent.modelType}`,
        );
    }
  }

  // ---------------------------------------------------
  // Enum-driven model options (for dynamic UI pickers)
  // ---------------------------------------------------

  /** Providers (AIModel enum) as {value,label}[]
   *  Example: [{ value: 'CHATGPT', label: 'Chatgpt' }, ...]
   */
  listProviders(): Option<AIModel>[] {
    return (Object.values(AIModel) as AIModel[]).map((v) => ({
      value: v,
      label: titleizeEnum(v.toLowerCase()),
    }));
  }

  /** OpenAIModel enum as {value,label}[] */
  listOpenAIModels(): Option<OpenAIModel>[] {
    return (Object.values(OpenAIModel) as OpenAIModel[]).map((v) => ({
      value: v,
      label: titleizeEnum(v),
    }));
  }

  /** GeminiModel enum as {value,label}[] */
  listGeminiModels(): Option<GeminiModel>[] {
    return (Object.values(GeminiModel) as GeminiModel[]).map((v) => ({
      value: v,
      label: titleizeEnum(v),
    }));
  }

  /** ClaudeModel enum as {value,label}[] */
  listClaudeModels(): Option<ClaudeModel>[] {
    return (Object.values(ClaudeModel) as ClaudeModel[]).map((v) => ({
      value: v,
      label: titleizeEnum(v),
    }));
  }

  /** One-shot payload for building UI selectors */
  getAllModelOptions() {
    return {
      providers: this.listProviders(),
      modelsByProvider: {
        CHATGPT: this.listOpenAIModels(),
        GEMINI: this.listGeminiModels(),
        CLAUDE: this.listClaudeModels(),
      },
    };
  }
}
