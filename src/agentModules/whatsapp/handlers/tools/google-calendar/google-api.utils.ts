import { Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { DateTime } from 'luxon';

const TOOL_DEBUG = process.env.TOOL_DEBUG === '1';

export async function getBusyWindowsFromGoogle(
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
