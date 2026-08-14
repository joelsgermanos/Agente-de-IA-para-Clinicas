import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { env } from "../../config/env";
import type { AgentToolContext } from "./tools/types";

export const AGENT_NAMES = ["receptionist", "scheduler", "faq", "specialist"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

const routeSchema = z.object({
  agent: z.enum(AGENT_NAMES).describe("Sub-agente que deve responder a mensagem do paciente."),
  reasoning: z.string().describe("Breve justificativa da escolha, em portugues, para fins de log."),
});

const routerLlm = new ChatOpenAI({
  model: env.OPENAI_ROUTER_MODEL,
  temperature: 0,
  apiKey: env.OPENAI_API_KEY,
}).withStructuredOutput(routeSchema, { name: "route_conversation" });

const ROUTER_SYSTEM_PROMPT = `
Voce e o Agente Roteador de um sistema de atendimento de clinica via WhatsApp.
Sua unica funcao e ler a mensagem mais recente do paciente (e o contexto da conversa) e decidir qual
sub-agente especializado deve responder. Nao responda ao paciente, apenas classifique.

Sub-agentes disponiveis:
- "receptionist": saudacao inicial, qualificacao do lead, apresentacao de procedimentos/imagens, contorno de
  objecao de preco, primeiro contato em geral.
- "scheduler": paciente quer marcar, reagendar, confirmar ou cancelar uma consulta; ja esta no meio de um
  fluxo de agendamento; esta fornecendo dados (nome, email) para agendar.
- "faq": perguntas sobre endereco/localizacao, formas de pagamento, estacionamento, horario de funcionamento.
- "specialist": duvidas tecnicas sobre um procedimento especifico (dor, recuperacao, cuidados pre/pos).

Regras:
- Se a mensagem continuar claramente o fluxo do agente atual da conversa (ex: paciente respondendo a uma
  pergunta feita pelo agendador), mantenha o mesmo agente.
- Na duvida entre "receptionist" e outro agente mais especifico, prefira o mais especifico.
`.trim();

export async function routeToAgent(
  ctx: AgentToolContext,
  latestUserMessage: string
): Promise<{ agent: AgentName; reasoning: string }> {
  const result = await routerLlm.invoke([
    new SystemMessage(ROUTER_SYSTEM_PROMPT),
    new HumanMessage(
      [
        `Agente atual da conversa: ${ctx.context.currentAgent}`,
        `Resumo da conversa ate agora: ${ctx.context.summary || "(inicio da conversa)"}`,
        `Mensagem mais recente do paciente: "${latestUserMessage}"`,
      ].join("\n")
    ),
  ]);

  return result;
}
