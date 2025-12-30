import { DynamicTool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { WeeklyAvailability } from '@prisma/client';
import {
    parseToolInput,
    getApprovedDowSet,
    getNextApprovedDates,
    getDayWindow,
    generateCandidateSlots,
    getBusyWindowsFromGoogle,
    filterSlotsByBusy,
} from './index';

const TOOL_DEBUG = process.env.TOOL_DEBUG === '1';

type GetAvailableTimeToolDeps = {
    agent: {
        weeklyAvailabilities: WeeklyAvailability[];
        bookingSettings: {
            timezone: string | null;
            allowSameDayBooking: boolean;
        } | null;
    };
    auth: any;
    calendarId: string;
    tz: string;
    slotMin: number;
    logger: Logger;
};

export function createGetAvailableTimeTool({
    agent,
    auth,
    calendarId,
    tz,
    slotMin,
    logger,
}: GetAvailableTimeToolDeps) {
    return new DynamicTool({
        name: 'get_available_time',
        description: `
Get available days and/or time slots for this agent.
- Call WITHOUT "day" to get upcoming calendar dates whose weekday is approved in WeeklyAvailability.
- Call WITH "day" (YYYY-MM-DD) to get time slots for that day, filtered by Google Calendar Free/Busy.
`.trim(),
        func: async (raw: string) => {
            logger.log(`[get_available_time] CALLED with raw: ${raw}`);
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

                const { todays, minLocal, maxLocal } = window;
                const timeMinLocalISO = minLocal.toISO();
                const timeMaxLocalISO = maxLocal.toISO();

                const candidates = generateCandidateSlots(todays, dayISO, dayISO, slotMin, zone);
                if (!candidates.length) {
                    return JSON.stringify({ timezone: zone, day: dayISO, slots: [] });
                }

                const busy = await getBusyWindowsFromGoogle(
                    auth,
                    calendarId,
                    timeMinLocalISO!,
                    timeMaxLocalISO!,
                    logger,
                );
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
}
