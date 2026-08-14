import { pool } from "../../db/pool";
import type { Patient } from "../../types/domain";

interface PatientRow {
  id: string;
  clinic_id: string;
  phone: string;
  name: string | null;
  email: string | null;
  notes: string | null;
}

function mapPatient(row: PatientRow): Patient {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    phone: row.phone,
    name: row.name,
    email: row.email,
    notes: row.notes,
  };
}

export async function findOrCreatePatient(
  clinicId: string,
  phone: string,
  name: string | null
): Promise<Patient> {
  const { rows } = await pool.query<PatientRow>(
    `INSERT INTO patients (clinic_id, phone, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (clinic_id, phone)
     DO UPDATE SET name = COALESCE(patients.name, EXCLUDED.name), updated_at = now()
     RETURNING *`,
    [clinicId, phone, name]
  );
  return mapPatient(rows[0]);
}

export async function updatePatientDetails(
  patientId: string,
  details: { name?: string; email?: string }
): Promise<Patient> {
  const { rows } = await pool.query<PatientRow>(
    `UPDATE patients
     SET name = COALESCE($2, name), email = COALESCE($3, email), updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [patientId, details.name ?? null, details.email ?? null]
  );
  return mapPatient(rows[0]);
}

export async function findPatientById(patientId: string): Promise<Patient | null> {
  const { rows } = await pool.query<PatientRow>("SELECT * FROM patients WHERE id = $1", [patientId]);
  return rows[0] ? mapPatient(rows[0]) : null;
}
