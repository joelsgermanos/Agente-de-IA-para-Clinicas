# Sistema de Atendimento e Agendamento Automatico via WhatsApp para Clinicas

> **Também neste repositório:** [`gestao-operacional/`](gestao-operacional/) — Sistema de Gestão Operacional (O.S.) para terminal de granéis líquidos, app desktop offline (Electron + SQLite local).

Backend em **Node.js + TypeScript** para atendimento multiagente de IA via WhatsApp: qualificacao de leads,
contorno de objecoes, FAQ, duvidas tecnicas sobre procedimentos, agendamento em **Google Calendar** com
multiplos profissionais, transbordo para humanos e lembretes automaticos de consulta. Construido sem
ferramentas no-code (n8n, Zapier, etc).

## Arquitetura

```
                         ┌────────────────────┐
   WhatsApp  ───────────▶│   Evolution API     │
                         └──────────┬──────────┘
                                    │ webhook (POST /webhook/whatsapp)
                                    ▼
                         ┌────────────────────┐        ┌───────────────┐
                         │   API (Express)     │───────▶│  PostgreSQL    │
                         │  normaliza payload,  │        │ (pacientes,    │
                         │  transcreve audio,    │        │  conversas,    │
                         │  descreve imagem      │        │  agendamentos) │
                         └──────────┬──────────┘        └───────────────┘
                                    │ bufferiza (debounce)
                                    ▼
                         ┌────────────────────┐        ┌───────────────┐
                         │       Redis          │◀──────▶│  BullMQ Queues │
                         │ (contexto, pausa,     │        │ debounce +     │
                         │  buffer de mensagens) │        │ lembretes      │
                         └──────────┬──────────┘        └───────┬───────┘
                                    │ job "flush" (apos 3-5s de silencio)
                                    ▼
                         ┌────────────────────────────────────────────┐
                         │              Worker (BullMQ)                 │
                         │  ┌────────────────────────────────────────┐ │
                         │  │  Console de Agentes de IA (LangChain)    │ │
                         │  │                                          │ │
                         │  │   Roteador ─┬─▶ Recepcionista/Comercial  │ │
                         │  │             ├─▶ Agendador (Google Cal.)  │ │
                         │  │             ├─▶ FAQ                      │ │
                         │  │             └─▶ Especialista Procedim.   │ │
                         │  └────────────────────────────────────────┘ │
                         │  + Worker de Lembretes D-1 / dia da consulta │
                         └──────────────────┬───────────────────────────┘
                                    │ resposta (texto + imagens)
                                    ▼
                         ┌────────────────────┐        ┌───────────────┐
                         │  Envio simulando     │───────▶│  Google Calendar│
                         │  digitacao/fracion.   │       │  (multi-profis.)│
                         └────────────────────┘        └───────────────┘
```

### Componentes

| Componente | Responsabilidade |
|---|---|
| `src/server.ts` | API HTTP (Express): webhook do WhatsApp, health check, admin |
| `worker/index.ts` | Processo separado: worker de debounce (IA) + worker de lembretes |
| `src/modules/whatsapp` | Cliente Evolution API, normalizacao de payload, transcricao/analise de midia, envio com digitando+fracionamento, debounce (Redis+BullMQ), pausa humana |
| `src/modules/agents` | Console de multiagentes: roteador + recepcionista/comercial + agendador + FAQ + especialista, tools LangChain, orquestrador sequencial |
| `src/modules/calendar` | Integracao Google Calendar (OAuth2 ou Service Account), disponibilidade multi-profissional |
| `src/modules/conversations`, `patients`, `clinics`, `appointments`, `handoff` | Repositorios PostgreSQL |
| `src/modules/context` | Mapa de Contexto por chat no Redis |
| `src/modules/notifications` | Notificacao da equipe via WhatsApp (novo agendamento / transbordo) |
| `src/modules/reminders` | Logica de lembretes D-1 e do dia, worker BullMQ repetitivo |

## Stack

- **Node.js 20+ / TypeScript**
- **Express** (API webhook)
- **LangChain.js** (`@langchain/core` + `@langchain/openai`): tool-calling (function calling) com Zod,
  saida estruturada para o roteador, loop ReAct proprio (`agentExecutor.ts`) para os sub-agentes
