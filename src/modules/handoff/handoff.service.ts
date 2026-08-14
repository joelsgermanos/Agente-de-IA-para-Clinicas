import { createHandoff, type HandoffTrigger } from "./handoff.repository";
import { setConversationStatus } from "../conversations/conversation.repository";
import { pauseAiForChat } from "../whatsapp/humanPause.service";
import { notifyTeamHandoff } from "../notifications/teamNotifier.service";
import type { Clinic, Patient } from "../../types/domain";

/**
 * Executa o transbordo para atendimento humano: registra o motivo, pausa a
 * IA para o chat (para nao concorrer com o atendente) e notifica a equipe
 * com um resumo estruturado da conversa.
 */
export async function triggerHumanHandoff(params: {
  clinic: Clinic;
  patient: Patient;
  conversationId: string;
  chatId: string;
  reason: string;
  triggeredBy: HandoffTrigger;
  conversationSummary: string;
}): Promise<void> {
  await createHandoff(params.conversationId, params.reason, params.triggeredBy);
  await setConversationStatus(params.conversationId, "handoff");
  await pauseAiForChat(params.chatId);
  await notifyTeamHandoff({
    clinic: params.clinic,
    patient: params.patient,
    chatId: params.chatId,
    reason: params.reason,
    conversationSummary: params.conversationSummary,
  });
}
