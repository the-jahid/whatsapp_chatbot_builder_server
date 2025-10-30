import { ApiProperty } from '@nestjs/swagger';

export class StartResponseData {
  @ApiProperty({ enum: ['connecting', 'open'] })
  status!: 'connecting' | 'open';

  @ApiProperty({
    required: false,
    description: 'QR code as data URL (only in QR flow)',
    example: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
  })
  qr?: string;
}

export class StartByPhoneResponseData {
  @ApiProperty({ enum: ['connecting', 'open'] })
  status!: 'connecting' | 'open';

  @ApiProperty({
    required: false,
    description: 'Pairing code to be entered on the phone',
    example: '1234-5678',
  })
  pairingCode?: string;
}

export class StatusResponseData {
  @ApiProperty({
    enum: ['connecting', 'open', 'close', 'error', 'disconnected'],
  })
  status!: 'connecting' | 'open' | 'close' | 'error' | 'disconnected';
}

export class SendMessageResponseData {
  @ApiProperty({ example: '393491234567@s.whatsapp.net' })
  to!: string;

  @ApiProperty({ example: 'BAE5F3C1E2A0CAB3...' })
  messageId!: string;
}

export class ToggleAgentResponseData {
  @ApiProperty({ example: 'd6d9a0d6-5ad5-4d3e-9a2c-3d3183b7d2a5' })
  id!: string;

  @ApiProperty({ example: 'Jane Doe' })
  name!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;
}

export class LogoutResponseData {
  @ApiProperty({ example: true })
  success!: boolean;
}
