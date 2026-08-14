import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { env } from "../../config/env";
import { childLogger } from "../../config/logger";

const log = childLogger("media-service");
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

function extensionForMime(mimetype: string): string {
  if (mimetype.includes("ogg")) return "ogg";
  if (mimetype.includes("mpeg") || mimetype.includes("mp3")) return "mp3";
  if (mimetype.includes("wav")) return "wav";
  if (mimetype.includes("mp4") || mimetype.includes("m4a")) return "m4a";
  return "ogg";
}

/** Transcreve audio (base64) recebido via WhatsApp usando o Whisper da OpenAI. */
export async function transcribeAudio(base64: string, mimetype: string): Promise<string> {
  const buffer = Buffer.from(base64, "base64");
  const ext = extensionForMime(mimetype);
  const file = await toFile(buffer, `audio.${ext}`, { type: mimetype });

  try {
    const result = await openai.audio.transcriptions.create({
      file,
      model: env.OPENAI_WHISPER_MODEL,
      language: "pt",
    });
    return result.text.trim();
  } catch (err) {
    log.error({ err }, "falha ao transcrever audio");
    throw err;
  }
}

/** Descreve o conteudo de uma imagem enviada pelo paciente (ex: foto de regiao a tratar, print de duvida). */
export async function describeImage(base64: string, mimetype: string, caption: string | null): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: env.OPENAI_VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Descreva objetivamente o que aparece nesta imagem enviada por um paciente de clinica " +
                "no contexto de atendimento via WhatsApp. Se houver texto na imagem (print), transcreva-o. " +
                (caption ? `Legenda enviada junto: "${caption}".` : "Sem legenda."),
            },
            { type: "image_url", image_url: { url: `data:${mimetype};base64,${base64}` } },
          ],
        },
      ],
      max_tokens: 300,
    });
    return response.choices[0]?.message?.content?.trim() ?? "Imagem recebida.";
  } catch (err) {
    log.error({ err }, "falha ao analisar imagem");
    return "Imagem recebida (nao foi possivel analisar o conteudo automaticamente).";
  }
}
