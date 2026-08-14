import { ChatOpenAI } from "@langchain/openai";
import type { BaseMessage } from "@langchain/core/messages";
import { env } from "../../config/env";
import { runToolCallingAgent, type AgentRunResult } from "./agentExecutor";
import { specialistPrompt } from "./prompts/specialist.prompt";
import { createHandoffTool } from "./tools/handoff.tools";
import { createProcedureDetailsTool } from "./tools/procedures.tools";
import type { AgentSignals, AgentToolContext } from "./tools/types";

const llm = new ChatOpenAI({ model: env.OPENAI_CHAT_MODEL, temperature: 0.3, apiKey: env.OPENAI_API_KEY });

export async function runSpecialistAgent(
  ctx: AgentToolContext,
  signals: AgentSignals,
  history: BaseMessage[]
): Promise<AgentRunResult> {
  const tools = [createProcedureDetailsTool(ctx), createHandoffTool(signals)];

  return runToolCallingAgent({
    llm,
    tools,
    systemPrompt: specialistPrompt(ctx),
    history,
  });
}
