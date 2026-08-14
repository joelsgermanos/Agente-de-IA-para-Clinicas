import { pool } from "../../db/pool";
import type { MessageDirection, MessageType, StoredMessage } from "../../types/domain";

interface MessageRow {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  message_type: MessageType;
  content: string | null;
  media_url: string | null;
  transcription: string | null;
  agent: string | null;
  created_at: string;
}

function mapMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction,
    messageType: row.message_type,
    content: row.content,
    mediaUrl: row.media_url,
    transcription: row.transcription,
    agent: row.agent,
    createdAt: row.created_at,
  };
}

export async function saveMessage(input: {
  conversationId: string;
  direction: MessageDirection;
  messageType: MessageType;
  content?: string | null;
  mediaUrl?: string | null;
  transcription?: string | null;
  agent?: string | null;
  externalId?: string | null;
}): Promise<StoredMessage> {
  const { rows } = await pool.query<MessageRow>(
    `INSERT INTO messages (conversation_id, direction, message_type, content, media_url, transcription, agent, external_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.conversationId,
      input.direction,
      input.messageType,
      input.content ?? null,
      input.mediaUrl ?? null,
      input.transcription ?? null,
      input.agent ?? null,
      input.externalId ?? null,
    ]
  );
  return mapMessage(rows[0]);
}

export async function listRecentMessages(conversationId: string, limit = 20): Promise<StoredMessage[]> {
  const { rows } = await pool.query<MessageRow>(
    `SELECT * FROM (
       SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2
     ) sub ORDER BY created_at ASC`,
    [conversationId, limit]
  );
  return rows.map(mapMessage);
}
