import axios, { type AxiosInstance } from "axios";
import { env } from "../../config/env";
import { childLogger } from "../../config/logger";

const log = childLogger("evolution-api");

/**
 * Cliente para a Evolution API (integracao nao-oficial de WhatsApp).
 * Os endpoints seguem o padrao da v2 da Evolution API; ajuste os paths
 * caso sua instancia utilize uma versao diferente.
 */
class EvolutionApiClient {
  private http: AxiosInstance;
  private instance: string;

  constructor() {
    this.instance = env.EVOLUTION_INSTANCE_NAME;
    this.http = axios.create({
      baseURL: env.EVOLUTION_API_URL,
      headers: { apikey: env.EVOLUTION_API_KEY },
      timeout: 20000,
    });
  }

  async sendText(chatId: string, text: string): Promise<void> {
    await this.http.post(`/message/sendText/${this.instance}`, {
      number: chatId,
      text,
    });
  }

  async sendImage(chatId: string, mediaUrl: string, caption?: string): Promise<void> {
    await this.http.post(`/message/sendMedia/${this.instance}`, {
      number: chatId,
      mediatype: "image",
      media: mediaUrl,
      caption,
    });
  }

  async sendDocument(chatId: string, mediaUrl: string, fileName: string): Promise<void> {
    await this.http.post(`/message/sendMedia/${this.instance}`, {
      number: chatId,
      mediatype: "document",
      media: mediaUrl,
      fileName,
    });
  }

  async setPresence(chatId: string, presence: "composing" | "paused" | "recording"): Promise<void> {
    try {
      await this.http.post(`/chat/sendPresence/${this.instance}`, {
        number: chatId,
        presence,
      });
    } catch (err) {
      log.warn({ err, chatId }, "falha ao definir presenca (nao critico)");
    }
  }

  /** Baixa a midia (audio/imagem/documento) em base64 a partir do id da mensagem. */
  async fetchMediaBase64(messageId: string): Promise<{ base64: string; mimetype: string } | null> {
    try {
      const { data } = await this.http.post(`/chat/getBase64FromMediaMessage/${this.instance}`, {
        message: { key: { id: messageId } },
        convertToMp4: false,
      });
      if (!data?.base64) return null;
      return { base64: data.base64, mimetype: data.mimetype ?? "application/octet-stream" };
    } catch (err) {
      log.error({ err, messageId }, "falha ao baixar midia da Evolution API");
      return null;
    }
  }
}

export const evolutionApi = new EvolutionApiClient();
