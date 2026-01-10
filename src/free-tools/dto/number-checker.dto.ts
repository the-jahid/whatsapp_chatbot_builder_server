import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

// ===================================================
// Number Checker - Input Schema & DTO
// ===================================================

export const numberCheckerInputSchema = z.object({
    agentId: z.string().uuid('agentId must be a valid UUID'),
    phoneNumber: z
        .string()
        .min(1, 'Phone number is required')
        .max(20, 'Phone number too long'),
});

export type NumberCheckerInputDto = z.infer<typeof numberCheckerInputSchema>;

// ===================================================
// Number Checker - Response DTO
// ===================================================

export class NumberCheckerResponseDto {
    @ApiProperty({ example: true, description: 'Whether the phone number format is valid' })
    isValid!: boolean;

    @ApiProperty({ example: true, description: 'Whether the number is registered on WhatsApp' })
    isOnWhatsApp!: boolean;

    @ApiProperty({ example: '+1234567890' })
    formattedNumber!: string;

    @ApiProperty({ example: '1' })
    countryCode!: string;

    @ApiProperty({ example: 'US' })
    countryName!: string;

    @ApiProperty({ example: '2345678901' })
    nationalNumber!: string;

    @ApiProperty({ example: '1234567890@s.whatsapp.net', nullable: true, required: false })
    whatsappJid?: string;

    @ApiProperty({ example: 'Invalid phone number format', nullable: true, required: false })
    error?: string;
}
