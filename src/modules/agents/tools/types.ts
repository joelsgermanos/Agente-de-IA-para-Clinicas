import type { Clinic, ContextMap, Patient } from "../../../types/domain";

export interface AgentToolContext {
  clinic: Clinic;
  patient: Patient;
  conversationId: string;
  chatId: string;
  context: ContextMap;
}

export interface AgentSignals {
  handoffRequested: boolean;
  handoffReason: string | null;
  images: { url: string; caption?: string }[];
}

export function createEmptySignals(): AgentSignals {
  return { handoffRequested: false, handoffReason: null, images: [] };
}
