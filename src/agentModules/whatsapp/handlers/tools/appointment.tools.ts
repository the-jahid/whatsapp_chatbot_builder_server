// Deps: npm i googleapis luxon
import { Logger } from '@nestjs/common';
import { DynamicTool } from '@langchain/core/tools';
import {
  AppointmentLeadItem,
  AppointmentStatus,
  CalendarConnection,
  CalendarProvider,
  WeeklyAvailability,
} from '@prisma/client';
import { google } from 'googleapis';
import { DateTime, Interval } from 'luxon';
import { PrismaService } from 'src/prisma/prisma.service';

const TOOL_DEBUG = process.env.TOOL_DEBUG === '1';

type BuildArgs = {
  prisma: PrismaService;
  logger: Logger;
  agentId: string;
};

export async function buildAppointmentTools({
  prisma,
  logger,
  agentId,
}: BuildArgs): Promise<DynamicTool[]> {
  // Pull everything we need in one go
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: {
      bookingSettings: true,
      weeklyAvailabilities: true,
      calendarAssignments: {
        include: { calendarConnection: true },
      },
      appointmentLeadItems: true,
    },
  });

  if (!agent) {
    logger.error(`[appointment.tools] Agent not found: ${agentId}`);
    return [];
  }

  if (!agent.isBookingActive) {
    if (TOOL_DEBUG) logger.log(`[appointment.tools] Booking disabled for agent ${agentId}`);
    return [];
  }

  if (!agent.bookingSettings) {
    logger.warn(`[appointment.tools] Missing bookingSettings for agent ${agentId}`);
    return [];
  }

  const picked = pickCalendarConnection(agent);
  if (!picked) {
    logger.error(`[appointment.tools] No calendar connection/calendarId assigned to agent`);
    return [];
  }

  const validation = validateCalendarConnection(picked.conn, logger);
  if (!validation.ok) {
    logger.error(
      `[appointment.tools] CalendarConnection invalid -> tools disabled. Fatal=[${validation.fatalIssues.join(
        ', ',
      )}]`,
    );
    return [];
  }

  // Ensure we have a live access token (refresh if needed) and persist it
  let auth;
  try {
    auth = await getOAuth2Client(picked.conn, prisma, logger);
  } catch {
    logger.error(`[appointment.tools] could not refresh Google tokens; tools disabled`);
    return [];
  }
  const calendarId = picked.calendarId;

  const tz = agent.bookingSettings.timezone || 'UTC';
  const slotMin = agent.bookingSettings.appointmentSlot || 15;

  // 1) Appointment intake schema (AppointmentLeadItem)
  const getAppointmentIntakeFields = new DynamicTool({
    name: 'get_appointment_intake_fields',
    description:
      'Return the list of data fields that must be collected from the user BEFORE booking an appointment (these are AppointmentLeadItem for this agent).',
    func: async () => {
      const fields = (agent.appointmentLeadItems || []).map((f: AppointmentLeadItem) => ({
        name: f.name,
        hint: f.description ?? '',
      }));
      return JSON.stringify({ fields });
    },
  });

  // 2) Get available time (days list = approved WeeklyAvailability; slots = FreeBusy filtered)
  const getAvailableTime = new DynamicTool({
    name: 'get_available_time',
    description: `
Get available days and/or time slots for this agent.
- Call WITHOUT "day" to get upcoming calendar dates whose weekday is approved in WeeklyAvailability.
- Call WITH "day" (YYYY-MM-DD) to get time slots for that day, filtered by Google Calendar Free/Busy.
`.trim(),
    func: async (raw: string) => {
      try {
        const input = parseToolInput(raw);
        const zone = (input.timezone ?? tz) as string;

        // A) List *dates* based on approved WeeklyAvailability days
        if (!input.day) {
          const daysAhead = Number.isFinite(input.daysAhead) ? input.daysAhead : 14;

          if (!agent.weeklyAvailabilities?.length) {
            return JSON.stringify({ timezone: zone, days: [] });
          }

          const approved = getApprovedDowSet(agent.weeklyAvailabilities);
          const days = getNextApprovedDates(
            approved,
            zone,
            daysAhead,
            !!agent.bookingSettings?.allowSameDayBooking,
          );

          return JSON.stringify({ timezone: zone, days });
        }

        // B) Time slots for a chosen date
        const dayISO = DateTime.fromISO(String(input.day), { zone }).toISODate();
        if (!dayISO) return JSON.stringify({ error: 'invalid_day' });

        const todayISO = DateTime.now().setZone(zone).toISODate();
        if (!agent.bookingSettings!.allowSameDayBooking && dayISO === todayISO) {
          return JSON.stringify({ timezone: zone, day: dayISO, slots: [] });
        }

        const window = getDayWindow(agent.weeklyAvailabilities || [], dayISO, zone);
        if (!window) {
          return JSON.stringify({ timezone: zone, day: dayISO, slots: [] });
        }

        const { minLocal, maxLocal, todays } = window;
        const timeMinLocalISO = minLocal.toISO();
        const timeMaxLocalISO = maxLocal.toISO();

        const candidates = generateCandidateSlots(todays, dayISO, dayISO, slotMin, zone);
        if (!candidates.length) {
          return JSON.stringify({ timezone: zone, day: dayISO, slots: [] });
        }

        const busy = await getBusyWindowsFromGoogle(auth, calendarId, timeMinLocalISO!, timeMaxLocalISO!, logger);
        const free = filterSlotsByBusy(
          candidates.map((c) => ({ startUtc: c.startUtc, endUtc: c.endUtc })),
          busy,
          logger,
        );

        const withLocal = free.map((s) => ({
          ...s,
          localStart: DateTime.fromISO(s.startUtc).setZone(zone).toISO(),
          localEnd: DateTime.fromISO(s.endUtc).setZone(zone).toISO(),
        }));

        return JSON.stringify({ timezone: zone, day: dayISO, slots: withLocal });
      } catch (e: any) {
        if (e?.message === 'INVALID_JSON_INPUT') {
          return JSON.stringify({
            error: 'invalid_json_input',
            detail: 'Expected JSON like {"day":"YYYY-MM-DD"}',
          });
        }
        return JSON.stringify({ error: 'failed_to_fetch_availability', detail: e?.message });
      }
    },
  });

  // 3) Book appointment (writes to Google + Prisma)
  const bookAppointmentTool = new DynamicTool({
    name: 'book_appointment_tool',
    description:
      'Book an appointment for the chosen slot. Always collect "get_appointment_intake_fields" first and pass the user answers as "intakeAnswers".',
    func: async (raw: string) => {
      try {
        const input = parseToolInput(raw);
        const startUtc = DateTime.fromISO(input.startUtc).toUTC();
        const endUtc = DateTime.fromISO(input.endUtc).toUTC();
        const zone = (input.timezone ?? tz) as string;

        if (!startUtc.isValid || !endUtc.isValid || endUtc <= startUtc) {
          return JSON.stringify({ error: 'invalid_time_range' });
        }

        const busy = await getBusyWindowsFromGoogle(
          auth,
          calendarId,
          startUtc.minus({ minutes: slotMin }).toISO()!,
          endUtc.plus({ minutes: slotMin }).toISO()!,
          logger,
        );
        const overlaps = busy.some((b) =>
          Interval.fromDateTimes(b.start, b.end).overlaps(Interval.fromDateTimes(startUtc, endUtc)),
        );
        if (overlaps) return JSON.stringify({ error: 'slot_not_available' });

        const answers: Record<string, string> = input.intakeAnswers || {};
        const description = renderEventDescription(input.notes, answers);

        const calendar = google.calendar({ version: 'v3', auth });
        const res = await calendar.events.insert({
          calendarId,
          requestBody: {
            summary: input.title || `Appointment`,
            description,
            start: { dateTime: startUtc.toISO(), timeZone: 'UTC' },
            end: { dateTime: endUtc.toISO(), timeZone: 'UTC' },
            attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : undefined,
            conferenceData: { createRequest: { requestId: `req-${agentId}-${Date.now()}` } },
          },
          conferenceDataVersion: 1,
          sendUpdates: input.attendeeEmail ? 'all' : 'none',
        });

        const eventId = res.data.id!;
        const meetLink =
          res.data.hangoutLink || res.data.conferenceData?.entryPoints?.[0]?.uri || null;

        const appt = await prisma.appointment.create({
          data: {
            agentId,
            startTime: startUtc.toJSDate(),
            endTime: endUtc.toJSDate(),
            status: AppointmentStatus.CONFIRMED,
            location: meetLink ?? undefined,
            // If your Appointment model has 'timezone', you can add: timezone: zone as any,
            notes: [input.notes || '', `eventId=${eventId}`, `timezone=${zone}`]
              .filter(Boolean)
              .join('\n'),
          } as any,
        });

        return JSON.stringify({
          appointmentId: appt.id,
          googleEventId: eventId,
          meetLink,
          status: 'CONFIRMED',
        });
      } catch (e: any) {
        if (e?.message === 'INVALID_JSON_INPUT') {
          return JSON.stringify({
            error: 'invalid_json_input',
            detail: 'Expected JSON with startUtc/endUtc ISO strings and intakeAnswers object.',
          });
        }
        return JSON.stringify({ error: 'failed_to_book', detail: e?.message });
      }
    },
  });

  // Expose in a helpful order: schema → availability → booking
  return [getAppointmentIntakeFields, getAvailableTime, bookAppointmentTool];
}

