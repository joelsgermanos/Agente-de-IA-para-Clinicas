import { Worker } from "bullmq";
import { reminderQueueConnection } from "../../queues/connection";
import { REMINDER_QUEUE_NAME } from "./reminder.queue";
import { runReminderSweep } from "./reminder.service";
import { childLogger } from "../../config/logger";

const log = childLogger("reminder-processor");

export function startReminderWorker(): Worker {
  const worker = new Worker(
    REMINDER_QUEUE_NAME,
    async () => {
      await runReminderSweep();
    },
    { connection: reminderQueueConnection, concurrency: 1 }
  );

  worker.on("failed", (job, err) => {
    log.error({ err, jobId: job?.id }, "falha na varredura de lembretes");
  });

  return worker;
}
