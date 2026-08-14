import Redis from "ioredis";
import { env } from "../config/env";
import { childLogger } from "../config/logger";

const log = childLogger("redis");

export function createRedisClient(name: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  client.on("error", (err) => log.error({ err, name }, "erro na conexao redis"));
  client.on("connect", () => log.info({ name }, "redis conectado"));

  return client;
}

// Cliente compartilhado para uso geral (contexto, debounce, locks, pausa humana).
export const redis = createRedisClient("shared");
