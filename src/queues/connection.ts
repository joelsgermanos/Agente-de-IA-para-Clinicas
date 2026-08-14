import { createRedisClient } from "../db/redis";

// BullMQ exige conexoes dedicadas (nao compartilhadas com comandos normais)
// pois usa operacoes bloqueantes internamente.
export const debounceQueueConnection = createRedisClient("debounce-queue");
export const reminderQueueConnection = createRedisClient("reminder-queue");
