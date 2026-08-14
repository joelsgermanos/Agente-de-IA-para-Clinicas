import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { addMinutes } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import {
  findProfessionalByNameLike,
  findProfessionalById,
  listActiveProfessionals,
} from "../../clinics/clinic.repository";
import { findProcedureByNameLike } from "../../clinics/procedure.repository";
import {
  findAvailableSlots,
  getBusyPeriods,
  createAppointmentEvent,
  rescheduleAppointmentEvent,
  cancelAppointmentEvent,
} from "../../calendar/googleCalendar.service";
import {
  createAppointment,
  findUpcomingAppointmentsForPatient,
  rescheduleAppointment,
  cancelAppointment,
} from "../../appointments/appointment.repository";
import { updatePatientDetails } from "../../patients/patient.repository";
import { notifyTeamNewAppointment } from "../../notifications/teamNotifier.service";
import { childLogger } from "../../../config/logger";
import type { AgentToolContext } from "./types";

const log = childLogger("calendar-tools");

export function createCheckAvailabilityTool(ctx: AgentToolContext) {
  return tool(
    async ({ professionalName, fromDate }: { professionalName?: string; fromDate?: string }) => {
      let professional = professionalName
        ? await findProfessionalByNameLike(ctx.clinic.id, professionalName)
        : null;

      if (!professional) {
        const list = await listActiveProfessionals(ctx.clinic.id);
        if (list.length === 0) return "Nenhum profissional cadastrado na clinica.";
        if (list.length > 1) {
          return `Ha mais de um profissional disponivel: ${list
            .map((p) => `${p.name} (${p.specialty ?? "geral"})`)
            .join(", ")}. Pergunte ao paciente qual prefere antes de checar horarios.`;
        }
        professional = list[0];
      }

      const from = fromDate ? new Date(`${fromDate}T00:00:00`) : new Date();
      if (Number.isNaN(from.getTime())) return "Data inicial invalida, use o formato YYYY-MM-DD.";

      const slots = await findAvailableSlots(ctx.clinic, professional, from, 7);
      const top = slots.slice(0, 8);

      if (top.length === 0) {
        return `Nenhum horario livre encontrado para ${professional.name} nos proximos 7 dias.`;
      }

      return JSON.stringify({
        professionalId: professional.id,
        professionalName: professional.name,
        slots: top.map((s) => ({
          startIso: s.start.toISOString(),
          label: formatInTimeZone(s.start, ctx.clinic.timezone, "EEEE, dd/MM 'as' HH:mm", { locale: ptBR }),
        })),
      });
    },
    {
      name: "check_availability",
      description:
        "Consulta os horarios livres de um profissional nos proximos dias, cruzando o horario de " +
        "funcionamento da clinica com a agenda no Google Calendar. Sempre use antes de agendar.",
      schema: z.object({
        professionalName: z.string().optional().describe("Nome do profissional. Se omitido e houver apenas um, sera usado automaticamente."),
        fromDate: z.string().optional().describe("Data inicial no formato YYYY-MM-DD. Padrao: hoje."),
      }),
    }
  );
}

export function createCreateAppointmentTool(ctx: AgentToolContext) {
  return tool(
    async ({
      professionalName,
      procedureName,
      patientFullName,
      patientEmail,
      startIso,
    }: {
      professionalName: string;
      procedureName: string;
      patientFullName: string;
      patientEmail: string;
      startIso: string;
    }) => {
      const professional = await findProfessionalByNameLike(ctx.clinic.id, professionalName);
      if (!professional) return `Profissional "${professionalName}" nao encontrado.`;

      const start = new Date(startIso);
      if (Number.isNaN(start.getTime())) return "Data/hora invalida.";
      const end = addMinutes(start, professional.slotDurationMinutes);

      const busy = await getBusyPeriods(professional, start, end);
      const conflict = busy.some((b) => start < b.end && end > b.start);
      if (conflict) {
        return "Esse horario acabou de ser ocupado. Use check_availability novamente e peca ao paciente para escolher outro horario.";
      }

      await updatePatientDetails(ctx.patient.id, { name: patientFullName, email: patientEmail });
      const procedure = await findProcedureByNameLike(ctx.clinic.id, procedureName);

      let eventId: string;
      try {
        eventId = await createAppointmentEvent({
          professional,
          timezone: ctx.clinic.timezone,
          summary: `${procedureName} - ${patientFullName}`,
          description: `Paciente: ${patientFullName}\nTelefone: ${ctx.patient.phone}\nEmail: ${patientEmail}\nProcedimento: ${procedureName}`,
          start,
          end,
          attendeeEmail: patientEmail,
          attendeeName: patientFullName,
        });
      } catch (err) {
        log.error({ err }, "falha ao criar evento no Google Calendar");
        return "Nao foi possivel criar o evento no Google Calendar agora. Sugira tentar novamente ou acione escalate_to_human.";
      }

      const appointment = await createAppointment({
        clinicId: ctx.clinic.id,
        patientId: ctx.patient.id,
        professionalId: professional.id,
        procedureId: procedure?.id ?? null,
        procedureLabel: procedureName,
        googleEventId: eventId,
        startsAt: start,
        endsAt: end,
      });

      await notifyTeamNewAppointment({
        clinic: ctx.clinic,
        patient: { ...ctx.patient, name: patientFullName, email: patientEmail },
        professional,
        procedureLabel: procedureName,
        startsAt: start,
        conversationSummary: ctx.context.summary,
      });

      const label = formatInTimeZone(start, ctx.clinic.timezone, "EEEE, dd/MM 'as' HH:mm", { locale: ptBR });
      return `Consulta confirmada (id ${appointment.id}) com ${professional.name} em ${label}.`;
    },
    {
      name: "create_appointment",
      description:
        "Cria um agendamento definitivo no Google Calendar e no sistema. So use depois de coletar nome " +
        "completo, e-mail e o procedimento desejado, e apos confirmar o horario com check_availability.",
      schema: z.object({
        professionalName: z.string(),
        procedureName: z.string(),
        patientFullName: z.string(),
        patientEmail: z.string().email(),
        startIso: z.string().describe("Data/hora ISO 8601 do horario escolhido (retornado por check_availability)."),
      }),
    }
  );
}

