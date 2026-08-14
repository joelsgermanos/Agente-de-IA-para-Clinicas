import { findOrCreatePatient } from "../patients/patient.repository";
import { findOrCreateConversation } from "./conversation.repository";
import { getContext, saveContext } from "../context/contextMap.service";
import type { Clinic, ContextMap, Conversation, Patient } from "../../types/domain";

export interface ResolvedSession {
  clinic: Clinic;
  patient: Patient;
  conversation: Conversation;
  context: ContextMap;
}

/**
 * Garante que exista paciente + conversa no Postgres e um Mapa de Contexto
 * ativo no Redis para o chat, criando-os na primeira interacao.
 */
export async function resolveSession(
  clinic: Clinic,
  chatId: string,
  senderPhone: string,
  senderName: string | null
): Promise<ResolvedSession> {
  const patient = await findOrCreatePatient(clinic.id, senderPhone, senderName);
  const conversation = await findOrCreateConversation(clinic.id, patient.id, chatId);

  let context = await getContext(chatId);
  if (!context) {
    context = {
      chatId,
      clinicId: clinic.id,
      patientId: patient.id,
      conversationId: conversation.id,
      currentAgent: conversation.currentAgent || "router",
      intent: null,
      collectedData: {
        fullName: patient.name ?? undefined,
        email: patient.email ?? undefined,
        phone: patient.phone,
      },
      summary: conversation.contextSummary ?? "",
      updatedAt: Date.now(),
    };
    await saveContext(context);
  }

  return { clinic, patient, conversation, context };
}
