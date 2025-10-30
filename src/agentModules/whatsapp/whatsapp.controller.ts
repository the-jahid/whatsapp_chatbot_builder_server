// src/whatsapp/whatsapp.controller.ts
import {
  Controller,
  Get,
  Param,
  Post,
  HttpException,
  HttpStatus,
  ParseUUIDPipe,
  Body,
  Patch,
  UsePipes,
  ValidationPipe,
  HttpCode,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { WhatsappService } from './whatsapp.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsString,
  IsNotEmpty,
  MaxLength,
  Matches,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';

type ReqWithAuth = Request & {
  auth?: { clerkUserId?: string; sessionId?: string; claims?: Record<string, any> };
};

class ToggleAgentDto {
  @ApiProperty({ description: 'Set true to activate, false to deactivate' })
  @IsBoolean()
  isActive: boolean;
}

class SendMessageDto {
  @ApiProperty({
    description:
      'Destination phone (E.164-ish). Examples: +393491234567 or 393491234567',
    example: '+393491234567',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?\d{6,18}$/, {
    message:
      'Invalid phone format. Provide digits with optional leading + (6–18 digits).',
  })
  to: string;

  @ApiProperty({
    description: 'Message body',
    example: 'Ciao! Questo è un messaggio inviato dal bot 🚀',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096, { message: 'Text must be at most 4096 characters.' })
  text: string;
}

class StartByPhoneDto {
  @ApiProperty({
    description:
      'Your WhatsApp phone number for pairing (digits with optional leading +). Example: +393491234567',
    example: '+393491234567',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?\d{6,18}$/, {
    message:
      'Invalid phone format. Provide digits with optional leading + (6–18 digits).',
  })
  phone: string;
}

class ValidateQrDto {
  @ApiProperty({
    description: 'QR ticket id returned by /whatsapp/:agentId/qr/new',
    example: 'd6d9a0d6-5ad5-4d3e-9a2c-3d3183b7d2a5',
  })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  qrId: string;
}

@ApiTags('WhatsApp')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  // ----------------------------------------------------------------------------
  // NEW: Generate a fresh QR ticket (frontend calls this on an interval)
  // ----------------------------------------------------------------------------
  @Post(':agentId/qr/new')
  @ApiOperation({ summary: 'Generate a new QR code ticket for login (auto-refresh friendly)' })
  @ApiParam({ name: 'agentId', description: 'UUID of the agent', type: 'string' })
  @ApiOkResponse({
    description: 'Returns a new QR image (data URL) wrapped in a ticket id.',
    schema: {
      example: {
        statusCode: 200,
        message: 'QR generated.',
        data: {
          qrId: 'd6d9a0d6-5ad5-4d3e-9a2c-3d3183b7d2a5',
          qr: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
          expiresAt: 1712345678901,
          refreshAfterMs: 25000,
          status: 'connecting',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Agent inactive; already logged in; or QR not ready yet.',
  })
  async newQr(@Param('agentId', new ParseUUIDPipe()) agentId: string) {
    try {
      const res = await this.whatsappService.generateQr(agentId);
      return {
        statusCode: HttpStatus.OK,
        message: 'QR generated.',
        data: res,
      };
    } catch (error: any) {
      throw new HttpException(
        error?.message || 'Failed to generate QR.',
        error?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ----------------------------------------------------------------------------
  // NEW: Validate current QR ticket (optional; you can also just refresh on a timer)
  // ----------------------------------------------------------------------------
  @Post(':agentId/qr/validate')
  @ApiOperation({ summary: 'Validate a QR ticket id (still valid / expired / used / logged in)' })
  @ApiParam({ name: 'agentId', description: 'UUID of the agent', type: 'string' })
  @ApiBody({ type: ValidateQrDto })
  @ApiOkResponse({
    description: 'Returns validation result.',
    schema: {
      example: {
        statusCode: 200,
        message: 'QR valid.',
        data: { valid: true, expiresAt: 1712345678901 },
      },
    },
  })
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async validateQr(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Body() body: ValidateQrDto,
  ) {
    try {
      const res = await this.whatsappService.validateQr(agentId, body.qrId);
      return {
        statusCode: HttpStatus.OK,
        message: res.valid ? 'QR valid.' : `QR invalid${res.reason ? `: ${res.reason}` : ''}.`,
        data: res,
      };
    } catch (error: any) {
      throw new HttpException(
        error?.message || 'Failed to validate QR.',
        error?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ----------------------------------------------------------------------------
  // NEW: Poll login status (frontend checks this every 1–2s)
  // ----------------------------------------------------------------------------
  @Get(':agentId/login-status')
  @ApiOperation({ summary: 'Get current login status (open = logged in)' })
  @ApiParam({ name: 'agentId', description: 'UUID of the agent', type: 'string' })
  @ApiOkResponse({
    description: 'Returns the current status and loggedIn flag.',
    schema: {
      example: {
        statusCode: 200,
        message: 'Login successful.',
        data: { status: 'open', loggedIn: true },
      },
    },
  })
  async loginStatus(@Param('agentId', new ParseUUIDPipe()) agentId: string) {
    try {
      const res = this.whatsappService.getLoginStatus(agentId);
      return {
        statusCode: HttpStatus.OK,
        message: res.loggedIn ? 'Login successful.' : 'Not logged in yet.',
        data: res,
      };
    } catch (error: any) {
      throw new HttpException(
        error?.message || 'Failed to read login status.',
        error?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ----------------------------------------------------------------------------
  // NEW: Confirm login success (invalidates any active QR ticket if logged in)
  // ----------------------------------------------------------------------------
  @Post(':agentId/login-confirm')
  @ApiOperation({ summary: 'Confirm login success and invalidate any active QR ticket' })
  @ApiParam({ name: 'agentId', description: 'UUID of the agent', type: 'string' })
  @ApiOkResponse({
    description: 'Returns whether the session is logged in.',
    schema: {
      example: {
        statusCode: 200,
        message: 'Login confirmed.',
        data: { loggedIn: true, status: 'open' },
      },
    },
  })
  async loginConfirm(@Param('agentId', new ParseUUIDPipe()) agentId: string) {
    try {
      const res = await this.whatsappService.confirmLogin(agentId);
      return {
        statusCode: HttpStatus.OK,
        message: res.loggedIn ? 'Login confirmed.' : 'Not logged in yet.',
        data: res,
      };
    } catch (error: any) {
      throw new HttpException(
        error?.message || 'Failed to confirm login.',
        error?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ----------------------------------------------------------------------------
  // Start (QR)
  // ----------------------------------------------------------------------------
  @Post('start/:agentId')
  @ApiOperation({ summary: 'Start WhatsApp connection and (optionally) get QR code' })
  @ApiParam({ name: 'agentId', description: 'UUID of the agent', type: 'string' })
  @ApiCreatedResponse({
    description:
      'Fresh start: returns QR (when required) or open status after establishing a new connection.',
    schema: {
      example: {
        statusCode: 201,
        status: 'connecting',
        message: 'QR code received. Please scan.',
        qr: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
      },
    },
  })
  @ApiOkResponse({
    description:
      'No-op or already in progress: returns current status and message without creating a duplicate start.',
    schema: {
      example: {
        statusCode: 200,
        status: 'connecting',
        message: 'Connection process is already underway.',
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'Agent inactive; WhatsApp is paused.',
    schema: {
      example: {
        statusCode: 403,
        status: 'close',
        message: 'Agent inactive; WhatsApp is paused. Activate the agent to start.',
      },
    },
  })
  @ApiResponse({ status: 500, description: 'Failed to start WhatsApp service.' })
  async start(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Req() req: ReqWithAuth,
  ) {
    try {
      const result = await this.whatsappService.start(agentId);

      if (result?.status === 'close') {
        return {
          statusCode: HttpStatus.FORBIDDEN,
          ...result,
        };
      }

      const alreadyInProgress =
        result?.message?.toLowerCase().includes('already underway') ||
        result?.status === 'open' ||
        (result?.status === 'connecting' && !result?.qr);

      const statusCode = alreadyInProgress ? HttpStatus.OK : HttpStatus.CREATED;

      return {
        statusCode,
        ...result,
      };
    } catch (error: any) {
      throw new HttpException(
        error?.message || 'Failed to start WhatsApp service.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ----------------------------------------------------------------------------
  // Start by phone (pairing code)
  // ----------------------------------------------------------------------------
  @Post('start-by-phone/:agentId')
  @ApiOperation({
    summary:
      'Start WhatsApp using phone-number pairing (Linked devices → Link with phone number)',
  })
  @ApiParam({ name: 'agentId', description: 'UUID of the agent', type: 'string' })
  @ApiBody({ type: StartByPhoneDto })
  @ApiCreatedResponse({
    description:
      'Fresh pairing start: returns pairingCode to be entered on the phone, or open status if already connected.',
    schema: {
      example: {
        statusCode: 201,
        status: 'connecting',
        message:
          'Pairing code generated. On your phone: WhatsApp → Linked devices → Link with phone number → Enter this code.',
        pairingCode: '1234-5678',
      },
    },
  })
  @ApiOkResponse({
    description:
      'No-op or already in progress: returns current status and message without creating a duplicate start.',
    schema: {
      example: {
        statusCode: 200,
        status: 'connecting',
        message: 'Connection process is already underway.',
        pairingCode: '1234-5678',
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'Agent inactive; WhatsApp is paused.',
    schema: {
      example: {
        statusCode: 403,
        status: 'close',
        message: 'Agent inactive; WhatsApp is paused. Activate the agent to start.',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Validation error on phone input.' })
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async startByPhone(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Body() body: StartByPhoneDto,
    @Req() req: ReqWithAuth,
  ) {
    try {
      const result = await this.whatsappService.startWithPhone(agentId, body.phone);

      if (result?.status === 'close') {
        return {
          statusCode: HttpStatus.FORBIDDEN,
          ...result,
        };
      }

      const alreadyInProgress =
        result?.message?.toLowerCase().includes('already underway') ||
        result?.status === 'open' ||
        (result?.status === 'connecting' && !result?.pairingCode);

      const statusCode = alreadyInProgress ? HttpStatus.OK : HttpStatus.CREATED;

      return {
        statusCode,
        ...result,
      };
    } catch (error: any) {
      throw new HttpException(
        error?.message || 'Failed to start WhatsApp pairing flow.',
        error?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ----------------------------------------------------------------------------
  // Toggle agent active (deactivate → pause without deleting; activate → resume/ensure start)
  // ----------------------------------------------------------------------------
  @Patch('agent/:agentId/toggle')
  @ApiOperation({ summary: "Activate or deactivate an agent's chatbot functionality" })
  @ApiParam({ name: 'agentId', description: 'UUID of the agent', type: 'string' })
  @ApiBody({ type: ToggleAgentDto })
  @ApiOkResponse({
    description: 'Agent status updated successfully.',
    schema: {
      example: {
        statusCode: 200,
        message: 'Agent Jane Doe has been activated.',
        data: {
          id: 'd6d9a0d6-5ad5-4d3e-9a2c-3d3183b7d2a5',
          name: 'Jane Doe',
          isActive: true,
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid input for isActive.',
    schema: {
      example: { statusCode: 400, message: 'Invalid input: isActive must be a boolean.' },
    },
  })
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async toggleAgent(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Body() toggleDto: ToggleAgentDto,
    @Req() req: ReqWithAuth,
  ) {
    if (typeof toggleDto.isActive !== 'boolean') {
      throw new HttpException('Invalid input: isActive must be a boolean.', HttpStatus.BAD_REQUEST);
    }

    try {
      const updatedAgent = await this.whatsappService.toggleAgentStatus(agentId, toggleDto.isActive);
      return {
        statusCode: HttpStatus.OK,
        message: `Agent ${updatedAgent.name} has been ${
          updatedAgent.isActive ? 'activated' : 'deactivated'
        }.`,
        data: updatedAgent,
      };
    } catch (error: any) {
      throw new HttpException(
        error?.message || 'Failed to toggle agent status.',
        error?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ----------------------------------------------------------------------------
  // Enforce policy (sync WA state with agent.isActive) — pause/resume without deleting data
  // ----------------------------------------------------------------------------
  @Post('agent/:agentId/enforce')
  @ApiOperation({
    summary:
      'Enforce WhatsApp policy based on agent.isActive (pause without deleting when inactive; resume/start when active)',
  })
  @ApiParam({ name: 'agentId', description: 'UUID of the agent', type: 'string' })
  @ApiOkResponse({
    description: 'Returns current policy application result.',
    schema: {
      example: {
        statusCode: 200,
        message: 'Policy enforced.',
        data: { isActive: true, status: 'open', paused: false },
      },
    },
  })
  async enforcePolicy(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Req() req: ReqWithAuth,
  ) {
    try {
      const res = await this.whatsappService.enforceAgentActivePolicy(agentId);
      return {
        statusCode: HttpStatus.OK,
        message: 'Policy enforced.',
        data: res, // { isActive, status, paused }
      };
    } catch (error: any) {
      throw new HttpException(
        error?.message || 'Failed to enforce WhatsApp policy.',
        error?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ----------------------------------------------------------------------------
  // Status
  // ----------------------------------------------------------------------------
  @Get('status/:agentId')
  @ApiOperation({ summary: 'Get connection status for an agent' })
  @ApiParam({ name: 'agentId', description: 'UUID of the agent', type: 'string' })
  @ApiOkResponse({
    description: 'Returns the current WhatsApp connection status tracked in memory.',
    schema: { example: { statusCode: 200, data: { status: 'open' } } },
  })
  getStatus(@Param('agentId', new ParseUUIDPipe()) agentId: string, @Req() req: ReqWithAuth) {
    const status = this.whatsappService.getStatus(agentId);
    return { statusCode: HttpStatus.OK, data: { status } };
  }

  // ----------------------------------------------------------------------------
  // Logout
  // ----------------------------------------------------------------------------
  @Post('logout/:agentId')
  @ApiOperation({ summary: 'Logout WhatsApp session for an agent' })
  @ApiParam({ name: 'agentId', description: 'UUID of the agent', type: 'string' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description: 'Logout initiated.',
    schema: { example: { message: 'Logout process initiated.' } },
  })
  async logout(@Param('agentId', new ParseUUIDPipe()) agentId: string, @Req() req: ReqWithAuth) {
    await this.whatsappService.logout(agentId);
    return { message: 'Logout process initiated.' };
  }

  // ----------------------------------------------------------------------------
  // Send Message
  // ----------------------------------------------------------------------------
  @Post('send/:agentId')
  @ApiOperation({ summary: 'Send a WhatsApp text message to any number from an agent session' })
  @ApiParam({ name: 'agentId', description: 'UUID of the agent', type: 'string' })
  @ApiBody({ type: SendMessageDto })
  @ApiOkResponse({
    description: 'Message sent successfully.',
    schema: {
      example: {
        statusCode: 200,
        message: 'Message sent.',
        data: {
          to: '393491234567@s.whatsapp.net',
          messageId: 'BAE5F3C1E2A0CAB3...',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Validation error, session paused/inactive, or session not open.',
  })
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async sendMessage(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Body() body: SendMessageDto,
    @Req() req: ReqWithAuth,
  ) {
    try {
      const result = await this.whatsappService.sendMessage(agentId, body.to, body.text);
      return {
        statusCode: HttpStatus.OK,
        message: 'Message sent.',
        data: result,
      };
    } catch (error: any) {
      throw new HttpException(
        error?.message || 'Failed to send message.',
        error?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
