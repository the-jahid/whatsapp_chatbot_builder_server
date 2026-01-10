// ===================================================
// Free Tools Controller - Public Endpoints (No Auth)
// ===================================================
import {
    Controller,
    Post,
    Body,
    HttpCode,
    HttpStatus,
    UsePipes,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';

import { FreeToolsService } from './free-tools.service';
import { ZodValidationPipe } from 'src/common/pipes/zod.validation.pipe';
import {
    numberCheckerInputSchema,
    NumberCheckerInputDto,
    NumberCheckerResponseDto,
} from './dto/number-checker.dto';

@ApiTags('Free Tools')
@Controller('free-tools')
export class FreeToolsController {
    constructor(private readonly freeToolsService: FreeToolsService) { }

    // ===================================================
    // Number Checker - Check if Number is on WhatsApp
    // ===================================================
    @Post('number-checker')
    @HttpCode(HttpStatus.OK)
    @UsePipes(new ZodValidationPipe(numberCheckerInputSchema))
    @ApiOperation({
        summary: 'Check if a number is on WhatsApp',
        description:
            'Validates a phone number and checks if it is registered on WhatsApp using an agent session',
    })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                agentId: {
                    type: 'string',
                    format: 'uuid',
                    description: 'Agent ID with active WhatsApp session',
                },
                phoneNumber: {
                    type: 'string',
                    example: '+1234567890',
                    description: 'Phone number to check',
                },
            },
            required: ['agentId', 'phoneNumber'],
        },
    })
    @ApiResponse({
        status: 200,
        description: 'Number check result',
        type: NumberCheckerResponseDto,
    })
    async checkNumber(
        @Body() body: NumberCheckerInputDto,
    ): Promise<NumberCheckerResponseDto> {
        return this.freeToolsService.checkNumber(body.agentId, body.phoneNumber);
    }
}