/* ───────────────────────── helpers ───────────────────────── */

function parseToolInput(raw: string | undefined): any {
  if (!raw) return {};
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_e) {
    // OK
  }
  if (/^['"]?\d{4}-\d{2}-\d{2}['"]?$/.test(trimmed)) {
    const day = trimmed.replace(/^['"]|['"]$/g, '');
    return { day };
  }
  try {
    const fixed = trimmed
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3')
      .replace(/'([^']*)'/g, '"$1"');
    return JSON.parse(fixed);
  } catch (e2: any) {
    if (TOOL_DEBUG) console.error('[tool-input] parse error:', e2?.message, 'raw:', trimmed);
    throw new Error('INVALID_JSON_INPUT');
  }
}

function validateCalendarConnection(
  conn: CalendarConnection | null,
  logger: Logger,
): { ok: boolean; issues: string[]; fatalIssues: string[] } {
  const issues: string[] = [];
  const fatal: string[] = [];

  if (!conn) {
    issues.push('no_connection_assigned');
    fatal.push('no_connection_assigned');
  } else {
    if (conn.provider !== CalendarProvider.GOOGLE) {
      issues.push('provider_not_GOOGLE');
      fatal.push('provider_not_GOOGLE');
    }
    if (!conn.calendarId) {
      issues.push('missing_calendarId');
      fatal.push('missing_calendarId');
    }

    const hasRefresh = !!conn.refreshToken;
    const hasAccess = !!conn.accessToken;

    if (!hasRefresh && !hasAccess) {
      issues.push('missing_tokens');
      fatal.push('missing_tokens');
    }

    const expired =
      !!conn.accessTokenExpiresAt &&
      new Date(conn.accessTokenExpiresAt).getTime() < Date.now() - 60_000;

    if (expired) {
      if (hasRefresh) {
        issues.push('access_token_expired_will_refresh');
      } else {
        issues.push('access_token_expired');
        fatal.push('access_token_expired');
      }
    }
  }

  if (issues.length) {
    logger.error(
      `[calendar-validation] issues=[${issues.join(', ')}] account=${conn?.accountEmail ?? 'n/a'} id=${conn?.id ?? 'n/a'}`,
    );
  }
  return { ok: fatal.length === 0, issues, fatalIssues: fatal };
}

async function getOAuth2Client(conn: CalendarConnection, prisma: PrismaService, logger: Logger) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );

  client.on('tokens', async (tokens) => {
    try {
      await prisma.calendarConnection.update({
        where: { id: conn.id },
        data: {
          accessToken: tokens.access_token ?? undefined,
          accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
          refreshToken: tokens.refresh_token ?? conn.refreshToken ?? undefined,
          updatedAt: new Date(),
        },
      });
      if (TOOL_DEBUG) logger.log(`[oauth] tokens updated for ${conn.accountEmail}`);
    } catch (e: any) {
      logger.error(`[oauth] failed to persist refreshed tokens: ${e?.message}`, e?.stack);
    }
  });

  client.setCredentials({
    access_token: conn.accessToken || undefined,
    refresh_token: conn.refreshToken || undefined,
    expiry_date: conn.accessTokenExpiresAt
      ? new Date(conn.accessTokenExpiresAt).getTime()
      : undefined,
    scope:
      'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events',
  });

  try {
    await client.getAccessToken(); // refresh if needed
    if (TOOL_DEBUG) logger.log(`[oauth] access token ready for ${conn.accountEmail}`);
  } catch (e: any) {
    logger.error(`[oauth] token refresh failed: ${e?.message}`, e?.stack);
    throw new Error('OAUTH_REFRESH_FAILED');
  }

  return client;
}

