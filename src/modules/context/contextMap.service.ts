import { redis } from "../../db/redis";
import type { ContextMap } from "../../types/domain";

const CONTEXT_TTL_SECONDS = 6 * 60 * 60; // 6 horas de janela de sessao ativa
const contextKey = (chatId: string) => `context:${chatId}`;

export async function getContext(chatId: string): Promise<ContextMap | null> {
  const raw = await redis.get(contextKey(chatId));
  if (!raw) return null;
  return JSON.parse(raw) as ContextMap;
}

export async function saveContext(context: ContextMap): Promise<void> {
  context.updatedAt = Date.now();
  await redis.set(contextKey(context.chatId), JSON.stringify(context), "EX", CONTEXT_TTL_SECONDS);
}

export async function updateContext(
  chatId: string,
  patch: Partial<Omit<ContextMap, "collectedData">> & { collectedData?: Partial<ContextMap["collectedData"]> }
): Promise<ContextMap | null> {
  const current = await getContext(chatId);
  if (!current) return null;

  const updated: ContextMap = {
    ...current,
    ...patch,
    collectedData: { ...current.collectedData, ...patch.collectedData },
    updatedAt: Date.now(),
  };

  await redis.set(contextKey(chatId), JSON.stringify(updated), "EX", CONTEXT_TTL_SECONDS);
  return updated;
}

export async function clearContext(chatId: string): Promise<void> {
  await redis.del(contextKey(chatId));
}
