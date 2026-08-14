import { Router, type Request } from "express";
import { env } from "../config/env";
import { handleInboundWebhook } from "../modules/whatsapp/inbound.service";
import { childLogger } from "../config/logger";

const log = childLogger("webhook-route");

export const webhookRouter = Router();

function isAuthorized(req: Request): boolean {
  const headerToken = req.header("x-webhook-token");
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
  const token = headerToken ?? queryToken;
  return token === env.EVOLUTION_WEBHOOK_TOKEN;
}

// A Evolution API pode ser configurada para postar em /webhook/whatsapp ou
// /webhook/whatsapp/:instance dependendo da versao/config global vs por instancia.
webhookRouter.post(["/webhook/whatsapp", "/webhook/whatsapp/:instance"], (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "token invalido" });
    return;
  }

  // Reconhece o webhook imediatamente para evitar retentativas da Evolution API;
  // o processamento (que pode envolver transcricao de audio, chamadas de IA e
  // debounce) acontece de forma assincrona.
  res.status(200).json({ received: true });

  const body = { ...req.body, instance: req.body?.instance ?? req.params.instance };

  handleInboundWebhook(body).catch((err) => {
    log.error({ err }, "falha ao processar webhook do WhatsApp");
  });
});