function pickCalendarConnection(agent: {
  calendarAssignments: { calendarConnection: CalendarConnection | null }[];
}): { conn: CalendarConnection; calendarId: string } | null {
  const withConn = agent.calendarAssignments
    ?.map((a) => a.calendarConnection)
    .filter(Boolean) as CalendarConnection[];
  if (!withConn?.length) return null;
  const primary = withConn.find((c) => c.isPrimary && c.calendarId);
  const any = withConn.find((c) => !!c.calendarId);
  const chosen = primary ?? any;
  return chosen && chosen.calendarId ? { conn: chosen, calendarId: chosen.calendarId } : null;
}

/* Approved days helpers (days list comes only from WeeklyAvailability) */

const DOW = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

function getApprovedDowSet(weekly: WeeklyAvailability[]): Set<number> {
  const s = new Set<number>();
  for (const w of weekly ?? []) {
    const idx = DOW.indexOf(String(w.dayOfWeek));
    if (idx >= 0) s.add(idx);
  }
  return s;
}

function getNextApprovedDates(
  approved: Set<number>,
  tz: string,
  daysAhead: number,
  allowSameDay: boolean,
): string[] {
  const out: string[] = [];
  let cursor = DateTime.now().setZone(tz).startOf('day');
  const end = cursor.plus({ days: daysAhead });

  while (cursor <= end) {
    const idx = cursor.weekday % 7; // luxon: Mon=1..Sun=7 -> %7 gives 1..6,0 (Sun)
    const isApproved = approved.has(idx);
    const isToday = cursor.hasSame(DateTime.now().setZone(tz), 'day');

    if (isApproved && (allowSameDay || !isToday)) {
      out.push(cursor.toISODate()!);
    }
    cursor = cursor.plus({ days: 1 });
  }
  return out;
}

