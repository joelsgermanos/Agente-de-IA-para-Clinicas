import { env } from "../src/config/env";
import { childLogger } from "../src/config/logger";
import { startDebounceWorker } from "../src/modules/whatsapp/debounce.processor";
import { startReminderWorker } from "../src/modules/reminders/reminder.processor";
import { scheduleReminderSweeps } from "../src/modules/reminders/reminder.queue";

const log = childLogger("worker-bootstrap");

async function main() {
  const debounceWorker = startDebounceWorker();
  const reminderWorker = startReminderWorker();
  await scheduleReminderSweeps(env.REMINDER_CRON_INTERVAL_MS);

  log.info(
    { debounceMs: env.MESSAGE_DEBOUNCE_MS, reminderIntervalMs: env.REMINDER_CRON_INTERVAL_MS },
    "worker de debounce e lembretes iniciado"
  );

  const shutdown = async () => {
    log.info("encerrando worker...");
    await Promise.all([debounceWorker.close(), reminderWorker.close()]);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error({ err }, "falha fatal ao iniciar worker");
  process.exit(1);
});
