import { Worker, type Job } from "bullmq";
import { debounceQueueConnection } from "../../queues/connection";
import { DEBOUNCE_QUEUE_NAME, popBufferedMessages, joinBufferedMessages, type DebounceJobData } from "./debounce.service";
import { isAiPaused } from "./humanPause.service";
import { sendOutbound } from "./message.sender";
import { findClinicById } from "../clinics/clinic.repository";
import { findPatientById } from "../patients/patient.repository";
import { getContext } from "../context/contextMap.service";
import { findOrCreateConversation } from "../conversations/conversation.repository";
import { saveMessage } from "../conversations/message.repository";
import { handleIncomingMessage } from "../agents/orchestrator";
import { childLogger } from "../../config/logger";
import type { Conversation } from "../../types/domain";

const log = childLogger("debounce-processor");

async function processFlush(job: Job<DebounceJobData>): Promise<void> {
  const { chatId } = job.data;

  const buffered = await popBufferedMessages(chatId);
  if (buffered.length === 0) return;

  const userText = joinBufferedMessages(buffered);
  if (!userText) return;

  if (await isAiPaused(chatId)) {
    log.info({ chatId }, "IA pausada para este chat, mensagem apenas registrada");
    return;
  }

  const context = await getContext(chatId);
  if (!context) {
    log.warn({ chatId }, "contexto nao encontrado ao processar flush - ignorando");
    return;
  }

  const [clinic, patient] = await Promise.all([
    findClinicById(context.clinicId),
    findPatientById(context.patientId),
  ]);

  if (!clinic || !patient) {
    log.error({ chatId }, "clinica ou paciente nao encontrados ao processar flush");
    return;
  }

  const conversation: Conversation = {
    id: context.conversationId,
    clinicId: clinic.id,
    patientId: patient.id,
    chatId,
    status: "active",
    currentAgent: context.currentAgent,
    contextSummary: context.summary,
    lastMessageAt: new Date().toISOString(),
  };
  // Garante que a conversa exista mesmo se o contexto no Redis tiver expirado
  // parcialmente entre o momento do buffer e o processamento.
  await findOrCreateConversation(clinic.id, patient.id, chatId);

  const output = await handleIncomingMessage({
    clinic,
    patient,
    conversation,
    context,
    chatId,
    userText,
  });

  await saveMessage({
    conversationId: conversation.id,
    direction: "outbound",
    messageType: "text",
    content: output.responseText,
    agent: output.agentUsed,
  });

  await sendOutbound(chatId, {
    text: output.responseText,
    images: output.images,
  });

  log.info({ chatId, agent: output.agentUsed, handoff: output.handoff }, "resposta da IA enviada");
}

export function startDebounceWorker(): Worker<DebounceJobData> {
  const worker = new Worker<DebounceJobData>(DEBOUNCE_QUEUE_NAME, processFlush, {
    connection: debounceQueueConnection,
    concurrency: 10,
  });

  worker.on("failed", (job, err) => {
    log.error({ err, chatId: job?.data.chatId }, "falha ao processar flush de debounce");
  });

  return worker;
}
