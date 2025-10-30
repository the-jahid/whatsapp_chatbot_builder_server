// src/conversation/conversation.service.ts

import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service'; // Assuming PrismaService is in this path
import { CreateConversationDto } from './dto/conversation.dto';


@Injectable()
export class ConversationService {
  // Initialize a logger for this service
  private readonly logger = new Logger(ConversationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a new conversation message in the database.
   * @param createConversationDto - The data for the new conversation entry.
   * @returns The newly created conversation record.
   * @throws {InternalServerErrorException} if the database operation fails.
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
      // Handle potential Prisma errors, e.g., foreign key constraint violation
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // P2003 is the error code for foreign key constraint failure
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
   * @param id - The CUID of the conversation message.
   * @returns The conversation record.
   * @throws {NotFoundException} if no conversation is found.
   * @throws {InternalServerErrorException} if the database operation fails.
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
      // If it's the NotFoundException we threw, re-throw it.
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to find conversation with ID "${id}"`, error.stack);
      throw new InternalServerErrorException(
        'An unexpected error occurred while fetching the conversation.',
      );
    }
  }

  /**
   * Finds all conversation messages for a specific agent.
   * @param agentId - The UUID of the agent.
   * @returns A list of conversation messages for the agent.
   * @throws {InternalServerErrorException} if the database operation fails.
   */
  async findAllForAgent(agentId: string) {
    try {
      return await this.prisma.conversation.findMany({
        where: {
          agentId,
        },
        orderBy: {
          createdAt: 'asc',
        },
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
   * @param agentId - The UUID of the agent.
   * @param senderJid - The WhatsApp JID of the user.
   * @returns A list of conversation messages.
   * @throws {InternalServerErrorException} if the database operation fails.
   */
  async findAllForUser(agentId: string, senderJid: string) {
    try {
      return await this.prisma.conversation.findMany({
        where: {
          agentId,
          senderJid,
        },
        orderBy: {
          createdAt: 'asc',
        },
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
}
