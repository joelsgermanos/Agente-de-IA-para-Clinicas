'use strict';
/** Constantes de domínio e cálculos puros (escala de equipes, horas, dashboard). */

const OPERATION_TYPES = [
  { id: 'maritima', label: 'Operação Marítima', block: 'aquaviarias', tanks: true, image: true },
  { id: 'transferencia', label: 'Transferência Interna', block: 'transferencia', tanks: true, image: true },
  { id: 'adequacao', label: 'Sopragem / Adequação / Pigagem', block: 'adequacao', tanks: true, image: false },
  { id: 'manutencao', label: 'Apoio à Manutenção', block: 'manutencao', tanks: false, image: false },
  { id: 'pts', label: 'Abertura de PTS / Bloqueio LOTO', block: 'aberturas', tanks: false, image: false },
  { id: 'outros', label: '5S / Outros', block: 'kaizen', tanks: false, image: false },
];

const BLOCKS = [
  { id: 'aquaviarias', label: 'Operações aquaviárias' },
  { id: 'transferencia', label: 'Transferência interna' },
  { id: 'adequacao', label: 'Adequação' },
  { id: 'manutencao', label: 'Apoio à manutenção' },
  { id: 'aberturas', label: 'Aberturas e Bloqueios' },
  { id: 'kaizen', label: '5S / Kaizen / demandas extras' },
];

const TEAMS = ['A', 'B', 'C', 'D'];
const STATUSES = { rascunho: 'Rascunho', planejada: 'Planejada', concluida: 'Concluída' };
const REALIZED = { sim: 'Sim', nao: 'Não', parcial: 'Parcialmente' };

/** Jornada: 12h de turno − 2h de descanso = 10h efetivas por pessoa/turno. */
const EFFECTIVE_HOURS_PER_SHIFT = 10;
/** Operadores por equipe considerados na capacidade. */
const OPERATORS_PER_TEAM = 4;

/**
 * Escala 4x4 de 4 equipes. Cada equipe faz 4 dias no turno diurno, 4 no noturno e então folga,
 * com as equipes defasadas entre si, de forma que TODO dia haja exatamente 1 equipe no diurno,
 * 1 no noturno e 2 de folga.
 *
 * Observação: com 4 equipes e exatamente 2 trabalhando por dia, cada equipe trabalha metade dos
 * dias — por isso o ciclo fechado é de 16 dias (4 D / 4 N / 8 folga) com defasagem de 4 dias.
 * Um ciclo de 12 dias com 4 de folga faria 3 equipes trabalharem em parte dos dias.
 * A data âncora e a ordem das equipes são configuráveis em Cadastros › Sistema.
 */
const CYCLE = ['D', 'D', 'D', 'D', 'N', 'N', 'N', 'N', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F'];
const CYCLE_OFFSET = 4;
const DEFAULT_SCALE = { anchor: '2026-01-01', order: ['A', 'B', 'C', 'D'] };

const DAY_MS = 86400000;
function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return NaN;
  return Date.parse(s + 'T00:00:00Z');
}
function addDays(s, n) {
  return new Date(parseDate(s) + n * DAY_MS).toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}
function mod(a, n) {
  return ((a % n) + n) % n;
}

/** Retorna 'D' (diurno), 'N' (noturno) ou 'F' (folga) para a equipe na data. */
function teamShift(team, date, scale = DEFAULT_SCALE) {
  const idx = scale.order.indexOf(team);
  if (idx < 0) return 'F';
  const phase = mod(daysBetween(scale.anchor, date) - idx * CYCLE_OFFSET, CYCLE.length);
  return CYCLE[phase];
}

function shiftsOnDate(date, scale = DEFAULT_SCALE) {
  const r = { D: null, N: null, F: [] };
  for (const t of TEAMS) {
    const s = teamShift(t, date, scale);
    if (s === 'F') r.F.push(t);
    else r[s] = t;
  }
  return r;
}