/* Slot generation & free/busy filtering */

function getDayWindow(
  weekly: WeeklyAvailability[],
  dayISO: string,
  zone: string,
): null | { minLocal: DateTime; maxLocal: DateTime; todays: WeeklyAvailability[] } {
  const day = DateTime.fromISO(dayISO, { zone });
  const dowIdx = day.weekday % 7;
  const todays = weekly.filter((w) => DOW.indexOf(String(w.dayOfWeek)) === dowIdx);
  if (!todays.length) return null;

  let minLocal: DateTime | null = null;
  let maxLocal: DateTime | null = null;
  for (const w of todays) {
    const [sh, sm] = w.startTime.split(':').map(Number);
    const [eh, em] = w.endTime.split(':').map(Number);
    const s = day.set({ hour: sh, minute: sm, second: 0, millisecond: 0 });
    const e = day.set({ hour: eh, minute: em, second: 0, millisecond: 0 });
    if (!minLocal || s < minLocal) minLocal = s;
    if (!maxLocal || e > maxLocal) maxLocal = e;
  }
  return { minLocal: minLocal!, maxLocal: maxLocal!, todays };
}

function generateCandidateSlots(
  weekly: WeeklyAvailability[],
  fromISODate: string,
  toISODate: string,
  slotMin: number,
  tz: string,
) {
  const from = DateTime.fromISO(fromISODate, { zone: tz }).startOf('day');
  const to = DateTime.fromISO(toISODate, { zone: tz }).endOf('day');

  const dayMap = new Map<number, WeeklyAvailability[]>();
  for (const w of weekly) {
    const idx = DOW.indexOf(String(w.dayOfWeek));
    if (!dayMap.has(idx)) dayMap.set(idx, []);
    dayMap.get(idx)!.push(w);
  }

  const slots: { startUtc: string; endUtc: string; localStart: string; localEnd: string }[] = [];
  for (let d = from; d <= to; d = d.plus({ days: 1 })) {
    const todaysAvail = dayMap.get(d.weekday % 7);
    if (!todaysAvail?.length) continue;

    for (const block of todaysAvail) {
      const [sh, sm] = block.startTime.split(':').map(Number);
      const [eh, em] = block.endTime.split(':').map(Number);
      let cursor = d.set({ hour: sh, minute: sm, second: 0, millisecond: 0 });
      const blockEnd = d.set({ hour: eh, minute: em, second: 0, millisecond: 0 });

      while (cursor.plus({ minutes: slotMin }) <= blockEnd) {
        const end = cursor.plus({ minutes: slotMin });
        slots.push({
  localStart: cursor.toISO() ?? '',
  localEnd: end.toISO() ?? '',
  startUtc: cursor.toUTC().toISO() ?? '',
  endUtc: end.toUTC().toISO() ?? '',
});
        cursor = end;
      }
    }
  }
  if (TOOL_DEBUG) {
    console.log(
      `[generateCandidateSlots] tz=${tz} range=[${from.toISODate()}..${to.toISODate()}] slotMin=${slotMin} generated=${slots.length}`,
    );
  }
  return slots;
}