- **PostgreSQL** (dados de longa duracao: clinicas, pacientes, conversas, agendamentos)
- **Redis + BullMQ** (contexto de sessao, debounce de mensagens picotadas, filas de processamento e lembretes)
- **Evolution API** (integracao WhatsApp nao-oficial)
- **Google Calendar API** (agendamento multi-profissional)
- **OpenAI Whisper** (transcricao de audio) + **GPT-4o** (agentes e analise de imagem)

## Setup

> **Nota:** a versao do `typescript` esta fixada em `5.4.5` no `package.json`. Versoes 5.7+ combinadas com
> `zod` 3.25.x disparam um bug de instanciacao de tipos excessivamente profunda (`TS2589`) nos overloads do
> `tool()` do `@langchain/core`, tornando o `tsc` extremamente lento/OOM. Nao atualize o TypeScript sem
> testar `npm run typecheck` antes.

### 1. Pre-requisitos

- Node.js 20+
- Docker e Docker Compose (recomendado)
- Uma instancia da [Evolution API](https://github.com/EvolutionAPI/evolution-api) conectada a um numero de WhatsApp
- Projeto no Google Cloud com Calendar API habilitada (OAuth2 ou Service Account)
- Chave de API da OpenAI

### 2. Variaveis de ambiente

```bash
cp .env.example .env
# preencha OPENAI_API_KEY, credenciais do Google, EVOLUTION_API_URL/KEY, etc.
```

### 3. Subir com Docker Compose

```bash
docker compose up -d postgres redis
docker compose run --rm migrate     # aplica as migrations
docker compose run --rm api node dist/scripts/seed.js   # (opcional) dados de exemplo
docker compose up -d api worker evolution-api
```

A API sobe em `http://localhost:3000`, a Evolution API em `http://localhost:8080`.
Configure o webhook global da Evolution API para `http://api:3000/webhook/whatsapp?token=<EVOLUTION_WEBHOOK_TOKEN>`
(ja pre-configurado no `docker-compose.yml` via `WEBHOOK_GLOBAL_URL`).

### 4. Desenvolvimento local (sem Docker para a API/worker)

```bash
npm install
docker compose up -d postgres redis   # so a infra
npm run migrate
npm run seed          # opcional
npm run dev:api        # terminal 1
npm run dev:worker      # terminal 2
```

## Autenticacao Google Calendar

Duas opcoes suportadas (ver `src/modules/calendar/googleAuth.ts`):

1. **OAuth2 com refresh token** — gere um refresh token com escopo `https://www.googleapis.com/auth/calendar`
   pela conta Google do consultorio (ou de cada profissional, se preferir tokens individuais) e preencha
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_REFRESH_TOKEN`.
2. **Service Account com Domain-Wide Delegation** (Google Workspace) — crie uma service account, habilite
   delegacao de dominio, autorize o escopo `calendar` no admin console e preencha
   `GOOGLE_SERVICE_ACCOUNT_JSON` (conteudo do JSON da chave) e `GOOGLE_IMPERSONATE_SUBJECT`.

Cada profissional tem seu proprio `google_calendar_id` na tabela `professionals` (pode ser o e-mail da agenda
do profissional ou um calendario secundario dedicado).

## Fluxo de uma mensagem

1. Evolution API envia o evento `messages.upsert` para `POST /webhook/whatsapp`.
2. `message.normalizer.ts` converte o payload cru para `NormalizedInboundMessage`.
3. Se a mensagem foi enviada pelo proprio numero da clinica (`fromMe`), entende-se que um humano assumiu a
   conversa: a IA e pausada (`humanPause.service.ts`, TTL configuravel) e a mensagem e apenas registrada.
4. Caso contrario, audio e transcrito (Whisper) e imagem e descrita (GPT-4o vision); o texto resultante e
   salvo no PostgreSQL e colocado no buffer Redis do chat (`debounce.service.ts`).
5. Cada nova mensagem reagenda um job atrasado no BullMQ (`MESSAGE_DEBOUNCE_MS`, default 4s). Quando o timer
   expira sem nova mensagem, o worker processa o buffer inteiro como uma unica mensagem concatenada.
6. O worker verifica se a IA esta pausada; se nao estiver, chama o **orquestrador** (`orchestrator.ts`) -
   um pipeline sequencial simples (roteia -> despacha -> trata transbordo), sem ciclos ou necessidade de
   checkpoint entre turnos, por isso implementado com funcoes assincronas em vez do `StateGraph` do
   LangGraph.js (motor de grafo com maquina de estados, util para fluxos ciclicos/com persistencia de
   estado entre execucoes, mas overhead desnecessario aqui):
   - **Agente Roteador** classifica a intencao e escolhe o sub-agente (recepcionista, agendador, FAQ,
     especialista).
   - O sub-agente executa um loop de tool-calling (LangChain) com as ferramentas do seu dominio.
   - Ferramentas de agendamento conversam com o Google Calendar e o PostgreSQL; a ferramenta de transbordo
     (`escalate_to_human`) sinaliza handoff, que o orquestrador executa (pausa a IA, registra o handoff,
     notifica a equipe).
7. A resposta final e enviada simulando digitacao e fracionada em multiplas mensagens/imagens
   (`message.sender.ts`).

## Lembretes automaticos

O worker (`worker/index.ts`) agenda uma varredura periodica (`REMINDER_CRON_INTERVAL_MS`, default 5 min) via
job repetitivo do BullMQ. A cada execucao (`reminder.service.ts`):

- Verifica consultas sem lembrete **D-1** e envia as que ja passaram do horario configurado
  (`REMINDER_D1_HOUR`) no dia anterior, no fuso horario da clinica.
- Verifica consultas sem lembrete **do dia** e envia as que estao dentro de
  `REMINDER_SAME_DAY_HOURS_BEFORE` horas do inicio.

## Estrutura de pastas

```
src/
  config/            env, logger
  db/                pool Postgres, cliente Redis, migrations SQL
  queues/            conexoes BullMQ compartilhadas
  routes/            webhook, health, admin
  types/             tipos de dominio compartilhados
  modules/
    whatsapp/        Evolution API, normalizacao, midia, envio, debounce, pausa humana
    context/          Mapa de Contexto (Redis)
    clinics/          clinica, profissionais, procedimentos, FAQs (Postgres)
    patients/         pacientes (Postgres)
    conversations/    conversas e mensagens (Postgres)
    appointments/     agendamentos (Postgres)
    calendar/          Google Calendar (auth + disponibilidade + CRUD de eventos)
    agents/            roteador, sub-agentes, tools, prompts, orquestrador (LangChain)
    handoff/           logica de transbordo humano
    notifications/     notificacao da equipe via WhatsApp
    reminders/         lembretes automaticos (service + fila + worker)
worker/               entrypoint do processo de background (debounce + lembretes)
scripts/               migrate.ts, seed.ts
```

## API HTTP

| Metodo | Rota | Descricao |
|---|---|---|
| `GET` | `/health` | Verifica conectividade com Postgres e Redis |
| `POST` | `/webhook/whatsapp` (ou `/webhook/whatsapp/:instance`) | Webhook da Evolution API. Requer `?token=` ou header `x-webhook-token` igual a `EVOLUTION_WEBHOOK_TOKEN` |
| `POST` | `/admin/chats/:chatId/pause` | Pausa manualmente a IA para o chat (header `x-admin-token`) |
| `POST` | `/admin/chats/:chatId/resume` | Devolve o atendimento para a IA (header `x-admin-token`) |

## Banco de dados

Ver `src/db/migrations/001_init.sql` para o schema completo: `clinics`, `professionals`, `patients`,
`procedures`, `faqs`, `team_members`, `conversations`, `messages`, `appointments`, `handoffs`.

```bash
npm run migrate        # aplica migrations pendentes
npm run migrate:down    # reverte a ultima migration aplicada
npm run seed            # popula uma clinica de exemplo com profissional, procedimento, FAQ e equipe
```

## Extensao / customizacao

- **Novos sub-agentes**: crie `prompts/<nome>.prompt.ts`, `tools/<nome>.tools.ts` e `<nome>.agent.ts`
  seguindo o padrao existente, registre no `router.agent.ts` (enum `AGENT_NAMES`) e no `orchestrator.ts`.
- **Multiplas clinicas**: o schema ja e multi-tenant (`clinic_id` em todas as tabelas); basta cadastrar mais
  linhas em `clinics` com `instance_name` distintos apontando para instancias diferentes da Evolution API.
- **Outro provedor de WhatsApp**: substitua `evolutionApi.client.ts` e `message.normalizer.ts` mantendo o
  contrato `NormalizedInboundMessage` — o restante do pipeline nao muda.