/** Horas entre dois instantes 'YYYY-MM-DDTHH:MM'. Retorna null se inválido. */
function hoursBetween(start, end) {
  const re = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  if (!re.test(String(start || '')) || !re.test(String(end || ''))) return null;
  const ms = Date.parse(end + ':00Z') - Date.parse(start + ':00Z');
  return Math.round((ms / 3600000) * 100) / 100;
}

function typeById(id) {
  return OPERATION_TYPES.find((t) => t.id === id) || null;
}

function osTeam(os) {
  return os.team_exec || os.team_planned || null;
}

/**
 * Calcula todos os indicadores do Dashboard para o período [from, to] (inclusivo).
 * `orders` = todas as O.S. (o filtro de período/rascunho é aplicado aqui).
 */
function computeDashboard(orders, from, to, scale = DEFAULT_SCALE) {
  if (Number.isNaN(parseDate(from)) || Number.isNaN(parseDate(to))) throw new Error('Período inválido.');
  if (to < from) throw new Error('A data final do período deve ser igual ou posterior à inicial.');
  const inPeriod = orders.filter((o) => o.status !== 'rascunho' && o.date && o.date >= from && o.date <= to);
  const concluded = inPeriod.filter((o) => o.status === 'concluida');
  const withHours = (o) => o.status === 'concluida' && o.hours_worked > 0 && o.staff_real > 0;

  const days = daysBetween(from, to) + 1;
  const teams = TEAMS.map((team) => {
    let scheduledDays = 0;
    for (let i = 0; i < days; i++) if (teamShift(team, addDays(from, i), scale) !== 'F') scheduledDays++;
    const capacity = scheduledDays * OPERATORS_PER_TEAM * EFFECTIVE_HOURS_PER_SHIFT;
    const mine = inPeriod.filter((o) => osTeam(o) === team);
    const realHours = mine.filter(withHours).reduce((s, o) => s + o.hours_worked * o.staff_real, 0);
    return {
      team,
      scheduledDays,
      capacity,
      realHours: Math.round(realHours * 100) / 100,
      rate: capacity > 0 ? Math.round((realHours / capacity) * 10000) / 100 : 0,
      planned: mine.filter((o) => o.status === 'planejada').length,
      realized: mine.filter((o) => o.status === 'concluida' && o.realized === 'sim').length,
      partial: mine.filter((o) => o.status === 'concluida' && o.realized === 'parcial').length,
      notRealized: mine.filter((o) => o.status === 'concluida' && o.realized === 'nao').length,
    };
  });

  const totalCapacity = teams.reduce((s, t) => s + t.capacity, 0);
  const totalReal = inPeriod.filter(withHours).reduce((s, o) => s + o.hours_worked * o.staff_real, 0);

  return {
    from,
    to,
    days,
    metrics: {
      total: inPeriod.length,
      occupancy: totalCapacity > 0 ? Math.round((totalReal / totalCapacity) * 10000) / 100 : 0,
      concluded: concluded.length,
      pending: inPeriod.filter((o) => o.status === 'planejada').length,
      notRealized: concluded.filter((o) => o.realized === 'nao').length,
    },
    teams,
    concludedCount: concluded.length,
    concludedWithHours: concluded.filter(withHours).length,
    withoutTeam: inPeriod.filter((o) => !osTeam(o)).length,
    byType: OPERATION_TYPES.map((t) => ({
      id: t.id,
      label: t.label,
      count: inPeriod.filter((o) => o.type === t.id).length,
    })),
    capacityRule: { operators: OPERATORS_PER_TEAM, hours: EFFECTIVE_HOURS_PER_SHIFT },
  };
}

module.exports = {
  OPERATION_TYPES,
  BLOCKS,
  TEAMS,
  STATUSES,
  REALIZED,
  EFFECTIVE_HOURS_PER_SHIFT,
  OPERATORS_PER_TEAM,
  CYCLE,
  CYCLE_OFFSET,
  DEFAULT_SCALE,
  parseDate,
  addDays,
  daysBetween,
  teamShift,
  shiftsOnDate,
  hoursBetween,
  typeById,
  osTeam,
  computeDashboard,
};
