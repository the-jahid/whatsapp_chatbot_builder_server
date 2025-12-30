// Deps: npm i googleapis luxon
import { Logger } from '@nestjs/common';
import { DynamicTool } from '@langchain/core/tools';
import { AppointmentLeadItem } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

import {
  createBookAppointmentTool,
  createGetAvailableTimeTool,
  getOAuth2Client,
  pickCalendarConnection,
  validateCalendarConnection,
} from './google-calendar';

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
  // const getAppointmentIntakeFields = new DynamicTool({
  //   name: 'get_appointment_intake_fields',
  //   description:
  //     'Return the list of data fields that must be collected from the user BEFORE booking an appointment (these are AppointmentLeadItem for this agent).',
  //   func: async () => {
  //     const fields = (agent.appointmentLeadItems || []).map((f: AppointmentLeadItem) => ({
  //       name: f.name,
  //       hint: f.description ?? '',
  //     }));
  //     return JSON.stringify({ fields });
  //   },
  // });

  // 2) Get available time
  const getAvailableTime = createGetAvailableTimeTool({
    agent: agent as any, // casting to avoid strict type mismatch if partial
    auth,
    calendarId,
    tz,
    slotMin,
    logger,
  });

  // 3) Book appointment
  const bookAppointmentTool = createBookAppointmentTool({
    agentId,
    auth,
    calendarId,
    tz,
    slotMin,
    logger,
    prisma,
  });

  // Expose in a helpful order: schema → availability → booking
  // return [getAppointmentIntakeFields, getAvailableTime, bookAppointmentTool];
  return [getAvailableTime, bookAppointmentTool];
}
