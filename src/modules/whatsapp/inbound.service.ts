import { normalizeEvolutionWebhook, type EvolutionWebhookBody } from "./message.normalizer";
import { transcribeAudio, describeImage } from "./media.service";
import { bufferInboundMessage } from "./debounce.service";
import { pauseAiForChat } from "./humanPause.service";
import { findClinicByInstance } from "../clinics/clinic.repository";
import { resolveSession } from "../conversations/conversation.service";
import { saveMessage } from "../conversations/message.repository";
import { touchConversation } from "../conversations/conversation.repository";
import { childLogger } from "../../config/logger";
import { env } from "../../config/env";

const log = childLogger("whatsapp-inbound");

/**
 * Ponto de entrada do webhook: normaliza o payload, resolve a clinica/paciente/
 * conversa, converte midia para texto (transcricao/descricao) e decide entre
 * bufferizar a mensagem para a IA responder ou apenas registrar (quando um
 * humano acabou de assumir a conversa manualmente).
 */
export async function handleInboundWebhook(body: EvolutionWebhookBody): Promise<void> {
  const normalized = await normalizeEvolutionWebhook(body);
  if (!normalized) return;

  const instanceName = body.instance ?? env.EVOLUTION_INSTANCE_NAME;
  const clinic = await findClinicByInstance(instanceName);
  if (!clinic) {
    log.warn({ instanceName }, "clinica nao encontrada para a instancia do webhook");
    return;
  }

  const { patient, conversation } = await resolveSession(
    clinic,
    normalized.chatId,
    normalized.senderPhone,
    normalized.senderName
  );

  // Mensagem enviada pelo proprio numero da clinica (fromMe=true) via app do
  // WhatsApp indica que um humano assumiu a conversa manualmente: pausamos a IA.
  if (normalized.fromMe) {
    await saveMessage({
      conversationId: conversation.id,
      direction: "outbound",
      messageType: "text",
      content: normalized.text ?? "(mensagem manual da equipe)",
      agent: "human",
      externalId: normalized.externalId,
    });
    await pauseAiForChat(normalized.chatId);
    await touchConversation(conversation.id);
    return;
  }

  // Se o paciente voltou a escrever apos um atendimento humano encerrado sem
  // reset explicito, mantemos a pausa ate a equipe decidir devolver para a IA
  // (o TTL da pausa expira sozinho apos HUMAN_PAUSE_TTL_MINUTES).
  let textContent = normalized.text ?? "";
  let transcription: string | null = null;

  if (normalized.type === "audio" && normalized.mediaBase64) {
    transcription = await transcribeAudio(normalized.mediaBase64, normalized.mediaMimeType ?? "audio/ogg");
    textContent = transcription;
  } else if (normalized.type === "image" && normalized.mediaBase64) {
    transcription = await describeImage(
      normalized.mediaBase64,
      normalized.mediaMimeType ?? "image/jpeg",
      normalized.caption
    );
    textContent = normalized.caption ? `${normalized.caption}\n[Imagem: ${transcription}]` : `[Imagem: ${transcription}]`;
  } else if (normalized.type === "document") {
    textContent = normalized.caption ?? "[Documento recebido]";
  }

  await saveMessage({
    conversationId: conversation.id,
    direction: "inbound",
    messageType: normalized.type,
    content: normalized.text,
    transcription,
    externalId: normalized.externalId,
  });
  await touchConversation(conversation.id);

  await bufferInboundMessage(normalized.chatId, {
    type: normalized.type,
    text: textContent,
    externalId: normalized.externalId,
    timestamp: normalized.timestamp,
  });
}
