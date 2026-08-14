import { Queue } from "bullmq";
import { debounceQueueConnection } from "../../queues/connection";
import { redis } from "../../db/redis";
import { env } from "../../config/env";
import type { MessageType } from "../../types/domain";

export const DEBOUNCE_QUEUE_NAME = "message-debounce";

export const debounceQueue = new Queue(DEBOUNCE_QUEUE_NAME, {
  connection: debounceQueueConnection,
});

export interface DebounceJobData {
  chatId: string;
}

export interface BufferedMessage {
  type: MessageType;
  text: string;
  externalId: string;
  timestamp: number;
}

const bufferKey = (chatId: string) => `buffer:${chatId}`;
const BUFFER_TTL_SECONDS = 120;

/**
 * Adiciona a mensagem (ja convertida para texto - transcrita/descrita se necessario)
 * ao buffer do chat e reagenda o job de flush para daqui a MESSAGE_DEBOUNCE_MS.
 * Cada nova mensagem "reseta" o timer, concatenando mensagens picotadas em uma unica
 * chamada ao pipeline de IA.
 */
export async function bufferInboundMessage(chatId: string, message: BufferedMessage): Promise<void> {
  await redis.rpush(bufferKey(chatId), JSON.stringify(message));
  await redis.expire(bufferKey(chatId), BUFFER_TTL_SECONDS);

  const existingJob = await debounceQueue.getJob(chatId);
  if (existingJob) {
    const state = await existingJob.getState();
    if (state === "delayed" || state === "waiting") {
      await existingJob.remove();
    }
  }

  await debounceQueue.add(
    "flush",
    { chatId } satisfies DebounceJobData,
    {
      jobId: chatId,
      delay: env.MESSAGE_DEBOUNCE_MS,
      removeOnComplete: true,
      removeOnFail: true,
    }
  );
}

export async function popBufferedMessages(chatId: string): Promise<BufferedMessage[]> {
  const key = bufferKey(chatId);
  const raw = await redis.lrange(key, 0, -1);
  await redis.del(key);
  return raw.map((item) => JSON.parse(item) as BufferedMessage);
}

/** Junta as mensagens picotadas em um unico texto, na ordem de chegada. */
export function joinBufferedMessages(messages: BufferedMessage[]): string {
  return messages
    .map((m) => m.text)
    .filter(Boolean)
    .join("\n")
    .trim();
}
