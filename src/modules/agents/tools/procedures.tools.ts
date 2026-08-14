import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { listProcedures, findProcedureByNameLike } from "../../clinics/procedure.repository";
import type { AgentSignals, AgentToolContext } from "./types";

export function createListProceduresTool(ctx: AgentToolContext) {
  return tool(
    async () => {
      const procedures = await listProcedures(ctx.clinic.id);
      if (procedures.length === 0) return "Nenhum procedimento cadastrado.";
      return JSON.stringify(
        procedures.map((p) => ({ name: p.name, category: p.category, description: p.description }))
      );
    },
    {
      name: "list_procedures",
      description: "Lista os procedimentos oferecidos pela clinica, com categoria e descricao curta.",
      schema: z.object({}),
    }
  );
}

export function createSendProcedureImagesTool(ctx: AgentToolContext, signals: AgentSignals) {
  return tool(
    async ({ procedureName }: { procedureName: string }) => {
      const procedure = await findProcedureByNameLike(ctx.clinic.id, procedureName);
      if (!procedure || procedure.imageUrls.length === 0) {
        return `Nenhuma imagem cadastrada para "${procedureName}".`;
      }
      for (const url of procedure.imageUrls) {
        signals.images.push({ url, caption: procedure.name });
      }
      return `${procedure.imageUrls.length} imagem(ns) de "${procedure.name}" sera(ao) enviada(s) ao paciente logo apos sua mensagem.`;
    },
    {
      name: "send_procedure_images",
      description:
        "Envia ao paciente as fotos/imagens ilustrativas de um procedimento pelo nome. Use para tornar a " +
        "conversa mais visual quando o paciente demonstrar interesse em um procedimento especifico.",
      schema: z.object({ procedureName: z.string() }),
    }
  );
}

export function createProcedureDetailsTool(ctx: AgentToolContext) {
  return tool(
    async ({ procedureName }: { procedureName: string }) => {
      const procedure = await findProcedureByNameLike(ctx.clinic.id, procedureName);
      if (!procedure) return `Procedimento "${procedureName}" nao encontrado no cadastro da clinica.`;
      return JSON.stringify({
        name: procedure.name,
        description: procedure.description,
        preCare: procedure.preCare,
        postCare: procedure.postCare,
        painLevel: procedure.painLevel,
        recoveryTime: procedure.recoveryTime,
      });
    },
    {
      name: "get_procedure_details",
      description:
        "Retorna detalhes tecnicos de um procedimento: cuidados pre e pos-operatorios, nivel de dor e " +
        "tempo de recuperacao. Use para tirar duvidas tecnicas do paciente.",
      schema: z.object({ procedureName: z.string() }),
    }
  );
}
