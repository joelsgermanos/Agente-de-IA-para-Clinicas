import { pool } from "../../db/pool";

export type HandoffTrigger = "agent" | "patient" | "system";

export async function createHandoff(
  conversationId: string,
  reason: string,
  triggeredBy: HandoffTrigger
): Promise<void> {
  await pool.query(
    `INSERT INTO handoffs (conversation_id, reason, triggered_by) VALUES ($1, $2, $3)`,
    [conversationId, reason, triggeredBy]
  );
}
