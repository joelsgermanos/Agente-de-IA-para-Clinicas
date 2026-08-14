export type MessageDirection = "inbound" | "outbound";
export type MessageType = "text" | "audio" | "image" | "document" | "system";
export type ConversationStatus = "active" | "paused" | "handoff" | "closed";
export type AppointmentStatus = "scheduled" | "confirmed" | "cancelled" | "completed" | "no_show";

export interface Clinic {
  id: string;
  name: string;
  whatsappNumber: string | null;
  address: string | null;
  timezone: string;
  businessHours: Record<string, [string, string] | null>;
  paymentMethods: string[];
  parkingInfo: string | null;
}

export interface Professional {
  id: string;
  clinicId: string;
  name: string;
  specialty: string | null;
  googleCalendarId: string;
  slotDurationMinutes: number;
  active: boolean;
}

export interface Patient {
  id: string;
  clinicId: string;
  phone: string;
  name: string | null;
  email: string | null;
  notes: string | null;
}

export interface Conversation {
  id: string;
  clinicId: string;
  patientId: string;
  chatId: string;
  status: ConversationStatus;
  currentAgent: string;
  contextSummary: string | null;
  lastMessageAt: string;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  messageType: MessageType;
  content: string | null;
  mediaUrl: string | null;
  transcription: string | null;
  agent: string | null;
  createdAt: string;
}

export interface Appointment {
  id: string;
  clinicId: string;
  patientId: string;
  professionalId: string;
  procedureId: string | null;
  procedureLabel: string | null;
  googleEventId: string | null;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  reminderD1SentAt: string | null;
  reminderSameDaySentAt: string | null;
}

/** Mensagem normalizada, independente do provedor de WhatsApp de origem. */
export interface NormalizedInboundMessage {
  chatId: string;
  fromMe: boolean;
  senderPhone: string;
  senderName: string | null;
  externalId: string;
  timestamp: number;
  type: MessageType;
  text: string | null;
  mediaBase64: string | null;
  mediaMimeType: string | null;
  caption: string | null;
}

/** Mapa de contexto do usuario mantido no Redis entre turnos da conversa. */
export interface ContextMap {
  chatId: string;
  clinicId: string;
  patientId: string;
  conversationId: string;
  currentAgent: string;
  intent: string | null;
  collectedData: {
    fullName?: string;
    email?: string;
    phone?: string;
    desiredProcedure?: string;
    preferredProfessionalId?: string;
    preferredDate?: string;
    appointmentIdInProgress?: string;
  };
  summary: string;
  updatedAt: number;
}
