import { pool } from "../src/db/pool";
import { env } from "../src/config/env";
import { childLogger } from "../src/config/logger";

const log = childLogger("seed");

async function main() {
  const clinicResult = await pool.query<{ id: string }>(
    `INSERT INTO clinics (name, instance_name, address, timezone, business_hours, payment_methods, parking_info)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      env.DEFAULT_CLINIC_NAME,
      env.EVOLUTION_INSTANCE_NAME,
      env.DEFAULT_CLINIC_ADDRESS,
      env.APP_TIMEZONE,
      JSON.stringify({
        mon: ["09:00", "19:00"],
        tue: ["09:00", "19:00"],
        wed: ["09:00", "19:00"],
        thu: ["09:00", "19:00"],
        fri: ["09:00", "19:00"],
        sat: ["09:00", "13:00"],
        sun: null,
      }),
      ["Pix", "Cartao de credito", "Cartao de debito", "Dinheiro"],
      "Estacionamento conveniado em frente a clinica, com desconto mediante validacao na recepcao.",
    ]
  );
  const clinicId = clinicResult.rows[0].id;
  log.info({ clinicId }, "clinica criada");

  const profResult = await pool.query<{ id: string }>(
    `INSERT INTO professionals (clinic_id, name, specialty, google_calendar_id, slot_duration_minutes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [clinicId, "Dra. Ana Souza", "Dermatologia Estetica", "dra.ana@example.com", 30]
  );
  log.info({ professionalId: profResult.rows[0].id }, "profissional criado");

  await pool.query(
    `INSERT INTO procedures (clinic_id, name, category, description, pre_care, post_care, pain_level, recovery_time, image_urls)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      clinicId,
      "Botox",
      "Facial",
      "Aplicacao de toxina botulinica para suavizar linhas de expressao.",
      "Evitar anticoagulantes e alcool 24h antes.",
      "Nao deitar por 4h e evitar exercicios fisicos por 24h.",
      "Baixo - similar a uma picada leve",
      "Sem tempo de recuperacao, pequenos hematomas podem ocorrer.",
      ["https://exemplo.com/imagens/botox-1.jpg"],
    ]
  );

  await pool.query(
    `INSERT INTO faqs (clinic_id, category, question, answer)
     VALUES ($1, $2, $3, $4)`,
    [
      clinicId,
      "geral",
      "Qual o endereco da clinica?",
      `Estamos localizados em ${env.DEFAULT_CLINIC_ADDRESS}.`,
    ]
  );

  await pool.query(
    `INSERT INTO team_members (clinic_id, name, whatsapp_number, role)
     VALUES ($1, $2, $3, $4)`,
    [clinicId, "Secretaria", "5511999990000", "secretaria"]
  );

  log.info("seed concluido");
  await pool.end();
}

main().catch((err) => {
  log.error({ err }, "falha ao rodar seed");
  process.exit(1);
});
