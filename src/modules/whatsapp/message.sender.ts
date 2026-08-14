import { evolutionApi } from "./evolutionApi.client";
import { childLogger } from "../../config/logger";

const log = childLogger("message-sender");

const MAX_CHARS_PER_BUBBLE = 480;
const TYPING_MS_PER_CHAR = 18;
const MIN_TYPING_MS = 700;
const MAX_TYPING_MS = 3500;

export interface OutboundImage {
  url: string;
  caption?: string;
}

export interface OutboundPayload {
  text?: string;
  images?: OutboundImage[];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Quebra um texto longo em blocos menores, respeitando paragrafos quando possivel. */
function splitIntoBubbles(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const bubbles: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > MAX_CHARS_PER_BUBBLE && current) {
      bubbles.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current) bubbles.push(current);

  return bubbles.length > 0 ? bubbles : [text];
}

function typingDelayFor(text: string): number {
  return Math.min(MAX_TYPING_MS, Math.max(MIN_TYPING_MS, text.length * TYPING_MS_PER_CHAR));
}

/**
 * Envia a resposta da IA simulando comportamento humano: status "digitando...",
 * fracionamento de textos longos em multiplas mensagens e envio de imagens
 * (procedimentos) apos o texto explicativo.
 */
export async function sendOutbound(chatId: string, payload: OutboundPayload): Promise<void> {
  if (payload.text) {
    const bubbles = splitIntoBubbles(payload.text);

    for (const bubble of bubbles) {
      await evolutionApi.setPresence(chatId, "composing");
      await sleep(typingDelayFor(bubble));
      try {
        await evolutionApi.sendText(chatId, bubble);
      } catch (err) {
        log.error({ err, chatId }, "falha ao enviar mensagem de texto");
      }
    }
  }

  if (payload.images?.length) {
    for (const image of payload.images) {
      await evolutionApi.setPresence(chatId, "composing");
      await sleep(900);
      try {
        await evolutionApi.sendImage(chatId, image.url, image.caption);
      } catch (err) {
        log.error({ err, chatId, url: image.url }, "falha ao enviar imagem");
      }
    }
  }
}
