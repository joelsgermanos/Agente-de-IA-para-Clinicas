# Gestão Operacional — Terminal de Granéis Líquidos

Sistema de gestão de **Ordens de Serviço (O.S.)** para a equipe de operação de um terminal de granéis líquidos,
implementado conforme a especificação *“Sistema de Gestão Operacional — Especificação funcional e visual”*.

Funciona de duas formas, com o mesmo código e as mesmas regras:

- **Versão web (principal):** abre no navegador por um link, sem instalar nada nos computadores. Pode ser
  publicada **de graça** no Render (site) + Turso (banco de dados). Só entra quem tem usuário e senha.
- **Versão desktop (opcional):** app Electron 100% offline, com os dados num arquivo SQLite local.

| Camada | Tecnologia |
| --- | --- |
| Servidor web | Node.js puro (`src/server/server.js`), sem frameworks |
| Banco | SQLite via libSQL: **Turso** na nuvem ou arquivo local |
| Autenticação | Usuário + senha, hash **scrypt** com salt; sessão em cookie `HttpOnly`/`SameSite=Strict` (só o hash do token fica no banco) |
| Segurança | Bloqueio após 8 tentativas de login erradas (15 min), proteção CSRF, cabeçalhos de segurança, `noindex` |
| PDF | Impressão do navegador ("Salvar como PDF"); no desktop, PDF gerado direto pelo app |
| Interface | HTML/CSS/JS puro, sem CDN nem bibliotecas externas |

## Publicar de graça na nuvem (Render + Turso)

Você precisa de uma conta no GitHub (onde já está este repositório), no **Turso** e no **Render**; os dois
últimos têm plano gratuito (os nomes dos botões podem variar um pouco conforme o painel de cada serviço).

### 1. Criar o banco de dados no Turso

1. Crie a conta em https://turso.tech (pode entrar com o GitHub).
2. No painel, clique em **Create Database**, dê um nome (ex.: `gestao-operacional`) e escolha a região mais
   próxima (ex.: São Paulo, se disponível).
3. Abra o banco e copie a **URL** (começa com `libsql://`).
4. Clique em **Create Token** (permissão de leitura e escrita, sem expiração) e copie o **token**.
   Guarde-o como uma senha: quem tiver o token acessa os dados.

### 2. Publicar o site no Render

1. Mescle o branch deste trabalho no `main` do repositório (ou escolha o branch no passo 4).
2. Crie a conta em https://render.com (entre com o GitHub) e autorize o acesso ao repositório.
3. Clique em **New › Blueprint** e selecione o repositório: o Render lê o arquivo `render.yaml` da raiz.
4. Ele pede os valores de `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN`: cole a URL e o token do passo 1.
5. Clique em **Apply**. Em alguns minutos o site fica disponível em `https://gestao-operacional.onrender.com`
   (ou nome parecido — aparece no painel).

### 3. Primeiro acesso

Abra o link e crie a conta do **Gestor**. Depois, em *Cadastros › Logins*, crie os acessos dos Planejadores e
Operadores e envie o link + usuário/senha para cada um.

### Limitações do plano gratuito

- O Render "dorme" após 15 min sem acesso; o **primeiro acesso depois disso leva cerca de 1 minuto**. Para
  evitar, dá para usar um serviço gratuito de monitoramento (ex.: UptimeRobot) chamando `/healthz` a cada 10 min.
- O Turso gratuito oferece ~5 GB de armazenamento. As imagens dos tanques são a parte que mais ocupa.
- O link é público na internet (com `noindex`, não aparece em buscadores): a proteção é o login. Use senhas
  fortes e remova os acessos de quem sair da equipe.
- Faça backups periódicos em *Cadastros › Sistema › Exportar backup* (arquivo `.json`).
- Se a rede da empresa bloquear o endereço `onrender.com`, peça à TI para liberar o domínio do site.

## Rodar no próprio computador (teste ou rede interna)

```bash
npm install
```

```bash
npm start
```

Abra http://localhost:8080. Sem `TURSO_DATABASE_URL`, os dados ficam em `data/gestao-operacional.sqlite`.
Variáveis: `PORT` (porta), `DATABASE_FILE` (arquivo local), `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (nuvem).
Para servir numa rede interna, rode num computador/servidor e acesse `http://<ip-do-servidor>:8080`.

## Versão desktop (opcional, offline)

```bash
npm run desktop
```

