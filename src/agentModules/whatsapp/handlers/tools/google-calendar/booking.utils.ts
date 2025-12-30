import { google } from 'googleapis';
import { DateTime } from 'luxon';

export async function createGoogleCalendarEvent(
    auth: any,
    calendarId: string,
    summary: string,
    description: string,
    startUtc: DateTime,
    endUtc: DateTime,
    attendeeEmail: string | null,
) {
    const calendar = google.calendar({ version: 'v3', auth });
    const res = await calendar.events.insert({
        calendarId,
        requestBody: {
            summary,
            description,
            start: { dateTime: startUtc.toISO(), timeZone: 'UTC' },
            end: { dateTime: endUtc.toISO(), timeZone: 'UTC' },
            attendees: attendeeEmail ? [{ email: attendeeEmail }] : undefined,
        },
        sendUpdates: attendeeEmail ? 'all' : 'none',
    });

    return res;
}
