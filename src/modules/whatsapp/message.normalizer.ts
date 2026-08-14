import type { NormalizedInboundMessage, MessageType } from "../../types/domain";
import { evolutionApi } from "./evolutionApi.client";
import { childLogger } from "../../config/logger";

const log = childLogger("message-normalizer");

interface EvolutionWebhookBody {
  event?: string;
  instance?: string;
  data?: {
    key?: { remoteJid?: string; fromMe?: boolean; id?: string; participant?: string };
    pushName?: string;
    messageTimestamp?: number | string;
    message?: {
      conversation?: string;
      extendedTextMessage?: { text?: string };
      audioMessage?: { mimetype?: string };
      imageMessage?: { mimetype?: string; caption?: string };
      documentMessage?: { mimetype?: string; caption?: string; fileName?: string };
      documentWithCaptionMessage?: { message?: { documentMessage?: { mimetype?: string; caption?: string } } };
    };
  };
}

type EvolutionMessage = NonNullable<NonNullable<EvolutionWebhookBody["data"]>["message"]>;

function detectType(message: EvolutionMessage | undefined): MessageType {
  if (!message) return "text";
  if (message.audioMessage) return "audio";
  if (message.imageMessage) return "image";
  if (message.documentMessage || message.documentWithCaptionMessage) return "document";
  return "text";
}

function extractText(message: EvolutionMessage | undefined): string | null {
  if (!message) return null;
  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.imageMessage?.caption ??
    message.documentMessage?.caption ??
    null
  );
}

/**
 * Normaliza o payload cru do webhook da Evolution API para o formato interno
 * usado pelo restante do sistema. Somente eventos `messages.upsert` com
 * conteudo relevante sao normalizados; demais eventos retornam null.
 */
export async function normalizeEvolutionWebhook(
  body: EvolutionWebhookBody
): Promise<NormalizedInboundMessage | null> {
  if (body.event !== "messages.upsert" || !body.data) {
    return null;
  }

  const { data } = body;
  const chatId = data.key?.remoteJid;
  const externalId = data.key?.id;

  if (!chatId || !externalId || chatId.endsWith("@g.us")) {
    // Ignora grupos e mensagens sem identificador.
    return null;
  }

  const type = detectType(data.message);
  const text = extractText(data.message);

  let mediaBase64: string | null = null;
  let mediaMimeType: string | null = null;

  if (type === "audio" || type === "image" || type === "document") {
    const media = await evolutionApi.fetchMediaBase64(externalId);
    if (media) {
      mediaBase64 = media.base64;
      mediaMimeType = media.mimetype;
    } else {
      log.warn({ externalId, type }, "midia nao pode ser baixada");
    }
  }

  return {
    chatId,
    fromMe: Boolean(data.key?.fromMe),
    senderPhone: chatId.split("@")[0],
    senderName: data.pushName ?? null,
    externalId,
    timestamp: Number(data.messageTimestamp ?? Date.now() / 1000),
    type,
    text,
    mediaBase64,
    mediaMimeType,
    caption: data.message?.imageMessage?.caption ?? data.message?.documentMessage?.caption ?? null,
  };
}
