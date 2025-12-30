import { DateTime, Interval } from 'luxon';
import { WeeklyAvailability } from '@prisma/client';

const TOOL_DEBUG = process.env.TOOL_DEBUG === '1';

const DOW = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

export function getApprovedDowSet(weekly: WeeklyAvailability[]): Set<number> {
    const s = new Set<number>();
    for (const w of weekly ?? []) {
        const idx = DOW.indexOf(String(w.dayOfWeek));
        if (idx >= 0) s.add(idx);
    }
    return s;
}

export function getNextApprovedDates(
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

export function getDayWindow(
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

export function generateCandidateSlots(
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

export function filterSlotsByBusy(
    slots: { startUtc: string; endUtc: string }[],
    busy: { start: DateTime; end: DateTime }[],
    logger: any, // Using any for simplicity here or could import Logger
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
