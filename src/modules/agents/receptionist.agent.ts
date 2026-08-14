import { ChatOpenAI } from "@langchain/openai";
import type { BaseMessage } from "@langchain/core/messages";
import { env } from "../../config/env";
import { runToolCallingAgent, type AgentRunResult } from "./agentExecutor";
import { receptionistPrompt } from "./prompts/receptionist.prompt";
import { createHandoffTool } from "./tools/handoff.tools";
import { createListProceduresTool, createSendProcedureImagesTool } from "./tools/procedures.tools";
import type { AgentSignals, AgentToolContext } from "./tools/types";

const llm = new ChatOpenAI({ model: env.OPENAI_CHAT_MODEL, temperature: 0.4, apiKey: env.OPENAI_API_KEY });

export async function runReceptionistAgent(
  ctx: AgentToolContext,
  signals: AgentSignals,
  history: BaseMessage[]
): Promise<AgentRunResult> {
  const tools = [
    createListProceduresTool(ctx),
    createSendProcedureImagesTool(ctx, signals),
    createHandoffTool(signals),
  ];

  return runToolCallingAgent({
    llm,
    tools,
    systemPrompt: receptionistPrompt(ctx),
    history,
  });
}
