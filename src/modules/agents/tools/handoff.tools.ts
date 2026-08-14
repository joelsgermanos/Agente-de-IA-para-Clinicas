import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { AgentSignals } from "./types";

/** Ferramenta de transbordo disponivel para todos os sub-agentes. */
export function createHandoffTool(signals: AgentSignals) {
  return tool(
    async ({ reason }: { reason: string }) => {
      signals.handoffRequested = true;
      signals.handoffReason = reason;
      return "Transbordo registrado. Um atendente humano assumira esta conversa em instantes.";
    },
    {
      name: "escalate_to_human",
      description:
        "Transfere a conversa para um atendente humano da clinica. Use quando o paciente pedir " +
        "explicitamente para falar com uma pessoa, quando houver reclamacao/urgencia, ou quando voce nao " +
        "tiver informacoes suficientes no contexto disponivel para responder com seguranca.",
      schema: z.object({
        reason: z
          .string()
          .describe("Motivo objetivo do transbordo, em portugues, para a equipe entender rapidamente."),
      }),
    }
  );
}
