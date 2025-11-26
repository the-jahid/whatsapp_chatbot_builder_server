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

  constructor(private readonly prisma: PrismaService) {}

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
}
