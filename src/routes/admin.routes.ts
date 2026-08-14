import { Router } from "express";
import { env } from "../config/env";
import { resumeAiForChat, pauseAiForChat } from "../modules/whatsapp/humanPause.service";

export const adminRouter = Router();

adminRouter.use((req, res, next) => {
  if (req.header("x-admin-token") !== env.EVOLUTION_WEBHOOK_TOKEN) {
    res.status(401).json({ error: "token invalido" });
    return;
  }
  next();
});

/** Permite a secretaria devolver o atendimento para a IA apos assumir manualmente. */
adminRouter.post("/admin/chats/:chatId/resume", async (req, res) => {
  const { chatId } = req.params;
  await resumeAiForChat(chatId);
  res.json({ chatId, aiPaused: false });
});

adminRouter.post("/admin/chats/:chatId/pause", async (req, res) => {
  const { chatId } = req.params;
  await pauseAiForChat(chatId);
  res.json({ chatId, aiPaused: true });
});
