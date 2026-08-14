import { google } from "googleapis";
import { env } from "../../config/env";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

/**
 * Resolve as credenciais do Google Calendar. Suporta dois fluxos:
 *  1) OAuth2 com refresh token (conta pessoal/Workspace do consultorio).
 *  2) Service Account com Domain-Wide Delegation, impersonando um usuario
 *     do Workspace (necessario quando os profissionais tem calendarios
 *     proprios dentro do mesmo dominio).
 */
export function getGoogleAuthClient() {
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    return new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: SCOPES,
      subject: env.GOOGLE_IMPERSONATE_SUBJECT || undefined,
    });
  }

  const oauth2Client = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
  return oauth2Client;
}

export function getCalendarClient() {
  const auth = getGoogleAuthClient();
  return google.calendar({ version: "v3", auth });
}
