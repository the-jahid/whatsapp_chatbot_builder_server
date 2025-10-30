import { Controller, Post, Body, Headers, Res, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ClerkService } from './clerk.service';


@Controller('webhooks')
export class ClerkController {
  constructor(private readonly clerkService: ClerkService) {}

  @Post('clerk')
  async handleClerkWebhook(
    @Headers('svix-id') svixId: string,
    @Headers('svix-timestamp') svixTimestamp: string,
    @Headers('svix-signature') svixSignature: string,
    @Body() payload: any, // We receive the raw body
    @Res() res: Response,
  ) {
    const headers = {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    };

    try {
      // The service will handle verification and processing
      await this.clerkService.handleWebhook(headers, payload);
      // Respond with 200 OK to acknowledge receipt of the webhook
      res.status(HttpStatus.OK).send('Webhook processed successfully.');
    } catch (err) {
      console.error('Error processing Clerk webhook:', err.message);
      // Respond with an error status if something goes wrong
      res.status(HttpStatus.BAD_REQUEST).send(err.message);
    }
  }
}