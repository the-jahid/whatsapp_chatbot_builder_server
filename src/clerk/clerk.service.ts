import { Injectable, BadRequestException } from '@nestjs/common';
import { Webhook } from 'svix';
import { UserService } from '../user/services/user.service';
import { WebhookEvent } from '@clerk/clerk-sdk-node';

@Injectable()
export class ClerkService {
  private readonly webhookSecret = process.env.CLERK_WEBHOOK_SECRET;

  constructor(private readonly userService: UserService) {
    if (!this.webhookSecret) {
      throw new Error('CLERK_WEBHOOK_SECRET environment variable not set.');
    }
  }

  async handleWebhook(headers: any, payload: any) {
    const wh = new Webhook(this.webhookSecret as string);
    let evt: WebhookEvent;

    try {
      evt = wh.verify(JSON.stringify(payload), headers) as WebhookEvent;
    } catch (err) {
      throw new BadRequestException('Webhook signature verification failed.');
    }

    const eventType = evt.type;
    console.log(`[Clerk Webhook] Received event: ${eventType}`);

    // --- CREATE User ---
    if (eventType === 'user.created') {
      const email = evt.data.email_addresses[0]?.email_address;
      if (!email) {
        throw new BadRequestException('Email not found in webhook payload.');
      }
      await this.userService.createUser({
        oauthId: evt.data.id,
        email: email,
        username: evt.data.username ?? undefined,
      });
    }

    // --- UPDATE User ---
    if (eventType === 'user.updated') {
      await this.userService.updateUser(evt.data.id, {
        username: evt.data.username ?? undefined,
        // You can add more fields to update here as needed
      });
    }

    // --- DELETE User ---
    if (eventType === 'user.deleted') {
      // The payload for deleted events might be smaller
      if (!evt.data.id) {
        throw new BadRequestException('User ID not found in delete event.');
      }
      await this.userService.deleteUser(evt.data.id);
    }
  }
}