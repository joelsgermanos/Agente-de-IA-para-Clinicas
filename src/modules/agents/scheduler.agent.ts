import { ChatOpenAI } from "@langchain/openai";
import type { BaseMessage } from "@langchain/core/messages";
import { env } from "../../config/env";
import { runToolCallingAgent, type AgentRunResult } from "./agentExecutor";
import { schedulerPrompt } from "./prompts/scheduler.prompt";
import { createHandoffTool } from "./tools/handoff.tools";
import {
  createCheckAvailabilityTool,
  createCreateAppointmentTool,
  createRescheduleAppointmentTool,
  createCancelAppointmentTool,
  createListMyAppointmentsTool,
} from "./tools/calendar.tools";
import type { AgentSignals, AgentToolContext } from "./tools/types";

const llm = new ChatOpenAI({ model: env.OPENAI_CHAT_MODEL, temperature: 0.2, apiKey: env.OPENAI_API_KEY });

export async function runSchedulerAgent(
  ctx: AgentToolContext,
  signals: AgentSignals,
  history: BaseMessage[]
): Promise<AgentRunResult> {
  const tools = [
    createCheckAvailabilityTool(ctx),
    createCreateAppointmentTool(ctx),
    createRescheduleAppointmentTool(ctx),
    createCancelAppointmentTool(ctx),
    createListMyAppointmentsTool(ctx),
    createHandoffTool(signals),
  ];

  return runToolCallingAgent({
    llm,
    tools,
    systemPrompt: schedulerPrompt(ctx),
    history,
  });
}
