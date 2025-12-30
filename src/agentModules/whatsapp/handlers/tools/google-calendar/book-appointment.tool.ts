import { DynamicTool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { DateTime, Interval } from 'luxon';
import { PrismaService } from 'src/prisma/prisma.service';
import { AppointmentStatus } from '@prisma/client';
import { z } from 'zod';
import {
    renderEventDescription,
    getBusyWindowsFromGoogle,
    createGoogleCalendarEvent,
} from './index';

const TOOL_DEBUG = process.env.TOOL_DEBUG === '1';

type BookAppointmentToolDeps = {
    agentId: string;
    auth: any;
    calendarId: string;
    tz: string;
    slotMin: number;
    logger: Logger;
    prisma: PrismaService;
};

export function createBookAppointmentTool({
    agentId,
    auth,
    calendarId,
    tz,
    slotMin,
    logger,
    prisma,
}: BookAppointmentToolDeps) {
    console.log('[book_appointment_tool] CALLED with raw:', agentId, auth, calendarId, tz, slotMin, logger, prisma);

    const schema = z.object({
        startUtc: z.string().describe('ISO string date-time of the appointment start (UTC)'),
        endUtc: z.string().describe('ISO string date-time of the appointment end (UTC)'),
        email: z.string().optional().describe('User email address (optional)'),
        name: z.string().optional().describe('User name (optional)'),
        phone: z.string().optional().describe('User phone number (optional)'),
        notes: z.string().optional().describe('Any specific notes or request details'),
        intakeAnswers: z.record(z.string()).optional().describe('Key-value pairs of collected intake answers'),
        title: z.string().optional().describe('Title of the appointment'),
        timezone: z.string().optional().describe('Timezone of the user'),
    });

    const tool = new DynamicTool({
        name: 'book_appointment_tool',
        description:
            'Book an appointment. Input MUST be a structured JSON object matching the schema. Collect detailed info first.',
        func: async (input: any) => {
            console.log('[book_appointment_tool] CALLED with input:', JSON.stringify(input, null, 2));
            try {
                // schema validation is handled by LangChain/OpenAI implicitly if we provide the schema,
                // but we can double check or just use 'input' directly since it comes parsed.

                const zone = (input.timezone ?? tz) as string;
                const startUtc = DateTime.fromISO(input.startUtc, { zone }).toUTC();
                const endUtc = DateTime.fromISO(input.endUtc, { zone }).toUTC();

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

                const validEmail = input.email || answers.email;

                // Ensure intakeAnswers exists
                if (!input.intakeAnswers) {
                    input.intakeAnswers = {
                        name: input.name,
                        email: validEmail,
                        phone: input.phone,
                    };
                }

                const res = await createGoogleCalendarEvent(
                    auth,
                    calendarId,
                    input.title || `Appointment`,
                    description,
                    startUtc,
                    endUtc,
                    validEmail
                );

                console.log('calendar_response', res)
                const eventId = res.data.id!;
                const meetLink = null;
                // res.data.hangoutLink || res.data.conferenceData?.entryPoints?.[0]?.uri || null;

                const appt = await prisma.appointment.create({
                    data: {
                        agentId,
                        startTime: startUtc.toJSDate(),
                        endTime: endUtc.toJSDate(),
                        status: AppointmentStatus.CONFIRMED,
                        location: meetLink ?? undefined,
                        notes: [input.notes || '', `eventId=${eventId}`, `timezone=${zone}`, `attendee=${validEmail || 'none'}`]
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
                console.error('[BOOKING_ERROR] Full error:', JSON.stringify(e, null, 2));
                console.error('[BOOKING_ERROR] Message:', e?.message);
                if (e?.response) {
                    console.error('[BOOKING_ERROR] Response data:', JSON.stringify(e.response.data, null, 2));
                }

                return JSON.stringify({ error: 'failed_to_book', detail: e?.message });
            }
        },
    });

    // WORKAROUND: Cast to any to attach the schema schema for OpenAI Tools Agent
    (tool as any).schema = schema;

    return tool;
}
