// src/conversation/conversation.service.ts

import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SenderType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateConversationDto } from './dto/conversation.dto';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(private readonly prisma: PrismaService) { }

  /**
   * Creates a new conversation message in the database.
   */
  async create(createConversationDto: CreateConversationDto) {
    try {
      return await this.prisma.conversation.create({
        data: createConversationDto,
      });
    } catch (error) {
      this.logger.error(
        `Failed to create conversation. Data: ${JSON.stringify(createConversationDto)}`,
        error.stack,
      );

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          throw new NotFoundException(
            `Failed to create conversation: The specified agent does not exist.`,
          );
        }
      }

      throw new InternalServerErrorException(
        'An unexpected error occurred while creating the conversation.',
      );
    }
  }

  /**
   * Finds a single conversation by its unique ID.
   */
  async findOne(id: string) {
    try {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id },
      });

      if (!conversation) {
        throw new NotFoundException(`Conversation with ID "${id}" not found.`);
      }

      return conversation;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;

      this.logger.error(`Failed to find conversation with ID "${id}"`, error.stack);
      throw new InternalServerErrorException(
        'An unexpected error occurred while fetching the conversation.',
      );
    }
  }

  /**
   * Finds all conversation messages for a specific agent.
   */
  async findAllForAgent(agentId: string) {
    try {
      return await this.prisma.conversation.findMany({
        where: { agentId },
        orderBy: { createdAt: 'asc' },
      });
    } catch (error) {
      this.logger.error(`Failed to find conversations for agent ID "${agentId}"`, error.stack);
      throw new InternalServerErrorException(
        'An unexpected error occurred while fetching conversations.',
      );
    }
  }

  /**
   * Finds all conversation messages for a specific agent and user JID.
   */
  async findAllForUser(agentId: string, senderJid: string) {
    try {
      return await this.prisma.conversation.findMany({
        where: { agentId, senderJid },
        orderBy: { createdAt: 'asc' },
      });
    } catch (error) {
      this.logger.error(
        `Failed to find conversations for agent ID "${agentId}" and sender "${senderJid}"`,
        error.stack,
      );
      throw new InternalServerErrorException(
        'An unexpected error occurred while fetching user conversations.',
      );
    }
  }

  // ===============================================================
  // 🔥 NEW METHOD: Get all unique phone numbers for a campaign
  // ===============================================================

  /**
   * Returns all unique numbers that were sent messages (outbound AI messages)
   * for a specific campaignId based on Conversation.metadata.
   */
  async getSentNumbersByCampaign(campaignId: string) {
    try {
      const logs = await this.prisma.conversation.findMany({
        where: {
          senderType: SenderType.AI,
          metadata: {
            path: ['campaignId'],
            equals: campaignId,
          },
        },
        select: {
          senderJid: true,
          metadata: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      const extractedNumbers = logs
        .map((row) => {
          if (!row.senderJid) return null;
          return row.senderJid.replace(/@.*$/, ''); // strip @s.whatsapp.net
        })
        .filter(Boolean);

      const uniqueNumbers = [...new Set(extractedNumbers)];

      return {
        campaignId,
        total: uniqueNumbers.length,
        numbers: uniqueNumbers,
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch sent numbers for campaign "${campaignId}": ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        'Failed to retrieve sent numbers for this campaign.',
      );
    }
  }

  // ===============================================================
  // 🔥 PAUSED CONVERSATION METHODS (Human Intervention)
  // ===============================================================

  /**
   * Check if AI is paused for a specific user.
   */
  async isPaused(agentId: string, senderJid: string): Promise<boolean> {
    try {
      const paused = await this.prisma.pausedConversation.findUnique({
        where: { agentId_senderJid: { agentId, senderJid } },
      });
      return !!paused;
    } catch (error) {
      this.logger.error(
        `Failed to check paused status for agent "${agentId}" and sender "${senderJid}"`,
        error.stack,
      );
      return false; // Default to not paused on error
    }
  }

  /**
   * Pause AI responses for a specific user.
   */
  async pauseAI(
    agentId: string,
    senderJid: string,
    reason?: string,
    pausedBy?: string,
  ) {
    try {
      return await this.prisma.pausedConversation.upsert({
        where: { agentId_senderJid: { agentId, senderJid } },
        update: { reason, pausedBy, pausedAt: new Date() },
        create: { agentId, senderJid, reason, pausedBy },
      });
    } catch (error) {
      this.logger.error(
        `Failed to pause AI for agent "${agentId}" and sender "${senderJid}"`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to pause AI for this user.');
    }
  }

  /**
   * Resume AI responses for a specific user.
   */
  async resumeAI(agentId: string, senderJid: string): Promise<void> {
    try {
      await this.prisma.pausedConversation.deleteMany({
        where: { agentId, senderJid },
      });
    } catch (error) {
      this.logger.error(
        `Failed to resume AI for agent "${agentId}" and sender "${senderJid}"`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to resume AI for this user.');
    }
  }

  /**
   * List all paused users for an agent.
   */
  async listPausedUsers(agentId: string) {
    try {
      return await this.prisma.pausedConversation.findMany({
        where: { agentId },
        orderBy: { pausedAt: 'desc' },
      });
    } catch (error) {
      this.logger.error(
        `Failed to list paused users for agent "${agentId}"`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to list paused users.');
    }
  }

  /**
   * Get pause details for a specific user.
   */
  async getPauseStatus(agentId: string, senderJid: string) {
    try {
      const paused = await this.prisma.pausedConversation.findUnique({
        where: { agentId_senderJid: { agentId, senderJid } },
      });
      return {
        isPaused: !!paused,
        ...(paused && {
          reason: paused.reason,
          pausedAt: paused.pausedAt,
          pausedBy: paused.pausedBy,
        }),
      };
    } catch (error) {
      this.logger.error(
        `Failed to get pause status for agent "${agentId}" and sender "${senderJid}"`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to get pause status.');
    }
  }
}
