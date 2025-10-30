// Deps: npm i googleapis luxon @langchain/openai zod
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { BaseMessage } from '@langchain/core/messages';
import { AgentExecutor, createOpenAIToolsAgent } from 'langchain/agents';
import { DynamicTool, type ToolInterface } from '@langchain/core/tools';

import { Agent, LeadItem, BookingSettings } from '@prisma/client';
import { createDynamicDataCollectionTool } from './tools/add-lead.toll';
import { buildAppointmentTools } from './tools/appointment.tools';

import { KnowledgebaseService } from 'src/agentModules/knowledgebase/knowledgebase.service';
import type { KnowledgeSearchMatch } from 'src/agentModules/knowledgebase/interface/knowledgebase.interface';

interface AgentWithLeadItems extends Agent {
  leadItems: LeadItem[];
  bookingSettings: BookingSettings | null;
}

interface CompactKBResult {
  rank: number;
  text: string;
  score?: number;
  title?: string;
  docId?: string;
}

@Injectable()
export class RunAgentService {
  private readonly logger = new Logger(RunAgentService.name);
  private readonly LC_VERBOSE = process.env.LC_VERBOSE === '1';

  // Token optimization constants
  private readonly DEFAULT_TOP_K = 5;
  private readonly MAX_SNIPPET_LENGTH = 700;
  private readonly MAX_CHAT_HISTORY = 8;

  constructor(
    private readonly prisma: PrismaService,
    private readonly kb: KnowledgebaseService,
  ) {}

  /**
   * Main agent execution method with optimized token usage
   */
  public async runAgent(
    userInput: string,
    chat_history: BaseMessage[],
    systemPrompt: string | null,
    agentId: string,
  ): Promise<string> {
    try {
      this.logger.log(`[runAgent] agentId=${agentId}`);

      const agentRecord = await this.fetchAgentRecord(agentId);
      if (!agentRecord) {
        return 'Error: Agent configuration not found.';
      }

      const timezone = agentRecord.bookingSettings?.timezone || 'UTC';
      this.logger.log(`[runAgent] tz=${timezone}`);

      // Initialize LLM
      const llm = new ChatOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        modelName: 'gpt-4o',
        temperature: 0,
      });

      // Build tools array
      const tools = await this.buildTools(agentRecord, agentId);

      // Optimize chat history to reduce tokens
      const optimizedHistory = this.optimizeChatHistory(chat_history);

      // Build compact system prompt
      const finalSystemPrompt = this.buildSystemPrompt(
        systemPrompt || agentRecord.prompt,
        timezone,
        agentRecord,
      );

      if (tools.length > 0) {
        return await this.runAgentWithTools(
          userInput,
          optimizedHistory,
          finalSystemPrompt,
          llm,
          tools,
        );
      }