Instalador para Windows (execute num computador Windows):

```bash
npm run dist:win
```

Os dados ficam em `%APPDATA%\GestaoOperacional\gestao-operacional.sqlite` (ou na pasta da variável
`GESTAO_DATA_DIR`).

## Funcionalidades

- **Perfis e permissões** (Gestor, Planejador, Operador) aplicados na interface **e** no servidor.
  Operador não vê rascunhos, não cria agendamentos nem exclui O.S.; preenche a aba Final e imprime.
- **Ordens de Serviço**: numeração automática `AAAA-NNNN`; abas *Agendamento* e *Final* (Final liberada após
  planejar); chips de tipo de operação e tanques; prévia automática da imagem/diagrama do tanque para Operação
  Marítima e Transferência Interna; cálculo automático de horas trabalhadas; exclusão física com confirmação;
  impressão em PDF (Agendamento + Execução + Encerramento, imagens dos tanques em página própria com proporção
  preservada); reabertura de O.S. concluída (Gestor/Planejador).
- **Programação Diária**: O.S. do dia por bloco (6 blocos), status somente leitura, equipes de turno do dia e
  exportação em PDF com “Elaborado por”.
- **Dashboard**: filtro De/Até, 5 métricas, ocupação efetiva por equipe, planejadas × realizadas × parciais ×
  não realizadas por equipe e O.S. por tipo — barras simples escaladas pelo maior valor observado e avisos
  explícitos quando faltam dados.
- **Cadastros** (Gestor): Tanques (com imagem permanente), Clientes, Produtos, Logins e *Sistema* (escala,
  logo da empresa, backup, limpar dados). Renomear tanque/cliente/produto **migra** as O.S. existentes.

### Regras de validação (seção 8 da especificação)

- Concluir exige efetivo real, início e final da atividade e a resposta “Atividade foi realizada?”;
  “Detalhe da ocorrência” é obrigatório para *Não* ou *Parcialmente*.
- Final anterior (ou igual) ao início é bloqueado com mensagem — nunca se grava hora negativa.
- O.S. parciais contam na ocupação e têm categoria própria nos gráficos.
- Valores digitados são capturados antes de qualquer re-renderização (trocar tipo, marcar tanque etc.).
- Somente modais próprios (nenhum `alert/confirm/prompt` nativo); toast para confirmações.
- “Limpar dados” com confirmação explícita: apaga as O.S. e restaura tanques/clientes/produtos ao estado
  inicial, mantendo logins, escala e logo.

### Escala de equipes — decisão de implementação

A especificação pede, ao mesmo tempo, “exatamente 2 equipes por dia (1 diurno + 1 noturno)” e “ciclo de 12 dias
(4 D / 4 N / 4 folga) com defasagem de 3 dias”. As duas coisas não fecham juntas: com 4 equipes e 2 trabalhando
por dia, cada equipe trabalha metade dos dias, mas um ciclo 4/4/4 a faz trabalhar 2/3 deles (alguns dias teriam
3 equipes escaladas). Foi mantida a regra da cobertura — **4 dias diurno → 4 dias noturno → 8 de folga**,
equipes defasadas em 4 dias — que garante exatamente 1 equipe no diurno e 1 no noturno todos os dias. A data
âncora e a ordem das equipes são ajustáveis em *Cadastros › Sistema*, e o padrão do ciclo está em
`src/main/domain.js` (`CYCLE`, `CYCLE_OFFSET`) caso a escala real do terminal seja outra.

Capacidade da equipe = dias escalados no período × 4 operadores × 10 h efetivas (12 h − 2 h de descanso).

## Estrutura

```
src/server/server.js  servidor web (API, sessões, arquivos estáticos)
src/main/             regras e dados, compartilhados pelas versões web e desktop
  services.js         regras de negócio, permissões e sessões
  domain.js           tipos/blocos, escala de equipes, cálculos do Dashboard
  db.js               banco libSQL (Turso ou arquivo local) e backup JSON
  auth.js             hash de senhas (scrypt)
  router.js           canais da API
  main.js, preload.js app desktop (Electron)
src/renderer/         interface (index.html, styles.css, app.js, print.js, web-api.js)
render.yaml           (na raiz do repositório) publicação no Render
test/                 testes (node --test)
```

## Testes

```bash
npm test
```

O logo incluído é provisório — envie o da empresa em *Cadastros › Sistema › Logo da empresa*.
