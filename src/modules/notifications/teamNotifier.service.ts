import { formatInTimeZone } from "date-fns-tz";
import { evolutionApi } from "../whatsapp/evolutionApi.client";
import { listTeamNumbers } from "../clinics/clinic.repository";
import { childLogger } from "../../config/logger";
import type { Clinic, Patient, Professional } from "../../types/domain";

const log = childLogger("team-notifier");

async function broadcastToTeam(clinicId: string, text: string): Promise<void> {
  const numbers = await listTeamNumbers(clinicId);
  for (const number of numbers) {
    const chatId = number.includes("@") ? number : `${number}@s.whatsapp.net`;
    try {
      await evolutionApi.sendText(chatId, text);
    } catch (err) {
      log.error({ err, number }, "falha ao notificar membro da equipe");
    }
  }
}

/** Envia para a equipe um resumo estruturado quando uma consulta e agendada. */
export async function notifyTeamNewAppointment(params: {
  clinic: Clinic;
  patient: Patient;
  professional: Professional;
  procedureLabel: string;
  startsAt: Date;
  conversationSummary: string;
}): Promise<void> {
  const dateLabel = formatInTimeZone(params.startsAt, params.clinic.timezone, "dd/MM/yyyy 'as' HH:mm");

  const text = [
    "*Nova consulta agendada pela IA*",
    `Paciente: ${params.patient.name ?? "(nome nao informado)"}`,
    `Telefone: ${params.patient.phone}`,
    `Profissional: ${params.professional.name}`,
    `Procedimento: ${params.procedureLabel}`,
    `Horario: ${dateLabel}`,
    "",
    "Resumo da conversa:",
    params.conversationSummary || "(sem resumo disponivel)",
  ].join("\n");

  await broadcastToTeam(params.clinic.id, text);
}

/** Envia para a equipe um resumo estruturado quando a IA transborda a conversa para humano. */
export async function notifyTeamHandoff(params: {
  clinic: Clinic;
  patient: Patient;
  chatId: string;
  reason: string;
  conversationSummary: string;
}): Promise<void> {
  const text = [
    "*Transbordo para atendimento humano*",
    `Paciente: ${params.patient.name ?? "(nome nao informado)"}`,
    `Telefone: ${params.patient.phone}`,
    `Motivo: ${params.reason}`,
    "",
    "Resumo da conversa:",
    params.conversationSummary || "(sem resumo disponivel)",
    "",
    `Responda diretamente no WhatsApp do paciente (${params.chatId.split("@")[0]}) para assumir o atendimento.`,
  ].join("\n");

  await broadcastToTeam(params.clinic.id, text);
}
