import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { healthRouter } from "./routes/health.routes";
import { webhookRouter } from "./routes/webhook.routes";
import { adminRouter } from "./routes/admin.routes";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(pinoHttp({ logger }));

app.use(healthRouter);
app.use(webhookRouter);
app.use(adminRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "not found" });
});

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "API do sistema de atendimento iniciada");
});
