import { ApiProperty } from '@nestjs/swagger';

/** Base envelope used across all endpoints */
export class ApiEnvelopeBase {
  @ApiProperty({ example: 200 })
  code!: number;

  @ApiProperty({
    example: 'ok',
    required: false,
    enum: ['ok', 'created', 'connecting', 'open', 'close', 'error'],
  })
  status?: string;

  @ApiProperty({ example: 'Message sent.', required: false })
  message?: string;
}

/** Helper for endpoints without a data payload (rare) */
export class ApiEnvelopeVoid extends ApiEnvelopeBase {}
