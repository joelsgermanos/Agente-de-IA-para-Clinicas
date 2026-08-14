import { pool } from "../../db/pool";

export interface FaqRecord {
  id: string;
  clinicId: string;
  category: string | null;
  question: string;
  answer: string;
}

interface FaqRow {
  id: string;
  clinic_id: string;
  category: string | null;
  question: string;
  answer: string;
}

function mapFaq(row: FaqRow): FaqRecord {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    category: row.category,
    question: row.question,
    answer: row.answer,
  };
}

export async function listFaqs(clinicId: string): Promise<FaqRecord[]> {
  const { rows } = await pool.query<FaqRow>(
    "SELECT * FROM faqs WHERE clinic_id = $1 ORDER BY category, question",
    [clinicId]
  );
  return rows.map(mapFaq);
}
