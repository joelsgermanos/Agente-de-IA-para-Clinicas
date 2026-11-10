'use strict';
/** Mapa canal → operação. Usado pelo servidor web e pelo IPC do app desktop. */
const routes = {
  'app:meta': (s) => s.meta(),
  'auth:status': (s) => s.authStatus(),
  'auth:setup': (s, p) => s.setup(p),
  'auth:login': (s, p) => s.login(p),
  'auth:logout': (s) => s.logout(),
  'auth:changePassword': (s, p) => s.changePassword(p),

  'os:list': (s) => s.osList(),
  'os:get': (s, p) => s.osGet(p.id),
  'os:create': (s) => s.osCreate(),
  'os:saveAgendamento': (s, p) => s.osSaveAgendamento(p.id, p.data, { plan: !!p.plan }),
  'os:saveFinal': (s, p) => s.osSaveFinal(p.id, p.data, { conclude: !!p.conclude }),
  'os:reopen': (s, p) => s.osReopen(p.id),
  'os:delete': (s, p) => s.osDelete(p.id),

  'prog:day': (s, p) => s.programacao(p.date),
  'dash:get': (s, p) => s.dashboard(p),

  'cad:lookups': (s) => s.lookups(),
  'cad:tankImage': (s, p) => s.tankImage(p.code),
  'cad:tankAdd': (s, p) => s.tankAdd(p.code),
  'cad:tankRename': (s, p) => s.tankRename(p.id, p.code),
  'cad:tankRemove': (s, p) => s.tankRemove(p.id),
  'cad:tankSetImage': (s, p) => s.tankSetImage(p.id, p.dataUrl, p.name),
  'cad:refAdd': (s, p) => s.refAdd(p.kind, p.name),
  'cad:refRename': (s, p) => s.refRename(p.kind, p.id, p.name),
  'cad:refRemove': (s, p) => s.refRemove(p.kind, p.id),

  'users:list': (s) => s.usersList(),
  'users:add': (s, p) => s.usersAdd(p),
  'users:update': (s, p) => s.usersUpdate(p),
  'users:remove': (s, p) => s.usersRemove(p.id),

  'scale:get': (s, p) => s.scaleGet(p),
  'scale:set': (s, p) => s.scaleSet(p),
  'settings:logo': (s, p) => s.logoSet(p.dataUrl),
  'admin:reset': (s) => s.resetData(),
  'backup:export': (s) => s.backupExport(),
  'backup:import': (s, p) => s.backupImport(p.data),
};

/** Executa uma rota e devolve sempre { ok, data } ou { ok:false, error } (erros de negócio viram mensagem). */
async function dispatch(services, channel, payload) {
  const fn = routes[channel];
  if (!fn) return { ok: false, error: 'Operação desconhecida: ' + channel };
  try {
    const data = await fn(services, payload || {});
    return { ok: true, data };
  } catch (e) {
    if (e && e.userFacing) return { ok: false, error: e.message, code: e.code };
    console.error('[erro]', channel, e);
    return { ok: false, error: 'Erro inesperado: ' + (e && e.message ? e.message : String(e)) };
  }
}

module.exports = { routes, dispatch };
