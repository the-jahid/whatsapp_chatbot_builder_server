// src/modules/outbound-broadcast/outbound-broadcast.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  OutboundLeadStatus,
  TemplateMediaType,
  OutboundCampaignStatus,
  BroadcastStatus,
  SenderType,
} from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { z } from 'zod';

import { PrismaService } from 'src/prisma/prisma.service';
import { WhatsappService } from 'src/agentModules/whatsapp/whatsapp.service';
import { ConversationService } from 'src/agentModules/conversation/conversation.service';


// NOTE: CreateConversationDto likely does NOT include `metadata`, hence the payload cast below.
// import { CreateConversationDto } from 'src/conversation/dto/conversation.dto';

/* -------------------------------------------------------------------------- */
/*                         GAP-BASED SENDING (NO BATCH)                        */
/* -------------------------------------------------------------------------- */
const DEFAULT_MESSAGE_GAP_SECONDS = 120; // fallback, not used for progressive timing
const DEFAULT_ACK_TIMEOUT_MS = 90_000; // 90s

/**
 * Progressive delay pattern to avoid WhatsApp AI detection.
 * Cycles through 1-5 minute delays: 1 min -> 2 min -> 3 min -> 4 min -> 5 min -> repeat
 * Average delay = 3 minutes, allowing ~480 messages in 24 hours at steady rate
 * With daily active hours ~16-20 hours, this supports ~1000+ messages/day
 */
const PROGRESSIVE_DELAYS_SECONDS = [60, 120, 180, 240, 300]; // 1, 2, 3, 4, 5 minutes

type RenderableTemplate =
  | {
    id: string;
    name: string;
    body: string;
    variables?: string[] | null;
    mediaType?: TemplateMediaType | null;
    mediaData?: Uint8Array | Buffer | null;
    mediaMimeType?: string | null;
    mediaFileName?: string | null;
  }
  | null;

/* -------------------------------------------------------------------------- */
/*                                VALIDATION                                  */
/* -------------------------------------------------------------------------- */

const UpdateBroadcastSettingsSchema = z
  .object({
    isEnabled: z.boolean().optional(),
    isPaused: z.boolean().optional(),
    startAt: z.union([z.date(), z.string(), z.null()]).optional(),
    messageGapSeconds: z.coerce.number().int().min(0).max(86_400).optional(),
    selectedTemplateId: z.string().uuid().nullable().optional(),
    status: z.nativeEnum(BroadcastStatus).optional(),
  })
  .strict();

const SingleFieldPatchSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('selectedTemplateId'), value: z.string().uuid().nullable() }),
  z.object({ field: z.literal('isEnabled'), value: z.boolean() }),
  z.object({ field: z.literal('isPaused'), value: z.boolean() }),
  z.object({ field: z.literal('status'), value: z.nativeEnum(BroadcastStatus) }),
  z.object({ field: z.literal('startAt'), value: z.union([z.date(), z.string(), z.null()]) }),
  z.object({ field: z.literal('messageGapSeconds'), value: z.number().int().min(0).max(86_400) }),
]);

@Injectable()
export class OutboundBroadcastService {
  private readonly logger = new Logger(OutboundBroadcastService.name);

  /** Prevent overlapping passes for same broadcast */
  private readonly inFlight = new Set<string>();

