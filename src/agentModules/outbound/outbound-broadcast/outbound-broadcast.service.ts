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
} from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { z } from 'zod';

import { PrismaService } from 'src/prisma/prisma.service';
import { WhatsappService } from 'src/agentModules/whatsapp/whatsapp.service';

/* -------------------------------------------------------------------------- */
/*                         GAP-BASED SENDING (NO BATCH)                        */
/* -------------------------------------------------------------------------- */
/**
 * We send exactly ONE message per pass.
 * The cadence is controlled by `broadcast.messageGapSeconds` (default 120s).
 * No other timing/wait logic is applied: if the gap is 30s, we will send
 * every ~30s (cron runs every second to honor sub-minute gaps).
 */
const DEFAULT_MESSAGE_GAP_SECONDS = 120;
const DEFAULT_ACK_TIMEOUT_MS = 90_000; // 90s

/** Relaxed template shape (handles Buffer/Uint8Array across runtimes) */
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
    // toggles
    isEnabled: z.boolean().optional(),
    isPaused: z.boolean().optional(),

    // scheduling
    startAt: z.union([z.date(), z.string(), z.null()]).optional(),

    // single-message gap (seconds)
    messageGapSeconds: z.coerce.number().int().min(0).max(86_400).optional(), // 0..24h

    // template
    selectedTemplateId: z.string().uuid().nullable().optional(),

    // manual status override (guarded below)
    status: z.nativeEnum(BroadcastStatus).optional(),
  })
  .strict();

/** Allows patching *exactly one* field, strongly typed. */
const SingleFieldPatchSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('selectedTemplateId'), value: z.string().uuid().nullable() }),
  z.object({ field: z.literal('isEnabled'), value: z.boolean() }),
  z.object({ field: z.literal('isPaused'), value: z.boolean() }),
  z.object({ field: z.literal('status'), value: z.nativeEnum(BroadcastStatus) }),
  z.object({ field: z.literal('startAt'), value: z.union([z.date(), z.string(), z.null()]) }),
  z.object({
    field: z.literal('messageGapSeconds'),
    value: z.number().int().min(0).max(86_400),
  }),
]);

@Injectable()
export class OutboundBroadcastService {
  private readonly logger = new Logger(OutboundBroadcastService.name);

