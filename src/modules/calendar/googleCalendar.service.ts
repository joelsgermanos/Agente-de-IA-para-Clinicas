import { addDays, addMinutes, isBefore, startOfDay } from "date-fns";
import { fromZonedTime, toZonedTime, formatInTimeZone } from "date-fns-tz";
import { getCalendarClient } from "./googleAuth";
import type { Clinic, Professional } from "../../types/domain";
import { childLogger } from "../../config/logger";

const log = childLogger("google-calendar");

export interface TimeSlot {
  start: Date;
  end: Date;
}

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function businessHoursForDate(clinic: Clinic, date: Date): [string, string] | null {
  const key = DAY_KEYS[toZonedTime(date, clinic.timezone).getDay()];
  return clinic.businessHours[key] ?? null;
}

export async function getBusyPeriods(
  professional: Professional,
  from: Date,
  to: Date
): Promise<TimeSlot[]> {
  const calendar = getCalendarClient();
  const { data } = await calendar.freebusy.query({
    requestBody: {
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      items: [{ id: professional.googleCalendarId }],
    },
  });
  const busy = data.calendars?.[professional.googleCalendarId]?.busy ?? [];
  return busy
    .filter((b) => b.start && b.end)
    .map((b) => ({ start: new Date(b.start as string), end: new Date(b.end as string) }));
}

/**
 * Calcula horarios livres para um profissional dentro do horario de
 * funcionamento da clinica, cruzando com os periodos ocupados no Google
 * Calendar (freebusy).
 */
export async function findAvailableSlots(
  clinic: Clinic,
  professional: Professional,
  from: Date,
  daysAhead = 7
): Promise<TimeSlot[]> {
  const to = addDays(from, daysAhead);
  const busyPeriods = await getBusyPeriods(professional, from, to);
  const slots: TimeSlot[] = [];

  for (let cursor = startOfDay(from); isBefore(cursor, to); cursor = addDays(cursor, 1)) {
    const hours = businessHoursForDate(clinic, cursor);
    if (!hours) continue;

    const [openStr, closeStr] = hours;
    const dayStr = formatInTimeZone(cursor, clinic.timezone, "yyyy-MM-dd");
    const dayOpen = fromZonedTime(`${dayStr}T${openStr}:00`, clinic.timezone);
    const dayClose = fromZonedTime(`${dayStr}T${closeStr}:00`, clinic.timezone);

    for (
      let slotStart = dayOpen;
      isBefore(addMinutes(slotStart, professional.slotDurationMinutes), addMinutes(dayClose, 1));
      slotStart = addMinutes(slotStart, professional.slotDurationMinutes)
    ) {
      const slotEnd = addMinutes(slotStart, professional.slotDurationMinutes);
      if (isBefore(slotStart, from)) continue;

      const overlaps = busyPeriods.some((b) => slotStart < b.end && slotEnd > b.start);
      if (!overlaps) {
        slots.push({ start: slotStart, end: slotEnd });
      }
    }
  }

  return slots;
}

export async function createAppointmentEvent(params: {
  professional: Professional;
  timezone: string;
  summary: string;
  description: string;
  start: Date;
  end: Date;
  attendeeEmail?: string;
  attendeeName?: string;
}): Promise<string> {
  const calendar = getCalendarClient();
  const { data } = await calendar.events.insert({
    calendarId: params.professional.googleCalendarId,
    requestBody: {
      summary: params.summary,
      description: params.description,
      start: { dateTime: params.start.toISOString(), timeZone: params.timezone },
      end: { dateTime: params.end.toISOString(), timeZone: params.timezone },
      attendees: params.attendeeEmail
        ? [{ email: params.attendeeEmail, displayName: params.attendeeName }]
        : undefined,
    },
  });
  if (!data.id) throw new Error("Google Calendar nao retornou id do evento criado");
  return data.id;
}

export async function rescheduleAppointmentEvent(
  professional: Professional,
  eventId: string,
  start: Date,
  end: Date,
  timezone: string
): Promise<void> {
  const calendar = getCalendarClient();
  await calendar.events.patch({
    calendarId: professional.googleCalendarId,
    eventId,
    requestBody: {
      start: { dateTime: start.toISOString(), timeZone: timezone },
      end: { dateTime: end.toISOString(), timeZone: timezone },
    },
  });
}

export async function cancelAppointmentEvent(professional: Professional, eventId: string): Promise<void> {
  const calendar = getCalendarClient();
  try {
    await calendar.events.delete({ calendarId: professional.googleCalendarId, eventId });
  } catch (err) {
    log.warn({ err, eventId }, "falha ao cancelar evento no Google Calendar (pode ja ter sido removido)");
  }
}

export async function getAppointmentEvent(professional: Professional, eventId: string) {
  const calendar = getCalendarClient();
  const { data } = await calendar.events.get({ calendarId: professional.googleCalendarId, eventId });
  return data;
}