async function getBusyWindowsFromGoogle(
  auth: any,
  calendarId: string,
  timeMinISO: string,
  timeMaxISO: string,
  logger: Logger,
) {
  try {
    if (TOOL_DEBUG) {
      logger.log(
        `[freebusy] calendarId=${calendarId} timeMin=${timeMinISO} timeMax=${timeMaxISO}`,
      );
    }
    const calendar = google.calendar({ version: 'v3', auth });
    const res = await calendar.freebusy.query({
      requestBody: { timeMin: timeMinISO, timeMax: timeMaxISO, items: [{ id: calendarId }] },
    });
    const calBusy = res.data.calendars?.[calendarId]?.busy ?? [];
    if (TOOL_DEBUG) logger.log(`[freebusy] busyCount=${calBusy.length}`);
    return (calBusy as { start: string; end: string }[]).map((b) => ({
      start: DateTime.fromISO(b.start),
      end: DateTime.fromISO(b.end),
    }));
  } catch (err: any) {
    logger.error(
      `[freebusy] ERROR ${err?.message} | code=${err?.code} | errors=${JSON.stringify(
        err?.errors,
      )}`,
      err?.stack,
    );
    throw err;
  }
}

function filterSlotsByBusy(
  slots: { startUtc: string; endUtc: string }[],
  busy: { start: DateTime; end: DateTime }[],
  logger: Logger,
) {
  const free = slots.filter((s) => {
    const sStart = DateTime.fromISO(s.startUtc);
    const sEnd = DateTime.fromISO(s.endUtc);
    return !busy.some((b) =>
      Interval.fromDateTimes(b.start, b.end).overlaps(Interval.fromDateTimes(sStart, sEnd)),
    );
  });
  if (TOOL_DEBUG)
    logger.log(`[filterSlotsByBusy] input=${slots.length} busy=${busy.length} free=${free.length}`);
  return free;
}

function renderEventDescription(baseNotes?: string, answers?: Record<string, string>) {
  const lines: string[] = [];
  if (baseNotes) lines.push(baseNotes);
  if (answers && Object.keys(answers).length) {
    lines.push('', '--- Appointment Details ---');
    for (const [k, v] of Object.entries(answers)) lines.push(`${k}: ${v}`);
  }
  return lines.join('\n');
}
