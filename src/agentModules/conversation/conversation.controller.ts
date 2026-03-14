// src/conversation/conversation.controller.ts

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';

@ApiTags('Conversation History')
@Controller('conversations')
export class ConversationController {
  private readonly logger = new Logger(ConversationController.name);

  constructor(private readonly conversationService: ConversationService) { }

  /* -------------------------------------------------------------------------- */
  /*                           GET ALL FOR AGENT                                 */
  /* -------------------------------------------------------------------------- */

  @Get('agent/:agentId')
  @ApiOperation({ summary: "Get all conversations for a specific agent" })
  @ApiParam({ name: 'agentId', description: 'The UUID of the agent', type: 'string' })
  @ApiResponse({ status: 200, description: 'Returns all conversation history for the agent.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  async getAgentHistory(@Param('agentId', new ParseUUIDPipe()) agentId: string) {
    try {
      return await this.conversationService.findAllForAgent(agentId);
    } catch (error) {
      this.logger.error(
        `Failed to get history for agent ${agentId}: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        'Failed to retrieve agent conversation history.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                         GET ALL FOR USER (AGENT+JID)                        */
  /* -------------------------------------------------------------------------- */

  @Get('user/:agentId/:senderJid')
  @ApiOperation({ summary: "Get an agent's conversation history with a specific user" })
  @ApiParam({ name: 'agentId', description: 'The UUID of the agent', type: 'string' })
  @ApiParam({ name: 'senderJid', description: "The user's WhatsApp JID", type: 'string' })
  @ApiResponse({ status: 200, description: 'Returns the conversation history.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  async getUserHistory(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Param('senderJid') senderJid: string,
  ) {
    try {
      return await this.conversationService.findAllForUser(agentId, senderJid);
    } catch (error) {
      this.logger.error(
        `Failed to get user history for agent ${agentId} and user ${senderJid}: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        'Failed to retrieve user conversation history.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                         GET SINGLE CONVERSATION ENTRY                       */
  /* -------------------------------------------------------------------------- */

  @Get(':id')
  @ApiOperation({ summary: 'Get a single conversation message by its ID' })
  @ApiParam({ name: 'id', description: 'The CUID of the conversation message', type: 'string' })
  @ApiResponse({ status: 200, description: 'Returns the conversation message.' })
  @ApiResponse({ status: 404, description: 'Conversation not found.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  async getOne(@Param('id') id: string) {
    try {
      return await this.conversationService.findOne(id);
    } catch (error) {
      if (error instanceof HttpException) throw error;

      this.logger.error(
        `Failed to get conversation with ID ${id}: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        'Failed to retrieve conversation.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                 🔥 NEW ENDPOINT: SENT NUMBERS BY CAMPAIGN ID                */
  /* -------------------------------------------------------------------------- */

  @Get('campaign/:campaignId/sent-numbers')
  @ApiOperation({
    summary: 'Get all phone numbers that were sent outbound messages for this campaign',
  })
  @ApiParam({ name: 'campaignId', description: 'The campaign UUID', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Returns all unique phone numbers that received outbound messages.',
  })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  async getSentNumbers(@Param('campaignId') campaignId: string) {
    try {
      return await this.conversationService.getSentNumbersByCampaign(campaignId);
    } catch (error) {
      this.logger.error(
        `Failed to fetch sent numbers for campaign ${campaignId}: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        'Failed to retrieve sent numbers for this campaign.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                    🔥 PAUSED CONVERSATION ENDPOINTS                         */
  /* -------------------------------------------------------------------------- */

  @Get('agent/:agentId/paused')
  @ApiOperation({ summary: 'List all users with AI paused for this agent' })
  @ApiParam({ name: 'agentId', description: 'The UUID of the agent', type: 'string' })
  @ApiResponse({ status: 200, description: 'Returns list of paused users.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  async listPausedUsers(@Param('agentId', new ParseUUIDPipe()) agentId: string) {
    try {
      return await this.conversationService.listPausedUsers(agentId);
    } catch (error) {
      this.logger.error(
        `Failed to list paused users for agent ${agentId}: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        'Failed to list paused users.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('agent/:agentId/pause/:senderJid/status')
  @ApiOperation({ summary: 'Check if AI is paused for a specific user' })
  @ApiParam({ name: 'agentId', description: 'The UUID of the agent', type: 'string' })
  @ApiParam({ name: 'senderJid', description: "The user's WhatsApp JID", type: 'string' })
  @ApiResponse({ status: 200, description: 'Returns pause status.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  async getPauseStatus(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Param('senderJid') senderJid: string,
  ) {
    try {
      return await this.conversationService.getPauseStatus(agentId, senderJid);
    } catch (error) {
      this.logger.error(
        `Failed to get pause status: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        'Failed to get pause status.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('agent/:agentId/pause/:senderJid')
  @ApiOperation({ summary: 'Pause AI responses for a specific user (human intervention)' })
  @ApiParam({ name: 'agentId', description: 'The UUID of the agent', type: 'string' })
  @ApiParam({ name: 'senderJid', description: "The user's WhatsApp JID", type: 'string' })
  @ApiResponse({ status: 201, description: 'AI paused for user.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  async pauseAI(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Param('senderJid') senderJid: string,
    @Body() body: { reason?: string; pausedBy?: string },
  ) {
    try {
      return await this.conversationService.pauseAI(
        agentId,
        senderJid,
        body?.reason,
        body?.pausedBy,
      );
    } catch (error) {
      this.logger.error(
        `Failed to pause AI for user ${senderJid}: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        'Failed to pause AI for this user.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('agent/:agentId/pause/:senderJid')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Resume AI responses for a specific user' })
  @ApiParam({ name: 'agentId', description: 'The UUID of the agent', type: 'string' })
  @ApiParam({ name: 'senderJid', description: "The user's WhatsApp JID", type: 'string' })
  @ApiResponse({ status: 204, description: 'AI resumed for user.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  async resumeAI(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Param('senderJid') senderJid: string,
  ) {
    try {
      await this.conversationService.resumeAI(agentId, senderJid);
    } catch (error) {
      this.logger.error(
        `Failed to resume AI for user ${senderJid}: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        'Failed to resume AI for this user.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
