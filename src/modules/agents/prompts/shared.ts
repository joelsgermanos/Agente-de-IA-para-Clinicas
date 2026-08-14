import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import type { AgentToolContext } from "../tools/types";

export function greetingForTimezone(timezone: string): "bom dia" | "boa tarde" | "boa noite" {
  const hour = toZonedTime(new Date(), timezone).getHours();
  if (hour < 12) return "bom dia";
  if (hour < 18) return "boa tarde";
  return "boa noite";
}

/** Bloco de contexto comum injetado no prompt de todos os sub-agentes. */
export function buildBaseContext(ctx: AgentToolContext): string {
  const now = formatInTimeZone(new Date(), ctx.clinic.timezone, "EEEE, dd/MM/yyyy HH:mm");

  return [
    `Voce atende pelo WhatsApp da clinica "${ctx.clinic.name}".`,
    `Data/hora atual (fuso ${ctx.clinic.timezone}): ${now}.`,
    `Saudacao apropriada agora: "${greetingForTimezone(ctx.clinic.timezone)}".`,
    "",
    "Dados ja conhecidos do paciente nesta conversa:",
    `- Telefone: ${ctx.patient.phone}`,
    `- Nome: ${ctx.patient.name ?? "ainda nao informado"}`,
    `- E-mail: ${ctx.patient.email ?? "ainda nao informado"}`,
    `- Resumo da conversa ate agora: ${ctx.context.summary || "(inicio da conversa)"}`,
    "",
    "Regras gerais obrigatorias:",
    "- Responda sempre em portugues do Brasil, em tom humano, caloroso e profissional (nunca robotico).",
    "- Nunca invente informacoes sobre precos, disponibilidade ou procedimentos: use as ferramentas disponiveis.",
    "- Use a saudacao apropriada apenas na primeira mensagem da conversa, nao repita a cada resposta.",
    "- Mensagens curtas e diretas funcionam melhor no WhatsApp do que blocos de texto longos.",
    "- Se o paciente pedir para falar com uma pessoa, ou voce nao souber responder com seguranca, use a " +
      "ferramenta escalate_to_human em vez de inventar uma resposta.",
  ].join("\n");
}