  /** Track message count per broadcast for progressive delay cycling */
  private readonly broadcastMessageIndex = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly conversations: ConversationService,
  ) { }

  /* -------------------------------------------------------------------------- */
  /*                                PUBLIC API                                  */
  /* -------------------------------------------------------------------------- */

  async startCampaign(agentId: string, campaignId: string) {
    await this.assertCampaignOwnership(agentId, campaignId);

    let b = await this.prisma.broadcast.findUnique({
      where: { outboundCampaignId: campaignId },
    });

    if (!b) {
      b = await this.prisma.broadcast.create({
        data: {
          outboundCampaignId: campaignId,
          isEnabled: true,
          isPaused: false,
          status: BroadcastStatus.RUNNING,
          messageGapSeconds: DEFAULT_MESSAGE_GAP_SECONDS,
        },
      });
    } else {
      b = await this.prisma.broadcast.update({
        where: { id: b.id },
        data: { isEnabled: true, isPaused: false, status: BroadcastStatus.RUNNING },
      });
    }

    await this.prisma.outboundCampaign.update({
      where: { id: campaignId },
      data: { status: OutboundCampaignStatus.RUNNING },
    });

    const summary = await this.processBroadcastPass(agentId, campaignId, b);
    await this.completeIfFinished(campaignId, b.id);

    return { status: 'RUNNING', ...summary };
  }

  async pauseCampaign(agentId: string, campaignId: string) {
    await this.assertCampaignOwnership(agentId, campaignId);

    const b = await this.prisma.broadcast.upsert({
      where: { outboundCampaignId: campaignId },
      update: { isPaused: true, isEnabled: false, status: BroadcastStatus.PAUSED },
      create: {
        outboundCampaignId: campaignId,
        isPaused: true,
        isEnabled: false,
        status: BroadcastStatus.PAUSED,
        messageGapSeconds: DEFAULT_MESSAGE_GAP_SECONDS,
      },
    });

    await this.prisma.outboundCampaign.update({
      where: { id: campaignId },
      data: { status: OutboundCampaignStatus.SCHEDULED },
    });

    return { campaignId, broadcastId: b.id, status: 'PAUSED' as const };
  }

  async resumeCampaign(agentId: string, campaignId: string) {
    await this.assertCampaignOwnership(agentId, campaignId);

    const b = await this.ensureBroadcastRow(campaignId);
    const now = new Date();

    const effectiveStart: Date | null = b.startAt ?? null;
    const dueNow = !effectiveStart || effectiveStart <= now;

    const next =
      dueNow
        ? { status: BroadcastStatus.RUNNING, camp: OutboundCampaignStatus.RUNNING }
        : { status: BroadcastStatus.READY, camp: OutboundCampaignStatus.SCHEDULED };

    const updated = await this.prisma.broadcast.update({
      where: { id: b.id },
      data: { isPaused: false, isEnabled: true, status: next.status },
    });

    await this.prisma.outboundCampaign.update({
      where: { id: campaignId },
      data: { status: next.camp },
    });

    if (next.status === BroadcastStatus.RUNNING) {
      const summary = await this.processBroadcastPass(agentId, campaignId, updated);
      await this.completeIfFinished(campaignId, updated.id);
      return { campaignId, broadcastId: updated.id, status: 'RUNNING' as const, ...summary };
    }
    return { campaignId, broadcastId: updated.id, status: 'READY' as const };
  }

  async getCampaignStatus(campaignId: string) {
    const [camp, b] = await Promise.all([
      this.prisma.outboundCampaign.findUnique({
        where: { id: campaignId },
        select: { id: true, agentId: true, status: true },
      }),
      this.prisma.broadcast.findUnique({
        where: { outboundCampaignId: campaignId },
        select: {
          id: true,
          isEnabled: true,
          isPaused: true,
          status: true,
          startAt: true,
          selectedTemplateId: true,
          messageGapSeconds: true,
          totalQueued: true,
          totalSent: true,
          totalFailed: true,
          updatedAt: true,
          createdAt: true,
        },
      }),
    ]);
    if (!camp) throw new NotFoundException('Campaign not found');

    const counters = await this.getLeadCounters(campaignId);
    return { campaign: camp, broadcast: b, counters };
  }

  async updateBroadcastSettings(agentId: string, campaignId: string, payload: unknown) {
    await this.assertCampaignOwnership(agentId, campaignId);

    const body = UpdateBroadcastSettingsSchema.parse(payload);
    const has = (k: keyof z.infer<typeof UpdateBroadcastSettingsSchema>) =>
      Object.prototype.hasOwnProperty.call(body, k);

    if (has('selectedTemplateId') && body.selectedTemplateId) {
      await this.loadAndAuthorizeTemplate(agentId, body.selectedTemplateId);
    }

    const current = await this.ensureBroadcastRow(campaignId);

    const touchesStateWithoutTemplate =
      has('status') || has('isEnabled') || has('isPaused') || has('startAt');

    if (has('selectedTemplateId') && !touchesStateWithoutTemplate && !has('messageGapSeconds')) {
      const updated = await this.prisma.broadcast.update({
        where: { id: current.id },
        data: { selectedTemplateId: body.selectedTemplateId ?? null },
        select: this.broadcastSelect(),
      });
      return { updated };
    }

    if (!touchesStateWithoutTemplate && !has('selectedTemplateId') && has('messageGapSeconds')) {
      const updated = await this.prisma.broadcast.update({
        where: { id: current.id },
        data: { messageGapSeconds: body.messageGapSeconds },
        select: this.broadcastSelect(),
      });
      return { updated };
    }

    const now = new Date();
    const startAt =
      has('startAt')
        ? typeof body.startAt === 'string'
          ? new Date(body.startAt as string)
          : (body.startAt as Date | null)
        : undefined;

    const next: {
      broadcastStatus?: BroadcastStatus;
      campaignStatus?: OutboundCampaignStatus;
      isEnabled?: boolean;
      isPaused?: boolean;
    } = {};

    if (has('status') && body.status) {
      if (body.status === BroadcastStatus.COMPLETED) {
        throw new BadRequestException('Cannot manually set status to COMPLETED');
      }
      next.broadcastStatus = body.status;

      if (body.status === BroadcastStatus.PAUSED) {
        next.isPaused = true;
        next.isEnabled = false;
        next.campaignStatus = OutboundCampaignStatus.SCHEDULED;
      } else if (body.status === BroadcastStatus.CANCELLED) {
        next.isPaused = false;
        next.isEnabled = false;
        next.campaignStatus = OutboundCampaignStatus.CANCELLED;
      } else if (body.status === BroadcastStatus.READY) {
        const effectiveStart: Date | null = (startAt ?? current.startAt) ?? null;
        const inFuture = !!(effectiveStart && effectiveStart > now);
        next.isPaused = false;
        next.isEnabled = true;
        next.campaignStatus = inFuture
          ? OutboundCampaignStatus.SCHEDULED
          : OutboundCampaignStatus.RUNNING;
      } else if (body.status === BroadcastStatus.RUNNING) {
        next.isPaused = false;
        next.isEnabled = true;
        next.campaignStatus = OutboundCampaignStatus.RUNNING;
      }
    }

    if (!has('status') && (has('isEnabled') || has('isPaused') || has('startAt'))) {
      const toggledEnabled = has('isEnabled') ? body.isEnabled! : current.isEnabled;
      const toggledPaused = has('isPaused') ? body.isPaused! : current.isPaused;
      const effectiveStart: Date | null = (startAt ?? current.startAt) ?? null;
      const dueNow = !effectiveStart || effectiveStart <= now;

      if (!toggledEnabled) {
        next.broadcastStatus = BroadcastStatus.PAUSED;
        next.campaignStatus = OutboundCampaignStatus.SCHEDULED;
        next.isEnabled = false;
        next.isPaused = true;
      } else if (toggledPaused) {
        next.broadcastStatus = BroadcastStatus.PAUSED;
        next.campaignStatus = OutboundCampaignStatus.SCHEDULED;
        next.isEnabled = false;
        next.isPaused = true;
      } else {
        if (dueNow) {
          next.broadcastStatus = BroadcastStatus.RUNNING;
          next.campaignStatus = OutboundCampaignStatus.RUNNING;
          next.isEnabled = true;
          next.isPaused = false;
        } else {
          next.broadcastStatus = BroadcastStatus.READY;
          next.campaignStatus = OutboundCampaignStatus.SCHEDULED;
          next.isEnabled = true;
          next.isPaused = false;
        }
      }
    }

    const updateData: Prisma.BroadcastUpdateInput = {
      ...(has('isEnabled') || next.isEnabled !== undefined
        ? { isEnabled: next.isEnabled ?? body.isEnabled ?? current.isEnabled }
        : {}),
      ...(has('isPaused') || next.isPaused !== undefined
        ? { isPaused: next.isPaused ?? body.isPaused ?? current.isPaused }
        : {}),
      ...(next.broadcastStatus ? { status: next.broadcastStatus } : {}),
      ...(has('startAt') ? { startAt: startAt ?? null } : {}),
      ...(has('messageGapSeconds') ? { messageGapSeconds: body.messageGapSeconds } : {}),
      ...(has('selectedTemplateId') ? { selectedTemplateId: body.selectedTemplateId ?? null } : {}),
    };

    const updated = await this.prisma.broadcast.update({
      where: { id: current.id },
      data: updateData,
      select: this.broadcastSelect(),
    });

    if (next.campaignStatus) {
      await this.prisma.outboundCampaign.update({
        where: { id: campaignId },
        data: { status: next.campaignStatus },
      });
    }

    const shouldRun =
      (has('status') || has('isEnabled') || has('isPaused') || has('startAt')) &&
      updated.isEnabled &&
      !updated.isPaused &&
      updated.status === BroadcastStatus.RUNNING;

    if (shouldRun) {
      const camp = await this.prisma.outboundCampaign.findUnique({
        where: { id: campaignId },
        select: { agentId: true },
      });
      if (!camp) throw new NotFoundException('Campaign not found');

      const summary = await this.processBroadcastPass(camp.agentId, campaignId, updated as any);
      await this.completeIfFinished(campaignId, updated.id);
      return { updated, runSummary: summary };
    }

    return { updated };
  }

  async patchBroadcastField(agentId: string, campaignId: string, patch: unknown) {
    await this.assertCampaignOwnership(agentId, campaignId);
    const parsed = SingleFieldPatchSchema.parse(patch);

    const current = await this.ensureBroadcastRow(campaignId);

    const now = new Date();
    const data: Prisma.BroadcastUpdateInput = {};
    let nextCampaignStatus: OutboundCampaignStatus | undefined;
    let shouldRunNow = false;

    switch (parsed.field) {
      case 'selectedTemplateId': {
        const templateId = parsed.value;
        if (templateId) {
          await this.loadAndAuthorizeTemplate(agentId, templateId);
        }
        data.selectedTemplateId = templateId ?? null;
        break;
      }
      case 'messageGapSeconds': {
        data.messageGapSeconds = parsed.value;
        break;
      }
      case 'isEnabled': {
        const enabled = parsed.value;
        data.isEnabled = enabled;

        if (!enabled) {
          data.isPaused = true;
          data.status = BroadcastStatus.PAUSED;
          nextCampaignStatus = OutboundCampaignStatus.SCHEDULED;
        } else {
          const paused = current.isPaused;
          if (paused) {
            data.status = BroadcastStatus.PAUSED;
            nextCampaignStatus = OutboundCampaignStatus.SCHEDULED;
          } else {
            const effectiveStart: Date | null = current.startAt ?? null;
            const dueNow = !effectiveStart || effectiveStart <= now;
            data.status = dueNow ? BroadcastStatus.RUNNING : BroadcastStatus.READY;
            nextCampaignStatus = dueNow
              ? OutboundCampaignStatus.RUNNING
              : OutboundCampaignStatus.SCHEDULED;
            shouldRunNow = dueNow;
          }
        }
        break;
      }
      case 'isPaused': {
        const paused = parsed.value;
        data.isPaused = paused;
        if (paused) {
          data.isEnabled = false;
          data.status = BroadcastStatus.PAUSED;
          nextCampaignStatus = OutboundCampaignStatus.SCHEDULED;
        } else {
          const effectiveEnabled = current.isEnabled;
          if (effectiveEnabled) {
            const effectiveStart: Date | null = current.startAt ?? null;
            const dueNow = !effectiveStart || effectiveStart <= now;
            data.status = dueNow ? BroadcastStatus.RUNNING : BroadcastStatus.READY;
            nextCampaignStatus = dueNow
              ? OutboundCampaignStatus.RUNNING
              : OutboundCampaignStatus.SCHEDULED;
            shouldRunNow = dueNow;
          } else {
            data.status = BroadcastStatus.PAUSED;
            nextCampaignStatus = OutboundCampaignStatus.SCHEDULED;
          }
        }
        break;
      }
      case 'status': {
        const next = parsed.value;
        if (next === BroadcastStatus.COMPLETED) {
          throw new BadRequestException('Cannot manually set status to COMPLETED');
        }

        data.status = next;
        if (next === BroadcastStatus.CANCELLED) {
          data.isEnabled = false;
          data.isPaused = false;
          nextCampaignStatus = OutboundCampaignStatus.CANCELLED;
        } else if (next === BroadcastStatus.PAUSED) {
          data.isEnabled = false;
          data.isPaused = true;
          nextCampaignStatus = OutboundCampaignStatus.SCHEDULED;
        } else if (next === BroadcastStatus.READY) {
          data.isEnabled = true;
          data.isPaused = false;
          const effectiveStart: Date | null = current.startAt ?? null;
          const dueNow = !effectiveStart || effectiveStart <= now;
          nextCampaignStatus = dueNow
            ? OutboundCampaignStatus.RUNNING
            : OutboundCampaignStatus.SCHEDULED;
        } else if (next === BroadcastStatus.RUNNING) {
          data.isEnabled = true;
          data.isPaused = false;
          nextCampaignStatus = OutboundCampaignStatus.RUNNING;
          shouldRunNow = true;
        }
        break;
      }
      case 'startAt': {
        const v = parsed.value;
        const startAt =
          typeof v === 'string' ? new Date(v) : v instanceof Date ? v : v ?? null;
        data.startAt = startAt;

        if (current.isEnabled && !current.isPaused) {
          const dueNow = !startAt || startAt <= now;
          data.status = dueNow ? BroadcastStatus.RUNNING : BroadcastStatus.READY;
          nextCampaignStatus = dueNow
            ? OutboundCampaignStatus.RUNNING
            : OutboundCampaignStatus.SCHEDULED;
          shouldRunNow = dueNow;
        }
        break;
      }
    }

    const updated = await this.prisma.broadcast.update({
      where: { id: current.id },
      data,
      select: this.broadcastSelect(),
    });

    if (nextCampaignStatus) {
      await this.prisma.outboundCampaign.update({
        where: { id: campaignId },
        data: { status: nextCampaignStatus },
      });
    }

    if (shouldRunNow && updated.status === BroadcastStatus.RUNNING && updated.isEnabled && !updated.isPaused) {
      const camp = await this.prisma.outboundCampaign.findUnique({
        where: { id: campaignId },
        select: { agentId: true },
      });
      if (!camp) throw new NotFoundException('Campaign not found');

      const summary = await this.processBroadcastPass(camp.agentId, campaignId, updated as any);
      await this.completeIfFinished(campaignId, updated.id);
      return { updated, runSummary: summary };
    }

    return { updated };
  }

  /* -------------------------------------------------------------------------- */
  /*                                   CRON                                     */
  /* -------------------------------------------------------------------------- */

  @Cron(CronExpression.EVERY_SECOND)
  async cronRunner() {
    const now = new Date();

    const broadcasts = await this.prisma.broadcast.findMany({
      where: {
        isEnabled: true,
        isPaused: false,
        status: { in: [BroadcastStatus.RUNNING, BroadcastStatus.READY] },
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: now } }] },
          {
            outboundCampaign: {
              status: { in: [OutboundCampaignStatus.RUNNING, OutboundCampaignStatus.SCHEDULED] },
            },
          },
        ],
      },
      select: {
        id: true,
        outboundCampaignId: true,
        outboundCampaign: { select: { agentId: true, status: true } },
        messageGapSeconds: true,
        selectedTemplateId: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const b of broadcasts) {
      try {
        if (this.inFlight.has(b.id)) {
          this.logger.debug(`[CRON] Skip broadcast=${b.id} (in-flight)`);
          continue;
        }

        if (b.outboundCampaign.status === OutboundCampaignStatus.SCHEDULED) {
          await this.prisma.outboundCampaign.update({
            where: { id: b.outboundCampaignId },
            data: { status: OutboundCampaignStatus.RUNNING },
          });
          await this.prisma.broadcast.update({
            where: { id: b.id },
            data: { status: BroadcastStatus.RUNNING },
          });
        }

        const lastAttemptAt = await this.getLastAttemptAt(b.outboundCampaignId);
        const progressiveGapMs = this.getProgressiveDelayMs(b.id);
        if (lastAttemptAt && Date.now() - lastAttemptAt.getTime() < progressiveGapMs) {
          continue;
        }

        const summary = await this.processBroadcastPass(
          b.outboundCampaign.agentId,
          b.outboundCampaignId,
          {
            id: b.id,
            messageGapSeconds: b.messageGapSeconds ?? DEFAULT_MESSAGE_GAP_SECONDS,
            selectedTemplateId: b.selectedTemplateId ?? null,
          },
        );

        this.logger.log(
          `[CRON] Broadcast ${b.id} / Campaign ${b.outboundCampaignId} processed=${summary.processed} sent=${summary.sent} failed=${summary.failed} skipped=${summary.skipped}`,
        );

        await this.completeIfFinished(b.outboundCampaignId, b.id);
      } catch (err: any) {
        this.logger.error(`[CRON] Broadcast ${b.id} failed: ${err?.message || err}`);
      }
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                             CORE SEND PASS                                 */
  /* -------------------------------------------------------------------------- */

  private async processBroadcastPass(
    agentId: string,
    campaignId: string,
    broadcast: {
      id: string;
      messageGapSeconds?: number | null;
      selectedTemplateId?: string | null;
    },
  ) {
    if (this.inFlight.has(broadcast.id)) {
      this.logger.debug(`[PASS] Skip broadcast=${broadcast.id} (in-flight)`);
      return { processed: 0, sent: 0, failed: 0, skipped: 0, reason: 'IN_FLIGHT' as const };
    }
    this.inFlight.add(broadcast.id);

    try {
      const wa = await this.prisma.whatsapp.findUnique({ where: { agentId } });
      if (!wa || !wa.sessionData) {
        throw new BadRequestException('WhatsApp session not connected for this agent');
      }

      const lastAttemptAt = await this.getLastAttemptAt(campaignId);
      const progressiveGapMs = this.getProgressiveDelayMs(broadcast.id);
      if (lastAttemptAt && Date.now() - lastAttemptAt.getTime() < progressiveGapMs) {
        return {
          processed: 0,
          sent: 0,
          failed: 0,
          skipped: 0,
          reason: 'GAP_NOT_ELAPSED',
        };
      }

      const template = broadcast.selectedTemplateId
        ? await this.loadAndAuthorizeTemplate(agentId, broadcast.selectedTemplateId)
        : null;

      const now = new Date();
      const lead = await this.prisma.outboundLead.findFirst({
        where: {
          outboundCampaignId: campaignId,
          status: { in: [OutboundLeadStatus.QUEUED, OutboundLeadStatus.NEED_RETRY] },
          phoneNumber: { not: '' },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          phoneNumber: true,
          firstName: true,
          customFields: true,
          attemptsMade: true,
          maxAttempts: true,
          status: true,
        },
      });

      if (!lead) {
        return {
          processed: 0,
          sent: 0,
          failed: 0,
          skipped: 0,
          reason: 'NO_ELIGIBLE_RECIPIENTS',
        };
      }

      await this.prisma.outboundLead.update({
        where: { id: lead.id },
        data: {
          status: OutboundLeadStatus.IN_PROGRESS,
          attemptsMade: { increment: 1 },
          lastAttemptAt: now,
        },
      });

      const maxAttempts = typeof lead.maxAttempts === 'number' && lead.maxAttempts > 0 ? lead.maxAttempts : 3;
      const attemptsIncludingThis = (lead.attemptsMade ?? 0) + 1;
      if (attemptsIncludingThis > maxAttempts) {
        await this.prisma.outboundLead.update({
          where: { id: lead.id },
          data: { status: OutboundLeadStatus.FAILED },
        });
        await this.updateBroadcastCounters(broadcast.id, campaignId);
        return { processed: 1, sent: 0, failed: 0, skipped: 1 };
      }

      let sent = 0;
      let failed = 0;

      try {
        const text = this.renderTextForLead(lead as any, template);
        const media = this.renderMediaForTemplate(template, text);

        const sendPromise = media
          ? this.whatsappSendMedia(
            agentId,
            lead.phoneNumber!,
            media.mimeType,
            media.data,
            media.filename,
            media.caption,
          )
          : this.whatsappSendText(agentId, lead.phoneNumber!, text);

        await this.withTimeout(sendPromise, DEFAULT_ACK_TIMEOUT_MS, 'ACK_TIMEOUT');

        // ✅ conversation log payload — WIDEN TYPE to allow metadata
        // Normalize phone number by removing + prefix
        const normalizedPhone = lead.phoneNumber!.replace(/^\+/, '');
        const payload: any = {
          agentId,
          senderJid: normalizedPhone + '@s.whatsapp.net',
          senderType: SenderType.AI,
          message: media ? (media.caption ?? text) : text,
          metadata: {
            direction: 'OUTBOUND',
            campaignId,
            broadcastId: broadcast.id,
            leadId: lead.id,
            templateId: template?.id ?? null,
            media: media
              ? {
                mimeType: media.mimeType,
                filename: media.filename,
                size: media.data?.length ?? undefined,
                hasMedia: true,
              }
              : { hasMedia: false },
          },
        };

        try {
          await this.conversations.create(payload);
        } catch (logErr: any) {
          this.logger.error(
            `[CONV SAVE ERR] campaign=${campaignId} to=${lead.phoneNumber} -> ${logErr?.message || logErr}`,
          );
        }

        await this.prisma.outboundLead.update({
          where: { id: lead.id },
          data: { status: OutboundLeadStatus.MESSAGE_SUCCESSFUL },
        });

        sent += 1;
        // Advance the progressive delay index after successful send
        this.advanceProgressiveDelayIndex(broadcast.id);
        const nextDelaySec = this.getProgressiveDelaySeconds(broadcast.id);
        this.logger.log(`[SEND OK] campaign=${campaignId} to=${lead.phoneNumber} | next delay=${nextDelaySec}s`);
      } catch (err: any) {
        const terminal = attemptsIncludingThis >= maxAttempts;
        await this.prisma.outboundLead.update({
          where: { id: lead.id },
          data: { status: terminal ? OutboundLeadStatus.FAILED : OutboundLeadStatus.NEED_RETRY },
        });

        this.logger.error(
          `[SEND ERR] campaign=${campaignId} to=${lead.phoneNumber} -> ${err?.message || err}`,
        );
        failed += 1;
      }

      await this.updateBroadcastCounters(broadcast.id, campaignId);

      return { processed: 1, sent, failed, skipped: 0 };
    } finally {
      this.inFlight.delete(broadcast.id);
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                            BROADCAST COUNTERS                              */
  /* -------------------------------------------------------------------------- */

  private async updateBroadcastCounters(broadcastId: string, campaignId: string) {
    const [queued, retry, inprog, sent, failed] = await Promise.all([
      this.prisma.outboundLead.count({
        where: { outboundCampaignId: campaignId, status: OutboundLeadStatus.QUEUED },
      }),
      this.prisma.outboundLead.count({
        where: { outboundCampaignId: campaignId, status: OutboundLeadStatus.NEED_RETRY },
      }),
      this.prisma.outboundLead.count({
        where: { outboundCampaignId: campaignId, status: OutboundLeadStatus.IN_PROGRESS },
      }),
      this.prisma.outboundLead.count({
        where: { outboundCampaignId: campaignId, status: OutboundLeadStatus.MESSAGE_SUCCESSFUL },
      }),
      this.prisma.outboundLead.count({
        where: { outboundCampaignId: campaignId, status: OutboundLeadStatus.FAILED },
      }),
    ]);

    await this.prisma.broadcast.update({
      where: { id: broadcastId },
      data: {
        totalQueued: queued + retry + inprog,
        totalSent: sent,
        totalFailed: failed,
        status:
          queued + retry + inprog > 0 ? BroadcastStatus.RUNNING : BroadcastStatus.COMPLETED,
      },
    });
  }

  private async completeIfFinished(campaignId: string, broadcastId: string) {
    const { queued, retry, inprog } = await this.getLeadCounters(campaignId);
    if (queued === 0 && retry === 0 && inprog === 0) {
      await Promise.all([
        this.prisma.outboundCampaign.update({
          where: { id: campaignId },
          data: { status: OutboundCampaignStatus.COMPLETED },
        }),
        this.prisma.broadcast.update({
          where: { id: broadcastId },
          data: { status: BroadcastStatus.COMPLETED, isEnabled: false },
        }),
      ]);
      this.logger.log(`[CAMPAIGN] ${campaignId} completed`);
    }
  }

  private async getLeadCounters(campaignId: string) {
    const [queued, retry, inprog] = await Promise.all([
      this.prisma.outboundLead.count({
        where: { outboundCampaignId: campaignId, status: OutboundLeadStatus.QUEUED },
      }),
      this.prisma.outboundLead.count({
        where: { outboundCampaignId: campaignId, status: OutboundLeadStatus.NEED_RETRY },
      }),
      this.prisma.outboundLead.count({
        where: { outboundCampaignId: campaignId, status: OutboundLeadStatus.IN_PROGRESS },
      }),
    ]);
    return { queued, retry, inprog };
  }

  private async getLastAttemptAt(campaignId: string): Promise<Date | null> {
    const last = await this.prisma.outboundLead.findFirst({
      where: {
        outboundCampaignId: campaignId,
        lastAttemptAt: { not: null },
      },
      orderBy: { lastAttemptAt: 'desc' },
      select: { lastAttemptAt: true },
    });
    return (last?.lastAttemptAt as Date | null) ?? null;
  }

  /* -------------------------------------------------------------------------- */
  /*                                RENDERING                                   */
  /* -------------------------------------------------------------------------- */

  private renderTextForLead(
    lead: {
      firstName: string | null;
      phoneNumber: string | null;
      customFields: Prisma.JsonValue | null;
    },
    template: RenderableTemplate,
  ): string {
    const dict: Record<string, string> = {
      firstName: lead.firstName ?? '',
      phoneNumber: lead.phoneNumber ?? '',
      ...Object.fromEntries(
        Object.entries((lead.customFields ?? {}) as Record<string, any>).map(([k, v]) => [
          k,
          typeof v === 'string' ? v : JSON.stringify(v),
        ]),
      ),
    };

    let base = template?.body?.trim() || 'Hello {{firstName}}';
    for (const [k, v] of Object.entries(dict)) {
      base = base.replace(new RegExp(`{{\\s*${this.escapeRegExp(k)}\\s*}}`, 'g'), v ?? '');
    }
    return base;
  }

  private renderMediaForTemplate(
    template: RenderableTemplate,
    caption: string,
  ):
    | {
      mimeType: string;
      data: Buffer;
      filename: string;
      caption: string;
    }
    | null {
    if (
      template &&
      template.mediaType &&
      template.mediaType !== TemplateMediaType.NONE &&
      template.mediaData &&
      template.mediaMimeType
    ) {
      const raw = template.mediaData as Buffer | Uint8Array;
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
      return {
        mimeType: template.mediaMimeType,
        data: buf,
        filename: template.mediaFileName || 'file',
        caption,
      };
    }
    return null;
  }

  /* -------------------------------------------------------------------------- */
  /*                               IO / HELPERS                                 */
  /* -------------------------------------------------------------------------- */

  private async ensureBroadcastRow(campaignId: string) {
    const existing = await this.prisma.broadcast.findUnique({
      where: { outboundCampaignId: campaignId },
    });
    if (existing) return existing;

    return this.prisma.broadcast.create({
      data: {
        outboundCampaignId: campaignId,
        isEnabled: false,
        isPaused: false,
        status: BroadcastStatus.DRAFT,
        messageGapSeconds: DEFAULT_MESSAGE_GAP_SECONDS,
      },
    });
  }

  private async loadAndAuthorizeTemplate(
    agentId: string,
    templateId: string,
  ): Promise<RenderableTemplate> {
    const t = await this.prisma.template.findUnique({
      where: { id: templateId },
      select: {
        id: true,
        agentId: true,
        name: true,
        body: true,
        variables: true,
        mediaType: true,
        mediaData: true,
        mediaMimeType: true,
        mediaFileName: true,
      },
    });
    if (!t) throw new NotFoundException('Template not found');
    if (t.agentId !== agentId) throw new ForbiddenException('Template not owned by this agent');

    return {
      id: t.id,
      name: t.name,
      body: t.body,
      variables: (t as any).variables ?? null,
      mediaType: (t as any).mediaType ?? null,
      mediaData: (t as any).mediaData ?? null,
      mediaMimeType: (t as any).mediaMimeType ?? null,
      mediaFileName: (t as any).mediaFileName ?? null,
    };
  }

  private async assertCampaignOwnership(agentId: string, campaignId: string) {
    const owned = await this.prisma.outboundCampaign.findFirst({
      where: { id: campaignId, agentId },
      select: { id: true },
    });
    if (!owned) throw new ForbiddenException('Campaign not owned by this agent');
  }

  private broadcastSelect() {
    return {
      id: true,
      isEnabled: true,
      isPaused: true,
      status: true,
      startAt: true,
      selectedTemplateId: true,
      messageGapSeconds: true,
      totalQueued: true,
      totalSent: true,
      totalFailed: true,
      updatedAt: true,
      createdAt: true,
    } as const;
  }

  /* -------------------------------------------------------------------------- */
  /*                          PROGRESSIVE DELAY HELPERS                          */
  /* -------------------------------------------------------------------------- */

  /**
   * Get the current delay in milliseconds for a broadcast based on its message index.
   * Cycles through: 1 min (60s), 2 min (120s), 3 min (180s), 4 min (240s), 5 min (300s)
   */
  private getProgressiveDelayMs(broadcastId: string): number {
    return this.getProgressiveDelaySeconds(broadcastId) * 1000;
  }

  /**
   * Get the current delay in seconds for a broadcast based on its message index.
   */
  private getProgressiveDelaySeconds(broadcastId: string): number {
    const index = this.broadcastMessageIndex.get(broadcastId) ?? 0;
    return PROGRESSIVE_DELAYS_SECONDS[index % PROGRESSIVE_DELAYS_SECONDS.length];
  }

  /**
   * Advance the message index for progressive delay cycling.
   * Called after each successful message send.
   */
  private advanceProgressiveDelayIndex(broadcastId: string): void {
    const currentIndex = this.broadcastMessageIndex.get(broadcastId) ?? 0;
    this.broadcastMessageIndex.set(broadcastId, currentIndex + 1);
  }

  private escapeRegExp(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async whatsappSendText(agentId: string, to: string, text: string) {
    await this.whatsapp.sendText(agentId, to, text);
  }

  private async whatsappSendMedia(
    agentId: string,
    to: string,
    mimeType: string,
    data: Buffer,
    filename: string,
    caption?: string,
  ) {
    await this.whatsapp.sendMedia(agentId, to, { mimeType, data, filename, caption });
  }

  private withTimeout<T>(p: Promise<T>, ms: number, label = 'TIMEOUT'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(label)), ms);
      p.then((v) => {
        clearTimeout(t);
        resolve(v);
      }).catch((e) => {
        clearTimeout(t);
        reject(e);
      });
    });
  }
}
