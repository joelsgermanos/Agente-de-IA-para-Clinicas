import { ChatOpenAI } from "@langchain/openai";
import type { BaseMessage } from "@langchain/core/messages";
import { env } from "../../config/env";
import { runToolCallingAgent, type AgentRunResult } from "./agentExecutor";
import { faqPrompt } from "./prompts/faq.prompt";
import { createHandoffTool } from "./tools/handoff.tools";
import { createGetFaqsTool, createGetClinicInfoTool } from "./tools/faq.tools";
import type { AgentSignals, AgentToolContext } from "./tools/types";

const llm = new ChatOpenAI({ model: env.OPENAI_CHAT_MODEL, temperature: 0.2, apiKey: env.OPENAI_API_KEY });

export async function runFaqAgent(
  ctx: AgentToolContext,
  signals: AgentSignals,
  history: BaseMessage[]
): Promise<AgentRunResult> {
  const tools = [createGetFaqsTool(ctx), createGetClinicInfoTool(ctx), createHandoffTool(signals)];

  return runToolCallingAgent({
    llm,
    tools,
    systemPrompt: faqPrompt(ctx),
    history,
  });
}
