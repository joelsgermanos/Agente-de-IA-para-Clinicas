import { pool } from "../../db/pool";

export interface ProcedureRecord {
  id: string;
  clinicId: string;
  name: string;
  category: string | null;
  description: string | null;
  preCare: string | null;
  postCare: string | null;
  painLevel: string | null;
  recoveryTime: string | null;
  imageUrls: string[];
}

interface ProcedureRow {
  id: string;
  clinic_id: string;
  name: string;
  category: string | null;
  description: string | null;
  pre_care: string | null;
  post_care: string | null;
  pain_level: string | null;
  recovery_time: string | null;
  image_urls: string[];
}

function mapProcedure(row: ProcedureRow): ProcedureRecord {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    name: row.name,
    category: row.category,
    description: row.description,
    preCare: row.pre_care,
    postCare: row.post_care,
    painLevel: row.pain_level,
    recoveryTime: row.recovery_time,
    imageUrls: row.image_urls,
  };
}

export async function listProcedures(clinicId: string): Promise<ProcedureRecord[]> {
  const { rows } = await pool.query<ProcedureRow>(
    "SELECT * FROM procedures WHERE clinic_id = $1 AND active = TRUE ORDER BY name",
    [clinicId]
  );
  return rows.map(mapProcedure);
}

export async function findProcedureByNameLike(
  clinicId: string,
  nameQuery: string
): Promise<ProcedureRecord | null> {
  const { rows } = await pool.query<ProcedureRow>(
    `SELECT * FROM procedures
     WHERE clinic_id = $1 AND active = TRUE AND (name ILIKE $2 OR category ILIKE $2)
     LIMIT 1`,
    [clinicId, `%${nameQuery}%`]
  );
  return rows[0] ? mapProcedure(rows[0]) : null;
}
