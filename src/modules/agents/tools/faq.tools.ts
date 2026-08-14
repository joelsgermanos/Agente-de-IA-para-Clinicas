import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { listFaqs } from "../../clinics/faq.repository";
import type { AgentToolContext } from "./types";

export function createGetFaqsTool(ctx: AgentToolContext) {
  return tool(
    async ({ category }: { category?: string }) => {
      const faqs = await listFaqs(ctx.clinic.id);
      const filtered = category
        ? faqs.filter((f) => f.category?.toLowerCase().includes(category.toLowerCase()))
        : faqs;
      if (filtered.length === 0) return "Nenhuma FAQ cadastrada para esse assunto.";
      return JSON.stringify(
        filtered.map((f) => ({ question: f.question, answer: f.answer, category: f.category }))
      );
    },
    {
      name: "get_faqs",
      description:
        "Retorna as perguntas frequentes cadastradas da clinica. Use category para filtrar por assunto " +
        "(ex: 'pagamento', 'estacionamento', 'horario').",
      schema: z.object({ category: z.string().optional() }),
    }
  );
}

export function createGetClinicInfoTool(ctx: AgentToolContext) {
  return tool(
    async () => {
      return JSON.stringify({
        name: ctx.clinic.name,
        address: ctx.clinic.address,
        businessHours: ctx.clinic.businessHours,
        paymentMethods: ctx.clinic.paymentMethods,
        parkingInfo: ctx.clinic.parkingInfo,
      });
    },
    {
      name: "get_clinic_info",
      description:
        "Retorna dados cadastrais da clinica: endereco, horario de funcionamento, formas de pagamento aceitas " +
        "e informacoes de estacionamento.",
      schema: z.object({}),
    }
  );
}
