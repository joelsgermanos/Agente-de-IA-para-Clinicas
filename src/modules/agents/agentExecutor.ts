import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, BaseMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { childLogger } from "../../config/logger";

const log = childLogger("agent-executor");

export interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  output: string;
}

export interface AgentRunResult {
  finalText: string;
  toolCalls: ToolCallRecord[];
}

/**
 * Loop manual de tool-calling (padrao ReAct) sobre um ChatOpenAI com tools
 * vinculadas. Evitamos o prebuilt do LangGraph aqui para manter o controle
 * explicito sobre a extracao de efeitos colaterais das tools (ex: handoff,
 * imagens de procedimentos) apos cada execucao.
 */
export async function runToolCallingAgent(params: {
  llm: ChatOpenAI;
  tools: StructuredToolInterface[];
  systemPrompt: string;
  history: BaseMessage[];
  maxIterations?: number;
}): Promise<AgentRunResult> {
  const modelWithTools = params.llm.bindTools(params.tools);
  const toolByName = new Map(params.tools.map((t) => [t.name, t]));
  const toolCalls: ToolCallRecord[] = [];

  let conversation: BaseMessage[] = [new SystemMessage(params.systemPrompt), ...params.history];

  for (let i = 0; i < (params.maxIterations ?? 5); i++) {
    const response = (await modelWithTools.invoke(conversation)) as AIMessage;
    conversation = [...conversation, response];

    if (!response.tool_calls || response.tool_calls.length === 0) {
      return { finalText: String(response.content ?? "").trim(), toolCalls };
    }

    for (const call of response.tool_calls) {
      const toolFn = toolByName.get(call.name);
      let output: string;

      if (!toolFn) {
        output = `Ferramenta desconhecida: ${call.name}`;
        log.warn({ tool: call.name }, "modelo chamou ferramenta inexistente");
      } else {
        try {
          const rawOutput = await toolFn.invoke(call.args as Record<string, unknown>);
          output = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput);
        } catch (err) {
          output = `Erro ao executar a ferramenta: ${(err as Error).message}`;
          log.error({ err, tool: call.name }, "falha na execucao da tool");
        }
      }

      toolCalls.push({ toolName: call.name, args: (call.args as Record<string, unknown>) ?? {}, output });
      conversation.push(
        new ToolMessage({ content: output, tool_call_id: call.id ?? call.name, name: call.name })
      );
    }
  }

  log.warn("numero maximo de iteracoes do agente atingido");
  return {
    finalText:
      "Desculpe, tive uma dificuldade para concluir sua solicitacao agora. Vou chamar um atendente humano para te ajudar.",
    toolCalls,
  };
}