      return await this.runSimpleChat(userInput, optimizedHistory, finalSystemPrompt, llm);
    } catch (error: any) {
      this.logger.error(`[runAgent] ${error.message}`, error.stack);
      return 'An error occurred. Please try again.';
    }
  }

  /**
   * Fetch agent record with relations
   */
  private async fetchAgentRecord(agentId: string): Promise<AgentWithLeadItems | null> {
    try {
      return (await this.prisma.agent.findUnique({
        where: { id: agentId },
        include: {
          leadItems: true,
          bookingSettings: true,
        },
      })) as AgentWithLeadItems | null;
    } catch (error: any) {
      this.logger.error(`[fetchAgentRecord] ${error.message}`);
      return null;
    }
  }

  /**
   * Build all tools based on agent configuration
   */
  private async buildTools(
    agentRecord: AgentWithLeadItems,
    agentId: string,
  ): Promise<ToolInterface[]> {
    const tools: ToolInterface[] = [];

    // 1. KB search tool (always included, high priority)
    tools.push(this.buildSearchKnowledgebaseTool(agentId));

    // 2. Lead capture tool (conditional)
    if (agentRecord.isLeadsActive && agentRecord.leadItems?.length > 0) {
      const leadTool = this.buildLeadTool(agentRecord, agentId);
      if (leadTool) tools.push(leadTool);
    }

    // 3. Appointment tools (conditional)
    if (agentRecord.isBookingActive) {
      const apptTools = await buildAppointmentTools({
        prisma: this.prisma,
        logger: this.logger,
        agentId,
      });
      tools.push(...(apptTools as unknown as ToolInterface[]));
    }

    this.logger.log(`[buildTools] ${tools.length} tools enabled`);
    return tools;
  }

  /**
   * Build lead capture tool
   */
  private buildLeadTool(
    agentRecord: AgentWithLeadItems,
    agentId: string,
  ): ToolInterface | null {
    try {
      const fieldsForTool = agentRecord.leadItems.map((item) => ({
        ...item,
        description: item.description ?? `Info for ${item.name}`,
      }));

      const dataCollectionTool = createDynamicDataCollectionTool({
        fields: fieldsForTool,
        prisma: this.prisma,
        agentId,
        logger: this.logger,
      });

      this.logger.log(`[buildLeadTool] ${fieldsForTool.length} fields`);
      return dataCollectionTool as unknown as ToolInterface;
    } catch (error: any) {
      this.logger.error(`[buildLeadTool] ${error.message}`);
      return null;
    }
  }

  /**
   * Build optimized KB search tool using DynamicTool (avoids TS2589 error)
   */
  private buildSearchKnowledgebaseTool(agentId: string): ToolInterface {
    return new DynamicTool({
      name: 'searchknowledgebase',
      description:
        'Search KB for info. Use FIRST before answering. ' +
        'Input: JSON {"query":"search terms","topK":5} or plain text query.',
      func: async (input: string): Promise<string> => {
        try {
          // Parse input - handles both JSON and plain text
          let query: string;
          let topK: number;

          try {
            const parsed = JSON.parse(input);
            query = parsed.query || input;
            topK = parsed.topK ?? this.DEFAULT_TOP_K;
          } catch {
            // Not JSON, treat as plain query
            query = input;
            topK = this.DEFAULT_TOP_K;
          }

          this.logger.log(`[KBTool] q="${query}" n=${topK}`);

          const matches: KnowledgeSearchMatch[] = await this.kb.search(agentId, {
            query,
            topK,
            includeMetadata: true,
          });

          // Handle empty results
          if (matches.length === 0) {
            return JSON.stringify({ results: [], msg: 'No results' });
          }

          // Build compact results
          const compact: CompactKBResult[] = matches.slice(0, topK).map((m, idx) => {
            const mm: any = m;
            
            // Extract text content from various possible fields
            const textCandidate =
              typeof mm.content === 'string' ? mm.content :
              typeof mm.text === 'string' ? mm.text :
              typeof mm.snippet === 'string' ? mm.snippet :
              typeof mm.metadata?.content === 'string' ? mm.metadata.content :
              JSON.stringify(mm.metadata ?? {});

            // Truncate to max length
            const text =
              textCandidate.length > this.MAX_SNIPPET_LENGTH
                ? textCandidate.slice(0, this.MAX_SNIPPET_LENGTH) + '…'
                : textCandidate;

            // Build minimal result object
            const result: CompactKBResult = {
              rank: idx + 1,
              text,
            };

            // Only add optional fields if they exist
            if (mm.score != null) result.score = Math.round(mm.score * 100) / 100;
            if (mm.metadata?.title) result.title = mm.metadata.title;
            if (mm.id || mm.metadata?.documentId) {
              result.docId = mm.id ?? mm.metadata.documentId;
            }

            return result;
          });

          return JSON.stringify({ results: compact }, null, 0);
        } catch (error: any) {
          this.logger.error(`[KBTool] ${error.message}`);
          return JSON.stringify({ results: [], error: 'Search failed' });
        }
      },
    }) as unknown as ToolInterface;
  }

  /**
   * Build compact, optimized system prompt
   */
  private buildSystemPrompt(
    basePrompt: string | null,
    timezone: string,
    agentRecord: AgentWithLeadItems,
  ): string {
    const base = basePrompt || 'You are a helpful assistant.';
    
    const sections: string[] = [
      `# Context\nTZ: ${timezone}. All times use this TZ.`,
      '\n# Rules',
      '1. ALWAYS search KB first (call "searchknowledgebase")',
      '2. If no KB results, say "Not in KB" then help if appropriate',
      '3. Never fabricate KB content',
    ];

    // Add lead instructions if enabled
    if (agentRecord.isLeadsActive && agentRecord.leadItems?.length > 0) {
      sections.push(
        '\n# Leads',
        'Call "get_lead_fields" → ask each → "submit_lead_answers" with all answers',
        'If fails: ask missing fields only',
      );
    }

    // Add booking instructions if enabled
    if (agentRecord.isBookingActive) {
      sections.push(
        '\n# Booking',
        '"get_available_time" (no day) → show dates → call again (with day) → slots',
        '"get_appointment_intake_fields" → ask each → use as "intakeAnswers"',
        'Confirm → "book_appointment_tool"',
        'Keep leads separate from booking intake',
      );
    }

    return base + '\n\n' + sections.join('\n');
  }

  /**
   * Optimize chat history to reduce token usage
   * Keep only recent messages and system context
   */
  private optimizeChatHistory(messages: BaseMessage[]): BaseMessage[] {
    if (messages.length <= this.MAX_CHAT_HISTORY) {
      return messages;
    }

    // Keep most recent messages
    const recent = messages.slice(-this.MAX_CHAT_HISTORY);
    this.logger.log(
      `[optimizeHistory] Reduced ${messages.length} → ${recent.length} messages`,
    );
    
    return recent;
  }

  /**
   * Run agent with tools
   */
  private async runAgentWithTools(
    input: string,
    chat_history: BaseMessage[],
    system: string,
    llm: ChatOpenAI,
    tools: ToolInterface[],
  ): Promise<string> {
    try {
      const prompt = ChatPromptTemplate.fromMessages([
        ['system', system],
        new MessagesPlaceholder('chat_history'),
        ['human', '{input}'],
        new MessagesPlaceholder('agent_scratchpad'),
      ]);

      const agent = await createOpenAIToolsAgent({ llm, tools, prompt });

      const agentExecutor = new AgentExecutor({
        agent,
        tools,
        verbose: this.LC_VERBOSE,
        returnIntermediateSteps: false,
        handleParsingErrors: true,
        maxIterations: 8,
      });

      const result = await agentExecutor.invoke({ input, chat_history });
      return (result as any).output ?? result;
    } catch (error: any) {
      this.logger.error(`[runAgentWithTools] ${error.message}`);
      throw error;
    }
  }

  /**
   * Run simple chat without tools
   */
  private async runSimpleChat(
    input: string,
    chat_history: BaseMessage[],
    system: string,
    llm: ChatOpenAI,
  ): Promise<string> {
    try {
      const prompt = ChatPromptTemplate.fromMessages([
        ['system', system],
        new MessagesPlaceholder('chat_history'),
        ['human', '{input}'],
      ]);

      const chain = prompt.pipe(llm);
      const result = await chain.invoke({ input, chat_history });
      return result.content.toString();
    } catch (error: any) {
      this.logger.error(`[runSimpleChat] ${error.message}`);
      throw error;
    }
  }
}