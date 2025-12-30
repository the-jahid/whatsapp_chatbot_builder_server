import { Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { PrismaService } from 'src/prisma/prisma.service';
import { CalendarConnection, CalendarProvider } from '@prisma/client';

const TOOL_DEBUG = process.env.TOOL_DEBUG === '1';

export function validateCalendarConnection(
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

export async function getOAuth2Client(conn: CalendarConnection, prisma: PrismaService, logger: Logger) {
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

export function pickCalendarConnection(agent: {
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