  /**
   * In-process guard to prevent overlapping passes for the same broadcast.
   * (Protects against "start" + cron firing at the same time.)
   */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
  ) {}

  /* -------------------------------------------------------------------------- */
  /*                                PUBLIC API                                  */
  /* -------------------------------------------------------------------------- */

  /** Enable a campaign’s Broadcast and run an immediate pass (1 msg, gap-aware). */
  async startCampaign(agentId: string, campaignId: string) {
    await this.assertCampaignOwnership(agentId, campaignId);

    // Ensure broadcast row exists
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

    // Flip campaign to RUNNING
    await this.prisma.outboundCampaign.update({
      where: { id: campaignId },
      data: { status: OutboundCampaignStatus.RUNNING },
    });

    // Immediate pass (will respect messageGapSeconds internally)
    const summary = await this.processBroadcastPass(agentId, campaignId, b);
    await this.completeIfFinished(campaignId, b.id);

    return { status: 'RUNNING', ...summary };
  }

  /** Pause a running/scheduled broadcast. */
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

  /**
   * Resume a paused/scheduled broadcast. If startAt is in the future, sets READY/SCHEDULED;
   * otherwise sets RUNNING and triggers an immediate pass (1 msg, gap-aware).
   */
  async resumeCampaign(agentId: string, campaignId: string) {
    await this.assertCampaignOwnership(agentId, campaignId);

    const b = await this.ensureBroadcastRow(campaignId);
    const now = new Date();

    const effectiveStart: Date | null = b.startAt ?? null;
    const dueNow = !effectiveStart || effectiveStart <= now;

    const next =
      dueNow
        ? { status: BroadcastStatus.RUNNING, camp: OutboundCampaignStatus.RUNNING }
        : { status: BroadcastStatus.READY,   camp: OutboundCampaignStatus.SCHEDULED };

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

  /** UI helper for dashboard. */
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

  /**
   * Upsert/Update broadcast settings.
   * ✅ Template-only updates DO NOT change status/isEnabled/isPaused/startAt or campaign status.
   * ✅ Numeric-only updates DO NOT change status/isEnabled/isPaused/startAt or campaign status.
   * ✅ Stateful updates derive Broadcast & Campaign status consistently.
   */
  async updateBroadcastSettings(
    agentId: string,
    campaignId: string,
    payload: unknown,
  ) {
    await this.assertCampaignOwnership(agentId, campaignId);

    const body = UpdateBroadcastSettingsSchema.parse(payload);
    const has = (k: keyof z.infer<typeof UpdateBroadcastSettingsSchema>) =>
      Object.prototype.hasOwnProperty.call(body, k);

    // Validate template ownership if provided (null allowed for clearing)
    if (has('selectedTemplateId') && body.selectedTemplateId) {
      await this.loadAndAuthorizeTemplate(agentId, body.selectedTemplateId);
    }

    // Ensure row exists first
    const current = await this.ensureBroadcastRow(campaignId);

    // -------------------- TEMPLATE-ONLY (NO STATE FIELDS) --------------------
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

    // -------------------- NUMERIC-ONLY (messageGapSeconds) --------------------
    if (!touchesStateWithoutTemplate && !has('selectedTemplateId') && has('messageGapSeconds')) {
      const updated = await this.prisma.broadcast.update({
        where: { id: current.id },
        data: { messageGapSeconds: body.messageGapSeconds },
        select: this.broadcastSelect(),
      });
      return { updated };
    }

    // -------------------- STATEFUL PATH (status / toggles / startAt) ---------
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

    // Manual status override allowed only for: READY, RUNNING, PAUSED, CANCELLED
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

    // Toggle-driven derivation (ONLY when explicit status is not provided)
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
        // enabled & not paused
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
      // toggles (only when provided or derived)
      ...(has('isEnabled') || next.isEnabled !== undefined
        ? { isEnabled: next.isEnabled ?? body.isEnabled ?? current.isEnabled }
        : {}),
      ...(has('isPaused') || next.isPaused !== undefined
        ? { isPaused: next.isPaused ?? body.isPaused ?? current.isPaused }
        : {}),
      ...(next.broadcastStatus ? { status: next.broadcastStatus } : {}),

      // scheduling
      ...(has('startAt') ? { startAt: startAt ?? null } : {}),

      // numeric knob if provided together with state
      ...(has('messageGapSeconds') ? { messageGapSeconds: body.messageGapSeconds } : {}),

      // template: if they *also* send template alongside stateful fields, allow updating the id
      ...(has('selectedTemplateId') ? { selectedTemplateId: body.selectedTemplateId ?? null } : {}),
    };

    const updated = await this.prisma.broadcast.update({
      where: { id: current.id },
      data: updateData,
      select: this.broadcastSelect(),
    });

    // Update campaign status only if we actually derived one
    if (next.campaignStatus) {
      await this.prisma.outboundCampaign.update({
        where: { id: campaignId },
        data: { status: next.campaignStatus },
      });
    }

    // Only kick a pass when a stateful change *results* in RUNNING
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

  /** Patch exactly one field safely (template-only patches never alter state). */
  async patchBroadcastField(agentId: string, campaignId: string, patch: unknown) {
    await this.assertCampaignOwnership(agentId, campaignId);
    const parsed = SingleFieldPatchSchema.parse(patch);

    // Ensure broadcast exists
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
        // STRICT: template-only patch never alters status/isEnabled/isPaused/campaign status.
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

  /**
   * Runs once per second and processes exactly ONE message per eligible broadcast,
   * honoring messageGapSeconds (default 120s). No additional jitter/cooldowns.
   */
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
        // Skip if already in-flight (protect against overlap with start/resume/etc.)
        if (this.inFlight.has(b.id)) {
          this.logger.debug(`[CRON] Skip broadcast=${b.id} (in-flight)`);
          continue;
        }

        // If campaign is SCHEDULED but due, move to RUNNING
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

        // Honor message gap (check last send attempt timestamp — success or fail)
        const lastAttemptAt = await this.getLastAttemptAt(b.outboundCampaignId);
        const gapMs = (b.messageGapSeconds ?? DEFAULT_MESSAGE_GAP_SECONDS) * 1000;
        if (lastAttemptAt && Date.now() - lastAttemptAt.getTime() < gapMs) {
          continue; // too soon
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

  /**
   * Sends *one* message for a broadcast, honoring:
   * - messageGapSeconds between attempts (success or failure)
   * - lead.maxAttempts
   * - template (image+caption OR text only)
   *
   * Also uses an in-process per-broadcast lock to prevent overlapping runs.
   */
  private async processBroadcastPass(
    agentId: string,
    campaignId: string,
    broadcast: {
      id: string;
      messageGapSeconds?: number | null;
      selectedTemplateId?: string | null;
    },
  ) {
    // In-process lock (prevents overlap)
    if (this.inFlight.has(broadcast.id)) {
      this.logger.debug(`[PASS] Skip broadcast=${broadcast.id} (in-flight)`);
      return { processed: 0, sent: 0, failed: 0, skipped: 0, reason: 'IN_FLIGHT' as const };
    }
    this.inFlight.add(broadcast.id);

    try {
      // Ensure WA session
      const wa = await this.prisma.whatsapp.findUnique({ where: { agentId } });
      if (!wa || !wa.sessionData) {
        throw new BadRequestException('WhatsApp session not connected for this agent');
      }

      // Honor message gap (again, as a safety net) — based on any previous attempt
      const lastAttemptAt = await this.getLastAttemptAt(campaignId);
      const gapSec = broadcast.messageGapSeconds ?? DEFAULT_MESSAGE_GAP_SECONDS;
      if (lastAttemptAt && Date.now() - lastAttemptAt.getTime() < gapSec * 1000) {
        return {
          processed: 0,
          sent: 0,
          failed: 0,
          skipped: 0,
          reason: 'GAP_NOT_ELAPSED',
        };
      }

      // Template (optional)
      const template = broadcast.selectedTemplateId
        ? await this.loadAndAuthorizeTemplate(agentId, broadcast.selectedTemplateId)
        : null;

      // Eligible next lead (single)
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

      // Mark IN_PROGRESS & bump attempts (this also sets lastAttemptAt -> used for next gap)
      await this.prisma.outboundLead.update({
        where: { id: lead.id },
        data: {
          status: OutboundLeadStatus.IN_PROGRESS,
          attemptsMade: { increment: 1 },
          lastAttemptAt: now,
        },
      });

      // Attempts gate
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

      // Render & send
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

        await this.prisma.outboundLead.update({
          where: { id: lead.id },
          data: { status: OutboundLeadStatus.MESSAGE_SUCCESSFUL },
        });

        sent += 1;
        this.logger.log(`[SEND OK] campaign=${campaignId} to=${lead.phoneNumber}`);
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

      // Refresh counters
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
        where: {
          outboundCampaignId: campaignId,
          status: OutboundLeadStatus.MESSAGE_SUCCESSFUL,
        },
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

  /**
   * Returns the Date of the last send attempt (success or failure) for a campaign,
   * using the per-lead `lastAttemptAt` field.
   */
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
