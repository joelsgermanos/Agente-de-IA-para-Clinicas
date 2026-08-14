import { redis } from "../../db/redis";
import { env } from "../../config/env";

const pauseKey = (chatId: string) => `pause:${chatId}`;

/** Ativa a pausa da IA para o chat (chamado quando um atendente humano responde manualmente). */
export async function pauseAiForChat(chatId: string): Promise<void> {
  await redis.set(pauseKey(chatId), "1", "EX", env.HUMAN_PAUSE_TTL_MINUTES * 60);
}

export async function resumeAiForChat(chatId: string): Promise<void> {
  await redis.del(pauseKey(chatId));
}

export async function isAiPaused(chatId: string): Promise<boolean> {
  const value = await redis.get(pauseKey(chatId));
  return value === "1";
}