export function createRescheduleAppointmentTool(ctx: AgentToolContext) {
  return tool(
    async ({ newStartIso, appointmentId }: { newStartIso: string; appointmentId?: string }) => {
      const upcoming = await findUpcomingAppointmentsForPatient(ctx.patient.id);
      const target = appointmentId
        ? upcoming.find((a) => a.id === appointmentId)
        : upcoming.length === 1
          ? upcoming[0]
          : null;

      if (!target) {
        if (upcoming.length > 1) {
          return `O paciente tem mais de uma consulta futura: ${upcoming
            .map((a) => `${a.id} em ${a.startsAt}`)
            .join(", ")}. Pergunte qual deseja reagendar e chame novamente com appointmentId.`;
        }
        return "Nenhuma consulta futura encontrada para reagendar.";
      }

      const professional = await findProfessionalById(target.professionalId);
      if (!professional) return "Profissional da consulta nao encontrado.";

      const newStart = new Date(newStartIso);
      if (Number.isNaN(newStart.getTime())) return "Data/hora invalida.";
      const newEnd = addMinutes(newStart, professional.slotDurationMinutes);

      if (target.googleEventId) {
        await rescheduleAppointmentEvent(professional, target.googleEventId, newStart, newEnd, ctx.clinic.timezone);
      }
      await rescheduleAppointment(target.id, newStart, newEnd);

      const label = formatInTimeZone(newStart, ctx.clinic.timezone, "EEEE, dd/MM 'as' HH:mm", { locale: ptBR });
      return `Consulta reagendada para ${label}.`;
    },
    {
      name: "reschedule_appointment",
      description: "Reagenda uma consulta futura do paciente para um novo horario ja verificado como livre.",
      schema: z.object({
        newStartIso: z.string(),
        appointmentId: z.string().optional().describe("Necessario apenas se o paciente tiver mais de uma consulta futura."),
      }),
    }
  );
}

export function createCancelAppointmentTool(ctx: AgentToolContext) {
  return tool(
    async ({ appointmentId }: { appointmentId?: string }) => {
      const upcoming = await findUpcomingAppointmentsForPatient(ctx.patient.id);
      const target = appointmentId
        ? upcoming.find((a) => a.id === appointmentId)
        : upcoming.length === 1
          ? upcoming[0]
          : null;

      if (!target) {
        if (upcoming.length > 1) {
          return `O paciente tem mais de uma consulta futura: ${upcoming
            .map((a) => `${a.id} em ${a.startsAt}`)
            .join(", ")}. Pergunte qual deseja cancelar e chame novamente com appointmentId.`;
        }
        return "Nenhuma consulta futura encontrada para cancelar.";
      }

      const professional = await findProfessionalById(target.professionalId);
      if (professional && target.googleEventId) {
        await cancelAppointmentEvent(professional, target.googleEventId);
      }
      await cancelAppointment(target.id);

      return "Consulta cancelada com sucesso.";
    },
    {
      name: "cancel_appointment",
      description: "Cancela uma consulta futura do paciente.",
      schema: z.object({
        appointmentId: z.string().optional().describe("Necessario apenas se o paciente tiver mais de uma consulta futura."),
      }),
    }
  );
}

export function createListMyAppointmentsTool(ctx: AgentToolContext) {
  return tool(
    async () => {
      const upcoming = await findUpcomingAppointmentsForPatient(ctx.patient.id);
      if (upcoming.length === 0) return "O paciente nao possui consultas futuras agendadas.";
      return JSON.stringify(
        upcoming.map((a) => ({ id: a.id, startsAt: a.startsAt, status: a.status, procedure: a.procedureLabel }))
      );
    },
    {
      name: "list_my_appointments",
      description: "Lista as consultas futuras ja agendadas do paciente atual.",
      schema: z.object({}),
    }
  );
}
