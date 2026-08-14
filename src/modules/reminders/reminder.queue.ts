import { Queue } from "bullmq";
import { reminderQueueConnection } from "../../queues/connection";

export const REMINDER_QUEUE_NAME = "appointment-reminders";

export const reminderQueue = new Queue(REMINDER_QUEUE_NAME, {
  connection: reminderQueueConnection,
});

/** Agenda a varredura periodica de lembretes (job repetitivo do BullMQ). */
export async function scheduleReminderSweeps(intervalMs: number): Promise<void> {
  await reminderQueue.add(
    "sweep",
    {},
    {
      repeat: { every: intervalMs },
      jobId: "reminder-sweep",
      removeOnComplete: true,
      removeOnFail: true,
    }
  );
}
