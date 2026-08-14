import { pool } from "../../db/pool";
import type { Appointment, AppointmentStatus } from "../../types/domain";

interface AppointmentRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  professional_id: string;
  procedure_id: string | null;
  procedure_label: string | null;
  google_event_id: string | null;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  reminder_d1_sent_at: string | null;
  reminder_same_day_sent_at: string | null;
}

function mapAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    professionalId: row.professional_id,
    procedureId: row.procedure_id,
    procedureLabel: row.procedure_label,
    googleEventId: row.google_event_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    reminderD1SentAt: row.reminder_d1_sent_at,
    reminderSameDaySentAt: row.reminder_same_day_sent_at,
  };
}

export async function createAppointment(input: {
  clinicId: string;
  patientId: string;
  professionalId: string;
  procedureId?: string | null;
  procedureLabel: string;
  googleEventId: string;
  startsAt: Date;
  endsAt: Date;
}): Promise<Appointment> {
  const { rows } = await pool.query<AppointmentRow>(
    `INSERT INTO appointments
       (clinic_id, patient_id, professional_id, procedure_id, procedure_label, google_event_id, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.clinicId,
      input.patientId,
      input.professionalId,
      input.procedureId ?? null,
      input.procedureLabel,
      input.googleEventId,
      input.startsAt.toISOString(),
      input.endsAt.toISOString(),
    ]
  );
  return mapAppointment(rows[0]);
}

export async function findAppointmentById(id: string): Promise<Appointment | null> {
  const { rows } = await pool.query<AppointmentRow>("SELECT * FROM appointments WHERE id = $1", [id]);
  return rows[0] ? mapAppointment(rows[0]) : null;
}

export async function findUpcomingAppointmentsForPatient(patientId: string): Promise<Appointment[]> {
  const { rows } = await pool.query<AppointmentRow>(
    `SELECT * FROM appointments
     WHERE patient_id = $1 AND status IN ('scheduled', 'confirmed') AND starts_at > now()
     ORDER BY starts_at ASC`,
    [patientId]
  );
  return rows.map(mapAppointment);
}

export async function rescheduleAppointment(id: string, startsAt: Date, endsAt: Date): Promise<Appointment> {
  const { rows } = await pool.query<AppointmentRow>(
    `UPDATE appointments
     SET starts_at = $2, ends_at = $3, status = 'scheduled',
         reminder_d1_sent_at = NULL, reminder_same_day_sent_at = NULL, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, startsAt.toISOString(), endsAt.toISOString()]
  );
  return mapAppointment(rows[0]);
}

export async function cancelAppointment(id: string): Promise<Appointment> {
  const { rows } = await pool.query<AppointmentRow>(
    `UPDATE appointments SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *`,
    [id]
  );
  return mapAppointment(rows[0]);
}

export async function setAppointmentStatus(id: string, status: AppointmentStatus): Promise<void> {
  await pool.query("UPDATE appointments SET status = $2, updated_at = now() WHERE id = $1", [id, status]);
}

/** Consultas confirmadas/agendadas que ocorrem dentro da janela informada e ainda nao receberam o lembrete D-1. */
export async function findAppointmentsNeedingD1Reminder(
  windowStart: Date,
  windowEnd: Date
): Promise<Appointment[]> {
  const { rows } = await pool.query<AppointmentRow>(
    `SELECT * FROM appointments
     WHERE status IN ('scheduled', 'confirmed')
       AND starts_at BETWEEN $1 AND $2
       AND reminder_d1_sent_at IS NULL`,
    [windowStart.toISOString(), windowEnd.toISOString()]
  );
  return rows.map(mapAppointment);
}

/** Consultas do dia que ainda nao receberam o lembrete de confirmacao no mesmo dia. */
export async function findAppointmentsNeedingSameDayReminder(
  windowStart: Date,
  windowEnd: Date
): Promise<Appointment[]> {
  const { rows } = await pool.query<AppointmentRow>(
    `SELECT * FROM appointments
     WHERE status IN ('scheduled', 'confirmed')
       AND starts_at BETWEEN $1 AND $2
       AND reminder_same_day_sent_at IS NULL`,
    [windowStart.toISOString(), windowEnd.toISOString()]
  );
  return rows.map(mapAppointment);
}

export async function markReminderSent(id: string, kind: "d1" | "same_day"): Promise<void> {
  const column = kind === "d1" ? "reminder_d1_sent_at" : "reminder_same_day_sent_at";
  await pool.query(`UPDATE appointments SET ${column} = now() WHERE id = $1`, [id]);
}
