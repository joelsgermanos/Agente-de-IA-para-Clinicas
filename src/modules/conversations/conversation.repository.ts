import { pool } from "../../db/pool";
import type { Conversation, ConversationStatus } from "../../types/domain";

interface ConversationRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  chat_id: string;
  status: ConversationStatus;
  current_agent: string;
  context_summary: string | null;
  last_message_at: string;
}

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    chatId: row.chat_id,
    status: row.status,
    currentAgent: row.current_agent,
    contextSummary: row.context_summary,
    lastMessageAt: row.last_message_at,
  };
}

export async function findOrCreateConversation(
  clinicId: string,
  patientId: string,
  chatId: string
): Promise<Conversation> {
  const { rows } = await pool.query<ConversationRow>(
    `INSERT INTO conversations (clinic_id, patient_id, chat_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (clinic_id, chat_id)
     DO UPDATE SET last_message_at = now()
     RETURNING *`,
    [clinicId, patientId, chatId]
  );
  return mapConversation(rows[0]);
}

export async function setConversationStatus(
  conversationId: string,
  status: ConversationStatus
): Promise<void> {
  await pool.query("UPDATE conversations SET status = $2, updated_at = now() WHERE id = $1", [
    conversationId,
    status,
  ]);
}

export async function setConversationAgent(conversationId: string, agent: string): Promise<void> {
  await pool.query("UPDATE conversations SET current_agent = $2, updated_at = now() WHERE id = $1", [
    conversationId,
    agent,
  ]);
}

export async function touchConversation(conversationId: string): Promise<void> {
  await pool.query("UPDATE conversations SET last_message_at = now() WHERE id = $1", [conversationId]);
}
