import { pool } from "../../db/pool";
import type { Clinic, Professional } from "../../types/domain";

interface ClinicRow {
  id: string;
  name: string;
  instance_name: string;
  whatsapp_number: string | null;
  address: string | null;
  timezone: string;
  business_hours: Record<string, [string, string] | null>;
  payment_methods: string[];
  parking_info: string | null;
}

function mapClinic(row: ClinicRow): Clinic {
  return {
    id: row.id,
    name: row.name,
    whatsappNumber: row.whatsapp_number,
    address: row.address,
    timezone: row.timezone,
    businessHours: row.business_hours,
    paymentMethods: row.payment_methods,
    parkingInfo: row.parking_info,
  };
}

export async function findClinicByInstance(instanceName: string): Promise<Clinic | null> {
  const { rows } = await pool.query<ClinicRow>("SELECT * FROM clinics WHERE instance_name = $1", [
    instanceName,
  ]);
  return rows[0] ? mapClinic(rows[0]) : null;
}

export async function findClinicById(clinicId: string): Promise<Clinic | null> {
  const { rows } = await pool.query<ClinicRow>("SELECT * FROM clinics WHERE id = $1", [clinicId]);
  return rows[0] ? mapClinic(rows[0]) : null;
}

interface ProfessionalRow {
  id: string;
  clinic_id: string;
  name: string;
  specialty: string | null;
  google_calendar_id: string;
  slot_duration_minutes: number;
  active: boolean;
}

function mapProfessional(row: ProfessionalRow): Professional {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    name: row.name,
    specialty: row.specialty,
    googleCalendarId: row.google_calendar_id,
    slotDurationMinutes: row.slot_duration_minutes,
    active: row.active,
  };
}

export async function listActiveProfessionals(clinicId: string): Promise<Professional[]> {
  const { rows } = await pool.query<ProfessionalRow>(
    "SELECT * FROM professionals WHERE clinic_id = $1 AND active = TRUE ORDER BY name",
    [clinicId]
  );
  return rows.map(mapProfessional);
}

export async function findProfessionalByNameLike(
  clinicId: string,
  nameQuery: string
): Promise<Professional | null> {
  const { rows } = await pool.query<ProfessionalRow>(
    `SELECT * FROM professionals
     WHERE clinic_id = $1 AND active = TRUE AND name ILIKE $2
     LIMIT 1`,
    [clinicId, `%${nameQuery}%`]
  );
  return rows[0] ? mapProfessional(rows[0]) : null;
}

export async function findProfessionalById(id: string): Promise<Professional | null> {
  const { rows } = await pool.query<ProfessionalRow>("SELECT * FROM professionals WHERE id = $1", [id]);
  return rows[0] ? mapProfessional(rows[0]) : null;
}

export async function listTeamNumbers(clinicId: string): Promise<string[]> {
  const { rows } = await pool.query<{ whatsapp_number: string }>(
    "SELECT whatsapp_number FROM team_members WHERE clinic_id = $1 AND active = TRUE",
    [clinicId]
  );
  return rows.map((r) => r.whatsapp_number);
}
