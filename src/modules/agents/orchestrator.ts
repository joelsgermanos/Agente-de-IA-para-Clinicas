import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { routeToAgent, type AgentName } from "./router.agent";
import { runReceptionistAgent } from "./receptionist.agent";
import { runSchedulerAgent } from "./scheduler.agent";
import { runFaqAgent } from "./faq.agent";
import { runSpecialistAgent } from "./specialist.agent";
import { createEmptySignals, type AgentSignals, type AgentToolContext } from "./tools/types";
import { triggerHumanHandoff } from "../handoff/handoff.service";
import { updateContext } from "../context/contextMap.service";
import { setConversationAgent } from "../conversations/conversation.repository";
import { listRecentMessages } from "../conversations/message.repository";
import { childLogger } from "../../config/logger";
import type { Clinic, ContextMap, Conversation, Patient } from "../../types/domain";

const log = childLogger("orchestrator");

const OrchestratorState = Annotation.Root({
  ctx: Annotation<AgentToolContext>(),
  history: Annotation<BaseMessage[]>(),
  routedAgent: Annotation<AgentName>(),
  signals: Annotation<AgentSignals>(),
  responseText: Annotation<string>({ reducer: (_prev, next) => next, default: () => "" }),
});

type State = typeof OrchestratorState.State;

async function routeNode(state: State): Promise<Partial<State>> {
  const latest = state.history[state.history.length - 1];
  const latestText = typeof latest?.content === "string" ? latest.content : "";
  const { agent, reasoning } = await routeToAgent(state.ctx, latestText);
  log.info({ chatId: state.ctx.chatId, agent, reasoning }, "roteamento de conversa");
  return { routedAgent: agent };
}

async function dispatchNode(state: State): Promise<Partial<State>> {
  const signals = createEmptySignals();
  const runner =
    state.routedAgent === "scheduler"
      ? runSchedulerAgent
      : state.routedAgent === "faq"
        ? runFaqAgent
        : state.routedAgent === "specialist"
          ? runSpecialistAgent
          : runReceptionistAgent;

  const result = await runner(state.ctx, signals, state.history);
  return { signals, responseText: result.finalText };
}

async function handoffNode(state: State): Promise<Partial<State>> {
  if (!state.signals.handoffRequested) return {};

  await triggerHumanHandoff({
    clinic: state.ctx.clinic,
    patient: state.ctx.patient,
    conversationId: state.ctx.conversationId,
    chatId: state.ctx.chatId,
    reason: state.signals.handoffReason ?? "Motivo nao especificado pelo agente.",
    triggeredBy: "agent",
    conversationSummary: state.ctx.context.summary,
  });

  return {};
}

const graph = new StateGraph(OrchestratorState)
  .addNode("route", routeNode)
  .addNode("dispatch", dispatchNode)
  .addNode("handoff", handoffNode)
  .addEdge(START, "route")
  .addEdge("route", "dispatch")
  .addEdge("dispatch", "handoff")
  .addEdge("handoff", END)
  .compile();

export interface OrchestratorOutput {
  responseText: string;
  images: { url: string; caption?: string }[];
  agentUsed: AgentName;
  handoff: boolean;
}

function appendToSummary(previous: string, userText: string, agentText: string): string {
  const MAX_CHARS = 1800;
  const next = `${previous}\nPaciente: ${userText}\nAtendente: ${agentText}`.trim();
  return next.length > MAX_CHARS ? next.slice(next.length - MAX_CHARS) : next;
}

/**
 * Ponto de entrada do console de agentes: roteia a mensagem do paciente para
 * o sub-agente correto, executa suas ferramentas e retorna a resposta final
 * ja pronta para envio (texto + imagens), atualizando o Mapa de Contexto.
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

  const finalState = await graph.invoke({
    ctx,
    history,
    routedAgent: "receptionist",
    signals: createEmptySignals(),
    responseText: "",
  });

  const updatedSummary = appendToSummary(input.context.summary, input.userText, finalState.responseText);
  await updateContext(input.chatId, { currentAgent: finalState.routedAgent, summary: updatedSummary });
  await setConversationAgent(input.conversation.id, finalState.routedAgent);

  return {
    responseText: finalState.responseText,
    images: finalState.signals.images,
    agentUsed: finalState.routedAgent,
    handoff: finalState.signals.handoffRequested,
  };
}
