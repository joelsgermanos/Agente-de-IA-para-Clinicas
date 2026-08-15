import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { routeToAgent, type AgentName } from "./router.agent";
import { runReceptionistAgent } from "./receptionist.agent";
import { runSchedulerAgent } from "./scheduler.agent";
import { runFaqAgent } from "./faq.agent";
import { runSpecialistAgent } from "./specialist.agent";
import type { AgentRunResult } from "./agentExecutor";
import { createEmptySignals, type AgentSignals, type AgentToolContext } from "./tools/types";
import { triggerHumanHandoff } from "../handoff/handoff.service";
import { updateContext } from "../context/contextMap.service";
import { setConversationAgent } from "../conversations/conversation.repository";
import { listRecentMessages } from "../conversations/message.repository";
import { childLogger } from "../../config/logger";
import type { Clinic, ContextMap, Conversation, Patient } from "../../types/domain";

const log = childLogger("orchestrator");

export interface OrchestratorOutput {
  responseText: string;
  images: { url: string; caption?: string }[];
  agentUsed: AgentName;
  handoff: boolean;
}

const AGENT_RUNNERS: Record<
  AgentName,
  (ctx: AgentToolContext, signals: AgentSignals, history: BaseMessage[]) => Promise<AgentRunResult>
> = {
  receptionist: runReceptionistAgent,
  scheduler: runSchedulerAgent,
  faq: runFaqAgent,
  specialist: runSpecialistAgent,
};

function appendToSummary(previous: string, userText: string, agentText: string): string {
  const MAX_CHARS = 1800;
  const next = `${previous}\nPaciente: ${userText}\nAtendente: ${agentText}`.trim();
  return next.length > MAX_CHARS ? next.slice(next.length - MAX_CHARS) : next;
}

/**
 * Ponto de entrada do console de agentes: roteia a mensagem do paciente para
 * o sub-agente correto (Recepcionista/Comercial, Agendador, FAQ ou
 * Especialista), executa suas ferramentas via LangChain e retorna a resposta
 * final pronta para envio (texto + imagens), atualizando o Mapa de Contexto.
 *
 * O fluxo e sequencial (roteia -> despacha -> trata transbordo), sem ciclos
 * ou necessidade de checkpoint entre turnos, por isso e implementado como
 * funcoes assincronas simples em vez de um StateGraph do LangGraph - a
 * mesma logica de roteador + sub-agentes especializados descrita na
 * arquitetura, sem o overhead de um motor de grafo para um pipeline linear.
 */
export async function handleIncomingMessage(input: {
  clinic: Clinic;
  patient: Patient;
  conversation: Conversation;
  context: ContextMap;
  chatId: string;
  userText: string;
}): Promise<OrchestratorOutput> {
  const ctx: AgentToolContext = {
    clinic: input.clinic,
    patient: input.patient,
    conversationId: input.conversation.id,
    chatId: input.chatId,
    context: input.context,
  };

  const recent = await listRecentMessages(input.conversation.id, 12);
  const history: BaseMessage[] = recent.map((m) =>
    m.direction === "inbound"
      ? new HumanMessage(m.transcription ?? m.content ?? "")
      : new AIMessage(m.content ?? "")
  );
  history.push(new HumanMessage(input.userText));

  const { agent, reasoning } = await routeToAgent(ctx, input.userText);
  log.info({ chatId: input.chatId, agent, reasoning }, "roteamento de conversa");

  const signals = createEmptySignals();
  const result = await AGENT_RUNNERS[agent](ctx, signals, history);

  if (signals.handoffRequested) {
    await triggerHumanHandoff({
      clinic: input.clinic,
      patient: input.patient,
      conversationId: input.conversation.id,
      chatId: input.chatId,
      reason: signals.handoffReason ?? "Motivo nao especificado pelo agente.",
      triggeredBy: "agent",
      conversationSummary: input.context.summary,
    });
  }

  const updatedSummary = appendToSummary(input.context.summary, input.userText, result.finalText);
  await updateContext(input.chatId, { currentAgent: agent, summary: updatedSummary });
  await setConversationAgent(input.conversation.id, agent);

  return {
    responseText: result.finalText,
    images: signals.images,
    agentUsed: agent,
    handoff: signals.handoffRequested,
  };
}
