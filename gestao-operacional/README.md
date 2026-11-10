# Gestão Operacional — Terminal de Granéis Líquidos

Sistema de gestão de **Ordens de Serviço (O.S.)** para a equipe de operação de um terminal de granéis líquidos,
implementado conforme a especificação *“Sistema de Gestão Operacional — Especificação funcional e visual”*.

Aplicativo **desktop 100% offline**: roda só na máquina local, sem servidor, nuvem ou internet. Todos os dados
(O.S., cadastros, usuários e imagens dos tanques) ficam em **um único arquivo SQLite** no disco.

| Camada | Tecnologia |
| --- | --- |
| Empacotamento | Electron (instalador NSIS + versão portátil `.exe` para Windows) |
| Banco local | SQLite embutido (sql.js / WebAssembly, roda dentro do processo, sem módulo nativo) |
| Autenticação | Usuário + senha locais, hash **scrypt** com salt (nunca texto puro) |
| PDF | Gerado localmente pelo motor do próprio app (`printToPDF`) |
| Interface | HTML/CSS/JS puro, sem CDN nem bibliotecas externas |

## Uso

```bash
npm install
```

```bash
npm start
```

No **primeiro acesso** o app pede a criação da conta do **Gestor** (nome, usuário, senha). Os demais acessos
(Planejador e Operador) são criados pelo Gestor em *Cadastros › Logins*.

### Gerar o instalador para Windows

Execute num computador Windows (no Linux/macOS o electron-builder exige o Wine para editar o `.exe`):

```bash
npm run dist:win
```

Saída em `dist/`: `Gestão Operacional Setup 1.0.0.exe` (instalador) e `Gestão Operacional 1.0.0.exe` (portátil).

### Onde ficam os dados

`%APPDATA%\Gestão Operacional\gestao-operacional.sqlite` (Windows). O caminho exato aparece em
*Cadastros › Sistema › Backup*. Para usar outra pasta (ex.: pendrive com a versão portátil), defina a variável de
ambiente `GESTAO_DATA_DIR`.

**Backup:** *Cadastros › Sistema › Exportar backup* salva uma cópia do banco; *Restaurar backup* valida o arquivo e
substitui os dados (guardando antes uma cópia `*.antes-da-restauracao` do banco atual).

## Funcionalidades

- **Perfis e permissões** (Gestor, Planejador, Operador) aplicados na interface **e** no processo principal.
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
src/main/      processo principal (Electron)
  main.js      janela, IPC, PDF, backup, bloqueio de rede
  db.js        SQLite embutido + persistência atômica em arquivo
  services.js  regras de negócio e permissões
  domain.js    tipos/blocos, escala de equipes, cálculos do Dashboard
  auth.js      hash de senhas (scrypt)
  router.js    canais de API
src/renderer/  interface (index.html, styles.css, app.js, print.js)
scripts/dev-server.js  mesma interface no navegador para desenvolvimento
test/          testes das regras de negócio (node --test)
```

## Desenvolvimento

```bash
npm test
```

```bash
npm run dev:web -- --memory
```

O segundo comando abre a interface em `http://127.0.0.1:5173` usando as mesmas regras e um banco em memória
(sem `--memory`, grava em `.dev-data/`). É só uma ferramenta de desenvolvimento: o app instalado não usa rede.

O logo incluído é provisório — envie o da empresa em *Cadastros › Sistema › Logo da empresa*.
