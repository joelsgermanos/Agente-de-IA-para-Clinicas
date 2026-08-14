import { addDays, addHours, subDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { env } from "../../config/env";
import { childLogger } from "../../config/logger";
import {
  findAppointmentsNeedingD1Reminder,
  findAppointmentsNeedingSameDayReminder,
  markReminderSent,
} from "../appointments/appointment.repository";
import { findClinicById, findProfessionalById } from "../clinics/clinic.repository";
import { findPatientById } from "../patients/patient.repository";
import { sendOutbound } from "../whatsapp/message.sender";
import type { Appointment, Clinic } from "../../types/domain";

const log = childLogger("reminder-service");

function d1SendTime(clinic: Clinic, appointmentStart: Date): Date {
  const dayBefore = subDays(appointmentStart, 1);
  const dayStr = formatInTimeZone(dayBefore, clinic.timezone, "yyyy-MM-dd");
  const hour = String(env.REMINDER_D1_HOUR).padStart(2, "0");
  return fromZonedTime(`${dayStr}T${hour}:00:00`, clinic.timezone);
}

function sameDaySendTime(appointmentStart: Date): Date {
  return addHours(appointmentStart, -env.REMINDER_SAME_DAY_HOURS_BEFORE);
}

async function sendReminderMessage(
  appointment: Appointment,
  clinic: Clinic,
  kind: "d1" | "same_day"
): Promise<void> {
  const patient = await findPatientById(appointment.patientId);
  const professional = await findProfessionalById(appointment.professionalId);
  if (!patient || !professional) return;

  const chatId = `${patient.phone}@s.whatsapp.net`;
  const dateLabel = formatInTimeZone(new Date(appointment.startsAt), clinic.timezone, "EEEE, dd/MM 'as' HH:mm", {
    locale: ptBR,
  });
  const greetingName = patient.name ? `, ${patient.name}` : "";

  const text =
    kind === "d1"
      ? `Ola${greetingName}! Passando para lembrar que sua consulta na ${clinic.name} esta marcada para amanha, ` +
        `${dateLabel}, com ${professional.name}. Podemos confirmar sua presenca?`
      : `Ola${greetingName}! Sua consulta na ${clinic.name} e hoje, ${dateLabel}, com ${professional.name}. ` +
        "Ate daqui a pouco! Caso precise remarcar, e so nos avisar por aqui.";

  await sendOutbound(chatId, { text });
  await markReminderSent(appointment.id, kind);
  log.info({ appointmentId: appointment.id, kind }, "lembrete enviado");
}

/**
 * Varre os agendamentos futuros e dispara os lembretes de D-1 e do dia da
 * consulta, calculando o horario de envio no fuso horario de cada clinica.
 */
export async function runReminderSweep(): Promise<void> {
  const now = new Date();
  const clinicCache = new Map<string, Clinic | null>();

  const getClinic = async (clinicId: string): Promise<Clinic | null> => {
    if (!clinicCache.has(clinicId)) {
      clinicCache.set(clinicId, await findClinicById(clinicId));
    }
    return clinicCache.get(clinicId) ?? null;
  };

  const d1Candidates = await findAppointmentsNeedingD1Reminder(now, addDays(now, 2));
  for (const appointment of d1Candidates) {
    const clinic = await getClinic(appointment.clinicId);
    if (!clinic) continue;
    if (now >= d1SendTime(clinic, new Date(appointment.startsAt))) {
      await sendReminderMessage(appointment, clinic, "d1").catch((err) =>
        log.error({ err, appointmentId: appointment.id }, "falha ao enviar lembrete D-1")
      );
    }
  }

  const sameDayCandidates = await findAppointmentsNeedingSameDayReminder(now, addDays(now, 1));
  for (const appointment of sameDayCandidates) {
    const clinic = await getClinic(appointment.clinicId);
    if (!clinic) continue;
    if (now >= sameDaySendTime(new Date(appointment.startsAt))) {
      await sendReminderMessage(appointment, clinic, "same_day").catch((err) =>
        log.error({ err, appointmentId: appointment.id }, "falha ao enviar lembrete do dia")
      );
    }
  }
}
