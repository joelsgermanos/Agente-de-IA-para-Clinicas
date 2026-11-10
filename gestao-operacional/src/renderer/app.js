/* Interface do Sistema de Gestão Operacional. Sem frameworks nem CDN: tudo roda localmente. */
(function () {
  'use strict';

  const { esc, fmtDate, fmtDT, fmtNum } = window.PrintTemplates;
  const $app = document.getElementById('app');
  const $modal = document.getElementById('modal-root');
  const $toast = document.getElementById('toast');

  // ------------------------------------------------------------------ estado
  const S = {
    meta: null,
    auth: null, // { needsSetup, user }
    view: 'os',
    lookups: { tanks: [], clients: [], products: [] },
    osList: [],
    osFilter: { q: '', status: '' },
    os: null, // O.S. aberta
    osTab: 'agend',
    form: null, // { agend:{}, final:{} } — valores digitados (fonte da verdade do formulário)
    dirty: false,
    formError: null,
    tankImgs: {}, // cache code -> {image_data, image_name} | null
    prog: { date: null, data: null },
    dash: { from: null, to: null, data: null, error: null },
    cadTab: 'tanks',
    users: [],
    scale: null,
    busy: false,
  };

  const PROFILE_HINTS = {
    gestor: 'Gerencia tudo: O.S., programação, dashboard, cadastros e logins.',
    planejador: 'Planeja e agenda as O.S., acompanha a programação e o dashboard.',
    operador: 'Executa as O.S. planejadas e registra o encerramento na aba Final.',
  };
  const TANK_TYPES = () => S.meta.types.filter((t) => t.tanks).map((t) => t.id);

  // ------------------------------------------------------------------ utilitários
  const api = async (channel, payload) => {
    const r = await window.api.call(channel, payload);
    if (!r.ok) {
      if (r.code === 'AUTH' && S.auth && S.auth.user) {
        S.auth.user = null;
        render();
      }
      throw new Error(r.error);
    }
    return r.data;
  };
  const role = () => (S.auth && S.auth.user ? S.auth.user.role : null);
  const can = {
    plan: () => ['gestor', 'planejador'].includes(role()),
    dash: () => ['gestor', 'planejador'].includes(role()),
    cad: () => role() === 'gestor',
  };
  const logo = () => (S.meta && S.meta.logo) || window.DEFAULT_LOGO;
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const pct = (n) => `${Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  const typeOf = (id) => S.meta.types.find((t) => t.id === id) || null;
  const badge = (status) => `<span class="badge b-${esc(status)}">${esc(S.meta.statuses[status] || status)}</span>`;
  const sel = (cond) => (cond ? ' selected' : '');
  const dis = (cond) => (cond ? ' disabled' : '');

  let toastTimer = null;
  function toast(msg, isError) {
    $toast.textContent = msg;
    $toast.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($toast.className = 'toast' + (isError ? ' error' : '')), isError ? 4200 : 2400);
  }

  /**
   * Modal próprio do sistema (nunca confirm/alert/prompt nativos).
   * fields: [{ name, label, type, value, options, required, help }]
   * Resolve com { ok, values } ou null ao cancelar.
   */
  function modal({ title, message, fields = [], confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false, validate }) {
    return new Promise((resolve) => {
      const fieldHtml = fields
        .map((f) => {
          const id = 'mf-' + f.name;
          let input;
          if (f.type === 'select') {
            input = `<select id="${id}" name="${esc(f.name)}">${f.options.map((o) => `<option value="${esc(o.value)}"${sel(o.value === f.value)}>${esc(o.label)}</option>`).join('')}</select>`;
          } else {
            input = `<input id="${id}" name="${esc(f.name)}" type="${esc(f.type || 'text')}" value="${esc(f.value || '')}" autocomplete="off">`;
          }
          return `<div class="field"><label for="${id}" class="${f.required ? 'req' : ''}">${esc(f.label)}</label>${input}${f.help ? `<span class="help">${esc(f.help)}</span>` : ''}</div>`;
        })
        .join('');
      $modal.innerHTML = `
        <div class="overlay" data-modal-overlay>
          <div class="modal" role="dialog" aria-modal="true">
            <h2>${esc(title)}</h2>
            ${message ? `<p class="muted">${message}</p>` : ''}
            ${fields.length ? `<form class="stack" data-modal-form onsubmit="return false">${fieldHtml}<div class="notice warn hidden" data-modal-err></div></form>` : ''}
            <div class="form-actions">
              <button class="btn" data-m="cancel">${esc(cancelLabel)}</button>
              <button class="btn ${danger ? 'btn-primary" style="background:var(--red);border-color:var(--red)' : 'btn-primary'}" data-m="ok">${esc(confirmLabel)}</button>
            </div>
          </div>
        </div>`;
      const close = (val) => {
        $modal.innerHTML = '';
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const values = () => {
        const v = {};
        $modal.querySelectorAll('[name]').forEach((el) => (v[el.name] = el.value));
        return v;
      };
      const submit = async () => {
        const v = values();
        const missing = fields.filter((f) => f.required && !String(v[f.name] || '').trim());
        let err = missing.length ? 'Preencha: ' + missing.map((f) => f.label).join(', ') + '.' : null;
        if (!err && validate) err = await validate(v);
        if (err) {
          const box = $modal.querySelector('[data-modal-err]');
          box.textContent = err;
          box.classList.remove('hidden');
          return;
        }
        close({ ok: true, values: v });
      };
      const onKey = (e) => {
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter' && fields.length && e.target.tagName === 'INPUT') submit();
      };
      document.addEventListener('keydown', onKey);
      $modal.querySelector('[data-m=cancel]').onclick = () => close(null);
      $modal.querySelector('[data-m=ok]').onclick = submit;
      $modal.querySelector('[data-modal-overlay]').onclick = (e) => {
        if (e.target.hasAttribute('data-modal-overlay')) close(null);
      };
      const first = $modal.querySelector('input, select');
      (first || $modal.querySelector('[data-m=ok]')).focus();
    });
  }
  const confirmBox = async (title, message, opts = {}) => !!(await modal({ title, message, ...opts }));

  async function printDocument(html, filename) {
    if (window.api.savePdf) {
      const r = await window.api.savePdf(html, filename);
      if (!r.ok) throw new Error(r.error);
      if (r.data.saved) toast('PDF gerado');
      return;
    }
    // modo navegador (desenvolvimento): usa o diálogo de impressão do navegador
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(frame);
    frame.srcdoc = html;
    frame.onload = () => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => frame.remove(), 1000);
    };
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
      r.readAsDataURL(file);
    });
  }
  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null);
      input.click();
    });
  }

  // ------------------------------------------------------------------ formulário de O.S.
  const AGEND_FIELDS = ['type', 'description', 'tanks', 'date', 'time', 'client', 'volume', 'product', 'team_planned', 'staff_planned'];
  const FINAL_FIELDS = ['executor', 'team_exec', 'staff_real', 'start_at', 'end_at', 'realized', 'area_ok', 'occurrence'];

  function formFromOs(os) {
    const f = { agend: {}, final: {} };
    for (const k of AGEND_FIELDS) f.agend[k] = k === 'tanks' ? [...(os.tanks || [])] : os[k] == null ? '' : String(os[k]);
    for (const k of FINAL_FIELDS) f.final[k] = k === 'area_ok' ? !!os.area_ok : os[k] == null ? '' : String(os[k]);
    return f;
  }

  /** Captura todos os valores digitados no DOM antes de qualquer nova renderização (evita perda de dados). */
  function captureForm() {
    if (!S.form) return;
    $app.querySelectorAll('[data-f]').forEach((el) => {
      const [group, key] = el.dataset.f.split('.');
      if (!S.form[group]) return;
      S.form[group][key] = el.type === 'checkbox' ? el.checked : el.value;
    });
  }

  async function guardDirty() {
    if (!S.os || !S.dirty) return true;
    const ok = await confirmBox('Descartar alterações?', 'Há alterações não salvas nesta O.S. Deseja sair mesmo assim?', { confirmLabel: 'Descartar', danger: true });
    if (ok) S.dirty = false;
    return ok;
  }

  async function ensureTankImages(codes) {
    const missing = codes.filter((c) => !(c in S.tankImgs));
    if (!missing.length) return false;
    await Promise.all(
      missing.map(async (c) => {
        try {
          S.tankImgs[c] = await api('cad:tankImage', { code: c });
        } catch (_) {
          S.tankImgs[c] = null;
        }
      })
    );
    return true;
  }

  // ------------------------------------------------------------------ carregamento de dados
  async function loadLookups() {
    S.lookups = await api('cad:lookups');
  }
  async function loadOsList() {
    S.osList = await api('os:list');
  }
  async function openOs(id, tab) {
    S.os = await api('os:get', { id });
    S.form = formFromOs(S.os);
    S.dirty = false;
    S.formError = null;
    S.osTab = tab || (role() === 'operador' || S.os.status === 'concluida' ? 'final' : 'agend');
    if (S.os.status === 'rascunho') S.osTab = 'agend';
    S.view = 'os';
    await loadLookups();
    render();
    if (typeOf(S.form.agend.type) && typeOf(S.form.agend.type).image && (await ensureTankImages(S.form.agend.tanks))) render();
  }
  async function loadProg() {
    S.prog.data = await api('prog:day', { date: S.prog.date });
  }
  async function loadDash() {
    try {
      S.dash.data = await api('dash:get', { from: S.dash.from, to: S.dash.to });
      S.dash.error = null;
    } catch (e) {
      S.dash.data = null;
      S.dash.error = e.message;
    }
  }

  async function go(view) {
    if (!(await guardDirty())) return;
    S.view = view;
    S.os = null;
    S.form = null;
    S.formError = null;
    try {
      if (view === 'os') await loadOsList();
      if (view === 'prog') {
        if (!S.prog.date) S.prog.date = todayStr();
        await loadProg();
      }
      if (view === 'dash') {
        if (!S.dash.from) {
          const t = todayStr();
          S.dash.from = t.slice(0, 8) + '01';
          const d = new Date(Number(t.slice(0, 4)), Number(t.slice(5, 7)), 0);
          S.dash.to = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        }
        await loadDash();
      }
      if (view === 'cad') await loadCad();
    } catch (e) {
      toast(e.message, true);
    }
    render();
  }

  async function loadCad() {
    await loadLookups();
    if (S.cadTab === 'users') S.users = await api('users:list');
    if (S.cadTab === 'system') S.scale = await api('scale:get', { from: todayStr(), days: 16 });
  }

  // ------------------------------------------------------------------ telas: login / configuração inicial
  function viewLogin() {
    const setup = S.auth.needsSetup;
    const hints = Object.entries(S.meta.roles)
      .map(([k, v]) => `<div class="profile-hint"><span class="badge b-${k}">${esc(v)}</span><span>${esc(PROFILE_HINTS[k])}</span></div>`)
      .join('');
    const form = setup
      ? `<p class="notice info">Primeiro acesso: crie a conta do <b>Gestor</b>. Os demais acessos (Planejador e Operador) são criados depois em Cadastros › Logins.</p>
         <form class="stack" data-form="setup" onsubmit="return false">
           <div class="field"><label class="req" for="s-name">Nome completo</label><input id="s-name" type="text" name="name" autocomplete="name"></div>
           <div class="field"><label class="req" for="s-user">Usuário (login)</label><input id="s-user" type="text" name="username" autocomplete="username"></div>
           <div class="field"><label for="s-email">E-mail (opcional)</label><input id="s-email" type="email" name="email"></div>
           <div class="field"><label class="req" for="s-pass">Senha</label><input id="s-pass" type="password" name="password" autocomplete="new-password"><span class="help">Mínimo de 6 caracteres.</span></div>
           <div class="field"><label class="req" for="s-pass2">Confirmar senha</label><input id="s-pass2" type="password" name="password2" autocomplete="new-password"></div>
           <button class="btn btn-primary btn-block" data-act="setup">Criar conta e entrar</button>
         </form>`
      : `<form class="stack" data-form="login" onsubmit="return false">
           <div class="field"><label for="l-user">Usuário</label><input id="l-user" type="text" name="username" autocomplete="username" autofocus></div>
           <div class="field"><label for="l-pass">Senha</label><input id="l-pass" type="password" name="password" autocomplete="current-password"></div>
           <button class="btn btn-primary btn-block" data-act="login">Entrar</button>
         </form>`;
    return `
      <div class="login-wrap">
        <div class="login-card">
          <div class="login-logo"><img class="logo-img" src="${esc(logo())}" alt="Logo"></div>
          <h1>Gestão Operacional</h1>
          <div class="sub">Ordens de Serviço · Terminal de Granéis Líquidos</div>
          ${form}
          <div class="profile-hints">${hints}</div>
        </div>
      </div>`;
  }

  function viewTopnav() {
    const u = S.auth.user;
    const tabs = [
      ['os', 'Ordens de serviço', true],
      ['prog', 'Programação diária', true],
      ['dash', 'Dashboard', can.dash()],
      ['cad', 'Cadastros', can.cad()],
    ]
      .filter((t) => t[2])
      .map(([id, label]) => `<button class="tab${S.view === id ? ' active' : ''}" data-act="nav" data-view="${id}">${esc(label)}</button>`)
      .join('');
    return `
      <nav class="topnav">
        <img class="logo-img" src="${esc(logo())}" alt="Logo">
        <div class="tabs">${tabs}</div>
        <div class="userbox">
          <span><b>${esc(u.name)}</b> · ${esc(S.meta.roles[u.role])}</span>
          <button class="act" data-act="change-password">senha</button>
          ${u.role === 'gestor' ? '<button class="act" data-act="reset-data">limpar dados</button>' : ''}
          <button class="act" data-act="logout">sair</button>
        </div>
      </nav>`;
  }

  // ------------------------------------------------------------------ telas: O.S.
  function viewOsList() {
    const q = S.osFilter.q.trim().toLowerCase();
    const rows = S.osList.filter(
      (o) =>
        (!S.osFilter.status || o.status === S.osFilter.status) &&
        (!q || [o.number, o.description, o.type_label, o.client, o.product].some((v) => v && String(v).toLowerCase().includes(q)))
    );
    const statusOpts = Object.entries(S.meta.statuses)
      .filter(([k]) => role() !== 'operador' || k !== 'rascunho')
      .map(([k, v]) => `<option value="${k}"${sel(S.osFilter.status === k)}>${esc(v)}</option>`)
      .join('');
    const body = rows.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>Nº O.S.</th><th>Tipo</th><th>Descrição</th><th>Data</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows
            .map(
              (o) => `<tr>
                <td class="num"><a data-act="open-os" data-id="${o.id}">${esc(o.number)}</a></td>
                <td>${esc(o.type_label || '—')}</td>
                <td class="desc" title="${esc(o.description || '')}">${esc(o.description || '—')}</td>
                <td>${esc(fmtDate(o.date) || '—')}${o.time ? ' ' + esc(o.time) : ''}</td>
                <td>${badge(o.status)}</td>
                <td class="actions">
                  <button class="btn btn-sm" data-act="print-os" data-id="${o.id}" title="Gerar PDF">🖨 Imprimir</button>
                  ${can.plan() ? `<button class="btn-danger btn btn-sm" data-act="delete-os" data-id="${o.id}">Excluir</button>` : ''}
                </td></tr>`
            )
            .join('')}</tbody></table></div>`
      : `<div class="empty">${S.osList.length ? 'Nenhuma O.S. encontrada com esse filtro.' : can.plan() ? 'Nenhuma O.S. cadastrada. Clique em “+ Nova O.S.” para começar.' : 'Nenhuma O.S. planejada até o momento.'}</div>`;
    return `
      <div class="page-head">
        <h1>Ordens de serviço</h1>
        <div class="tools">
          <input type="text" placeholder="Buscar nº, descrição, cliente…" data-filter="q" value="${esc(S.osFilter.q)}" style="width:220px">
          <select data-filter="status" style="width:auto"><option value="">Todos os status</option>${statusOpts}</select>
          ${can.plan() ? '<button class="btn btn-primary" data-act="new-os">+ Nova O.S.</button>' : ''}
        </div>
      </div>
      ${body}`;
  }

  function options(list, current, placeholder) {
    const names = list.map((x) => x.name);
    const extra = current && !names.includes(current) ? [current] : [];
    return `<option value="">${esc(placeholder)}</option>` + [...names, ...extra].map((n) => `<option${sel(n === current)}>${esc(n)}</option>`).join('');
  }
  const teamOptions = (current, placeholder) =>
    `<option value="">${esc(placeholder)}</option>` + S.meta.teams.map((t) => `<option value="${t}"${sel(t === current)}>Equipe ${t}</option>`).join('');

  function viewAgendamento(ro) {
    const a = S.form.agend;
    const type = typeOf(a.type);
    const chips = S.meta.types
      .map((t) => `<button class="chip${a.type === t.id ? ' sel' : ''}" data-act="pick-type" data-type="${t.id}"${dis(ro)}>${esc(t.label)}<span class="ic">${esc(S.meta.blocks.find((b) => b.id === t.block).label)}</span></button>`)
      .join('');
    let tanks = '';
    if (type && type.tanks) {
      const codes = S.lookups.tanks.map((t) => t.code);
      const all = [...codes, ...a.tanks.filter((c) => !codes.includes(c))];
      tanks = `<div class="field full"><span class="label">Tanque(s)</span>
        ${all.length ? `<div class="chips tanks">${all.map((c) => `<button class="chip${a.tanks.includes(c) ? ' sel' : ''}" data-act="toggle-tank" data-code="${esc(c)}"${dis(ro)}>${esc(c)}</button>`).join('')}</div>` : '<span class="help">Nenhum tanque cadastrado (Cadastros › Tanques).</span>'}
      </div>`;
      if (type.image && a.tanks.length) {
        const figs = a.tanks
          .map((c) => {
            const img = S.tankImgs[c];
            if (img === undefined) return `<figure><div class="card-empty">Carregando…</div><figcaption>${esc(c)}</figcaption></figure>`;
            if (!img) return `<figure><div class="card-empty">Sem imagem cadastrada para este tanque.</div><figcaption>${esc(c)}</figcaption></figure>`;
            return `<figure><img src="${esc(img.image_data)}" alt="${esc(c)}"><figcaption>${esc(c)}${img.image_name ? ' · ' + esc(img.image_name) : ''}</figcaption></figure>`;
          })
          .join('');
        tanks += `<div class="field full"><span class="label">Imagens vinculadas aos tanques</span><div class="img-preview">${figs}</div><span class="help">Puxadas automaticamente do cadastro do tanque; incluídas na impressão da O.S.</span></div>`;
      }
    }
    const isMar = a.type === 'maritima';
    return `
      ${ro && S.os.status !== 'concluida' ? '<div class="notice info">Seu perfil visualiza o agendamento em modo somente leitura.</div>' : ''}
      <div class="form-grid">
        <div class="field full"><span class="label req">Tipo de operação</span><div class="chips">${chips}</div></div>
        <div class="field full"><label class="req" for="f-desc">Descrição da atividade</label><textarea id="f-desc" data-f="agend.description"${dis(ro)}>${esc(a.description)}</textarea></div>
        ${tanks}
        <div class="field"><label class="req" for="f-date">Data</label><input id="f-date" type="date" data-f="agend.date" value="${esc(a.date)}"${dis(ro)}></div>
        <div class="field"><label class="req" for="f-time">Hora</label><input id="f-time" type="time" data-f="agend.time" value="${esc(a.time)}"${dis(ro)}></div>
        ${isMar ? `<div class="field"><label for="f-client">Cliente</label><select id="f-client" data-f="agend.client"${dis(ro)}>${options(S.lookups.clients, a.client, 'Selecione o cliente')}</select></div>
        <div class="field"><label for="f-vol">Volume / massa</label><input id="f-vol" type="text" data-f="agend.volume" value="${esc(a.volume)}" placeholder="ex.: 5.000 m³ ou 4.200 t"${dis(ro)}></div>` : ''}
        <div class="field"><label for="f-prod">Produto</label><select id="f-prod" data-f="agend.product"${dis(ro)}>${options(S.lookups.products, a.product, 'Selecione o produto')}</select></div>
        <div class="field"><label for="f-team">Equipe prevista (opcional)</label><select id="f-team" data-f="agend.team_planned"${dis(ro)}>${teamOptions(a.team_planned, 'Não definida')}</select></div>
        <div class="field"><label for="f-staff">Efetivo de operadores programados</label><input id="f-staff" type="number" min="0" step="1" data-f="agend.staff_planned" value="${esc(a.staff_planned)}"${dis(ro)}></div>
      </div>`;
  }

  function hoursPreview(start, end) {
    if (!start || !end) return { txt: 'Preencha início e final', err: false };
    const ms = Date.parse(end + ':00Z') - Date.parse(start + ':00Z');
    if (Number.isNaN(ms)) return { txt: 'Datas inválidas', err: true };
    if (ms <= 0) return { txt: 'O final deve ser posterior ao início', err: true };
    const h = Math.round((ms / 3600000) * 100) / 100;
    return { txt: `${fmtNum(h)} h`, err: false };
  }

  function viewFinal(ro) {
    const f = S.form.final;
    const hp = hoursPreview(f.start_at, f.end_at);
    const needOcc = f.realized === 'nao' || f.realized === 'parcial';
    const radios = Object.entries(S.meta.realized)
      .map(([k, v]) => `<button class="chip${f.realized === k ? ' sel' : ''}" data-act="pick-realized" data-value="${k}"${dis(ro)}>${esc(v)}</button>`)
      .join('');
    return `
      <div class="form-grid">
        <div class="field"><label for="f-exec">Executante</label><input id="f-exec" type="text" data-f="final.executor" value="${esc(f.executor)}"${dis(ro)}></div>
        <div class="field"><label for="f-texec">Equipe executante</label><select id="f-texec" data-f="final.team_exec"${dis(ro)}>${teamOptions(f.team_exec, S.form.agend.team_planned ? `Mesma da prevista (Equipe ${S.form.agend.team_planned})` : 'Não definida')}</select></div>
        <div class="field"><label for="f-sp">Efetivo de operadores programados</label><input id="f-sp" type="text" value="${esc(S.os.staff_planned == null ? '—' : S.os.staff_planned)}" readonly></div>
        <div class="field"><label class="req" for="f-sr">Efetivo de operadores real</label><input id="f-sr" type="number" min="1" step="1" data-f="final.staff_real" value="${esc(f.staff_real)}"${dis(ro)}></div>
        <div class="field"><label class="req" for="f-start">Início da atividade</label><input id="f-start" type="datetime-local" data-f="final.start_at" value="${esc(f.start_at)}"${dis(ro)}></div>
        <div class="field"><label class="req" for="f-end">Final da atividade</label><input id="f-end" type="datetime-local" data-f="final.end_at" value="${esc(f.end_at)}"${dis(ro)}></div>
        <div class="field"><span class="label">Horas trabalhadas</span><div class="computed${hp.err ? ' err' : ''}" data-hours>${esc(hp.txt)}</div></div>
        <div class="field"><span class="label req">Atividade foi realizada?</span><div class="radio-group">${radios}</div></div>
        <div class="field full"><label class="check"><input type="checkbox" data-f="final.area_ok"${f.area_ok ? ' checked' : ''}${dis(ro)}> Área ficou organizada e segura?</label></div>
        <div class="field full"><label class="${needOcc ? 'req' : ''}" for="f-occ">Detalhe da ocorrência</label><textarea id="f-occ" data-f="final.occurrence" placeholder="${needOcc ? 'Obrigatório: descreva o que impediu a realização total da atividade' : 'Opcional'}"${dis(ro)}>${esc(f.occurrence)}</textarea></div>
      </div>`;
  }

  function viewOsForm() {
    const os = S.os;
    const st = os.status;
    const roAgend = !can.plan() || st === 'concluida';
    const roFinal = st !== 'planejada';
    const finalLocked = st === 'rascunho';
    let actions = '';
    if (S.osTab === 'agend') {
      if (!roAgend && st === 'rascunho') actions = '<button class="btn" data-act="save-agend">Salvar rascunho</button><button class="btn btn-primary" data-act="plan-os">Planejar O.S.</button>';
      if (!roAgend && st === 'planejada') actions = '<button class="btn btn-primary" data-act="save-agend">Salvar alterações</button>';
    } else if (!roFinal) {
      actions = '<button class="btn" data-act="save-final">Salvar</button><button class="btn btn-success" data-act="conclude-os">Concluir O.S.</button>';
    }
    if (st === 'concluida' && can.plan()) actions = '<button class="btn" data-act="reopen-os">Reabrir O.S.</button>';
    const notices = [];
    if (st === 'rascunho') notices.push('<div class="notice info">Rascunho: preencha o agendamento e clique em <b>Planejar O.S.</b> para liberá-la na Programação Diária e na aba Final.</div>');
    if (st === 'concluida') notices.push(`<div class="notice ok">O.S. concluída${os.updated_by_name ? ' por ' + esc(os.updated_by_name) : ''}. ${can.plan() ? 'Para alterar, reabra a O.S.' : ''}</div>`);
    if (S.formError) notices.push(`<div class="notice warn">${esc(S.formError)}</div>`);
    return `
      <div class="os-head">
        <button class="btn btn-sm" data-act="back">← Voltar</button>
        <h1>O.S. ${esc(os.number)}</h1>
        ${badge(st)}
        <span class="muted small">${os.type_label ? esc(os.type_label) : ''}</span>
        <span style="flex:1"></span>
        <button class="btn btn-sm" data-act="print-os" data-id="${os.id}">🖨 Imprimir</button>
        ${can.plan() ? `<button class="btn btn-danger btn-sm" data-act="delete-os" data-id="${os.id}">Excluir</button>` : ''}
      </div>
      <div class="subtabs">
        <button class="subtab${S.osTab === 'agend' ? ' active' : ''}" data-act="os-tab" data-tab="agend">Agendamento</button>
        <button class="subtab${S.osTab === 'final' ? ' active' : ''}" data-act="os-tab" data-tab="final"${dis(finalLocked)} title="${finalLocked ? 'Liberada após o planejamento da O.S.' : ''}">Final${finalLocked ? ' 🔒' : ''}</button>
      </div>
      ${notices.join('')}
      ${S.osTab === 'agend' ? viewAgendamento(roAgend) : viewFinal(roFinal)}
      ${actions ? `<div class="form-actions">${actions}</div>` : ''}`;
  }

  // ------------------------------------------------------------------ tela: Programação diária
  function viewProg() {
    const d = S.prog.data;
    const blocks = d
      ? d.blocks
          .map(
            (b) => `<div class="card">
          <div class="card-head"><span>${esc(b.label)}</span><span class="count">${b.orders.length}</span></div>
          ${
            b.orders.length
              ? `<div class="prog-row head"><span>Nº O.S.</span><span class="c-client">Cliente</span><span class="c-product">Produto</span><span class="c-desc">Descrição</span><span>Hora</span><span>Status</span></div>` +
                b.orders
                  .map(
                    (o) => `<div class="prog-row">
                <a data-act="open-os" data-id="${o.id}">${esc(o.number)}</a>
                <span class="c-client">${esc(o.client || '—')}</span>
                <span class="c-product">${esc(o.product || '—')}</span>
                <span class="c-desc">${esc(o.description || '—')}${o.tanks.length ? `<br><span class="muted small">Tanques: ${o.tanks.map(esc).join(', ')}</span>` : ''}</span>
                <span>${esc(o.time || '—')}</span>
                <span>${badge(o.status)}</span>
              </div>`
                  )
                  .join('')
              : '<div class="card-empty">Nenhuma O.S. neste bloco.</div>'
          }
        </div>`
          )
          .join('')
      : '';
    return `
      <div class="page-head">
        <h1>Programação diária</h1>
        <div class="tools">
          <button class="btn btn-sm" data-act="prog-shift" data-delta="-1" title="Dia anterior">‹</button>
          <input type="date" data-prog-date value="${esc(S.prog.date)}" style="width:auto">
          <button class="btn btn-sm" data-act="prog-shift" data-delta="1" title="Próximo dia">›</button>
          <button class="btn btn-sm" data-act="prog-today">Hoje</button>
          <button class="btn btn-primary" data-act="prog-print">Exportar / Imprimir</button>
        </div>
      </div>
      ${
        d
          ? `<div class="prog-meta">
              <span class="badge b-team">${d.total} O.S. no dia</span>
              <span class="badge b-planejada">Diurno: Equipe ${esc(d.shifts.D || '—')}</span>
              <span class="badge b-gestor">Noturno: Equipe ${esc(d.shifts.N || '—')}</span>
              <span class="muted small">Folga: ${d.shifts.F.map((t) => 'Equipe ' + esc(t)).join(', ')} · Status somente leitura — altere pelo módulo de O.S.</span>
            </div>`
          : ''
      }
      <div class="stack">${blocks}</div>`;
  }

  // ------------------------------------------------------------------ tela: Dashboard
  /** Barra horizontal simples; `max` = maior valor do conjunto (nunca teto fixo). */
  function bar(value, max, color, label, opts = {}) {
    const p = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    const inside = p >= (opts.minInside || 16);
    const txt = opts.insideText || '#fff';
    return `<div class="bar-track${opts.thin ? ' thin' : ''}"><div class="bar-fill" style="width:${p.toFixed(2)}%;background:${color}${p === 0 ? ';min-width:0' : ''}">
      <span class="bar-val ${inside ? 'in' : 'out'}" style="color:${inside ? txt : opts.outColor || color}">${esc(label)}</span></div></div>`;
  }

  function viewDash() {
    const head = `
      <div class="page-head">
        <h1>Dashboard</h1>
        <div class="tools">
          <label class="label" for="d-from">De</label><input id="d-from" type="date" data-dash="from" value="${esc(S.dash.from)}" style="width:auto">
          <label class="label" for="d-to">Até</label><input id="d-to" type="date" data-dash="to" value="${esc(S.dash.to)}" style="width:auto">
        </div>
      </div>`;
    if (S.dash.error) return head + `<div class="notice warn">${esc(S.dash.error)}</div>`;
    const d = S.dash.data;
    if (!d) return head;
    const m = d.metrics;
    const metrics = `
      <div class="metrics">
        <div class="metric"><div class="lbl">O.S. no período</div><div class="val">${m.total}</div></div>
        <div class="metric purple"><div class="lbl">Taxa de Ocupação Efetiva</div><div class="val">${pct(m.occupancy)}</div></div>
        <div class="metric green"><div class="lbl">Concluídas</div><div class="val">${m.concluded}</div></div>
        <div class="metric orange"><div class="lbl">Pendentes de fechamento</div><div class="val">${m.pending}</div></div>
        <div class="metric orange"><div class="lbl">O.S. não realizadas</div><div class="val">${m.notRealized}</div></div>
      </div>`;

    // Ocupação por equipe
    let occ;
    if (d.concludedCount === 0) {
      occ = '<div class="notice info">Nenhuma O.S. concluída no período — não há horas realizadas para calcular a ocupação.</div>';
    } else if (d.concludedWithHours === 0) {
      occ = `<div class="notice warn">Há ${d.concludedCount} O.S. concluída(s) no período, mas nenhuma tem horas trabalhadas e efetivo real preenchidos. Preencha a aba Final dessas O.S. para calcular a ocupação.</div>`;
    } else {
      const maxRate = Math.max(...d.teams.map((t) => t.rate));
      occ = `<div class="bars">${d.teams
        .map(
          (t) => `<div class="bar-row"><span class="name">Equipe ${esc(t.team)}</span>${bar(t.rate, maxRate, 'var(--purple)', pct(t.rate))}</div>`
        )
        .join('')}</div>
        <div class="legend"><span><i style="background:var(--purple)"></i>Horas reais ÷ capacidade</span></div>`;
    }
    occ += `<div class="chart-note">Capacidade = dias escalados × ${d.capacityRule.operators} operadores × ${d.capacityRule.hours}h efetivas (12h − 2h de descanso). ${d.teams
      .map((t) => `Equipe ${esc(t.team)}: ${fmtNum(t.realHours)}h / ${fmtNum(t.capacity)}h (${t.scheduledDays} dias)`)
      .join(' · ')}${d.withoutTeam ? ` · ${d.withoutTeam} O.S. sem equipe definida não entram no gráfico por equipe.` : ''}</div>`;

    // Planejadas x realizadas
    const series = [
      ['planned', 'Planejadas', 'var(--purple)', '#fff'],
      ['realized', 'Realizadas', 'var(--green)', '#00113f'],
      ['partial', 'Parcialmente realizadas', '#f2b84b', '#00113f'],
      ['notRealized', 'Não realizadas', 'var(--orange)', '#fff'],
    ];
    const maxPR = Math.max(0, ...d.teams.flatMap((t) => series.map((s) => t[s[0]])));
    const pr =
      maxPR === 0
        ? '<div class="notice info">Nenhuma O.S. planejada ou concluída com equipe definida no período.</div>'
        : `<div class="bars">${d.teams
            .map(
              (t) => `<div class="bar-row"><span class="name">Equipe ${esc(t.team)}</span><div class="bar-group">${series
                .map(([k, , c, tx]) => bar(t[k], maxPR, c, String(t[k]), { thin: true, insideText: tx, minInside: 10, outColor: 'var(--navy)' }))
                .join('')}</div></div>`
            )
            .join('')}</div>
          <div class="legend">${series.map(([, l, c]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`).join('')}</div>`;

    // Por tipo
    const maxType = Math.max(0, ...d.byType.map((t) => t.count));
    const bt =
      maxType === 0
        ? '<div class="notice info">Nenhuma O.S. no período selecionado.</div>'
        : `<div class="bars">${d.byType
            .map((t) => `<div class="bar-row"><span class="name" title="${esc(t.label)}">${esc(t.label)}</span>${bar(t.count, maxType, 'var(--purple)', String(t.count), { outColor: 'var(--purple)' })}</div>`)
            .join('')}</div>
          <div class="legend"><span><i style="background:var(--purple)"></i>Quantidade de O.S.</span></div>`;

    return `${head}${metrics}
      <div class="stack">
        <div class="card"><div class="card-head">Taxa de ocupação efetiva por equipe</div><div class="card-body">${occ}</div></div>
        <div class="card"><div class="card-head">O.S. planejadas x realizadas x não realizadas por equipe</div><div class="card-body">${pr}</div></div>
        <div class="card"><div class="card-head">O.S. por tipo de operação</div><div class="card-body">${bt}</div></div>
      </div>`;
  }

  // ------------------------------------------------------------------ tela: Cadastros
  function viewCad() {
    const tabs = [
      ['tanks', 'Tanques'],
      ['clients', 'Clientes'],
      ['products', 'Produtos'],
      ['users', 'Logins'],
      ['system', 'Sistema'],
    ]
      .map(([id, l]) => `<button class="subtab${S.cadTab === id ? ' active' : ''}" data-act="cad-tab" data-tab="${id}">${l}</button>`)
      .join('');
    let body = '';
    if (S.cadTab === 'tanks') body = viewCadTanks();
    else if (S.cadTab === 'clients' || S.cadTab === 'products') body = viewCadRef(S.cadTab);
    else if (S.cadTab === 'users') body = viewCadUsers();
    else body = viewCadSystem();
    return `<div class="page-head"><h1>Cadastros</h1></div><div class="subtabs">${tabs}</div>${body}`;
  }

  function viewCadTanks() {
    const list = S.lookups.tanks;
    return `
      <form class="add-row" onsubmit="return false"><input type="text" placeholder="Código do tanque (ex.: TQ-282001)" data-new="tank"><button class="btn btn-primary" data-act="tank-add">Adicionar tanque</button></form>
      <p class="help" style="margin:-4px 0 10px">A imagem/diagrama anexada a um tanque é puxada automaticamente nas O.S. de Operação Marítima e Transferência Interna que usam esse tanque (prévia e impressão).</p>
      <div class="card"><div class="card-head"><span>Tanques</span><span class="count">${list.length}</span></div>
      ${
        list.length
          ? `<div class="list">${list
              .map(
                (t) => `<div class="list-item">
            ${t.has_image ? `<img class="thumb" data-thumb="${esc(t.code)}" alt="">` : '<span class="thumb empty">sem imagem</span>'}
            <span class="grow"><b>${esc(t.code)}</b><br><span class="muted small">${t.has_image ? esc(t.image_name || 'Imagem anexada') : 'Nenhuma imagem anexada'}</span></span>
            <button class="btn btn-sm" data-act="tank-image" data-id="${t.id}">${t.has_image ? 'Trocar imagem' : 'Anexar imagem'}</button>
            ${t.has_image ? `<button class="btn btn-sm" data-act="tank-view" data-code="${esc(t.code)}">Ver</button><button class="btn btn-danger btn-sm" data-act="tank-image-clear" data-id="${t.id}">Remover imagem</button>` : ''}
            <button class="btn btn-sm" data-act="tank-rename" data-id="${t.id}" data-code="${esc(t.code)}">Renomear</button>
            <button class="btn btn-danger btn-sm" data-act="tank-remove" data-id="${t.id}" data-code="${esc(t.code)}">Excluir</button>
          </div>`
              )
              .join('')}</div>`
          : '<div class="card-empty">Nenhum tanque cadastrado.</div>'
      }</div>`;
  }

  function viewCadRef(kind) {
    const list = S.lookups[kind];
    const label = kind === 'clients' ? 'cliente' : 'produto';
    return `
      <form class="add-row" onsubmit="return false"><input type="text" placeholder="Nome do ${label}" data-new="${kind}"><button class="btn btn-primary" data-act="ref-add" data-kind="${kind}">Adicionar</button></form>
      <div class="card"><div class="card-head"><span>${kind === 'clients' ? 'Clientes' : 'Produtos'}</span><span class="count">${list.length}</span></div>
      ${
        list.length
          ? `<div class="list">${list
              .map(
                (r) => `<div class="list-item"><span class="grow">${esc(r.name)}</span>
              <button class="btn btn-sm" data-act="ref-rename" data-kind="${kind}" data-id="${r.id}" data-name="${esc(r.name)}">Renomear</button>
              <button class="btn btn-danger btn-sm" data-act="ref-remove" data-kind="${kind}" data-id="${r.id}" data-name="${esc(r.name)}">Remover</button></div>`
              )
              .join('')}</div>`
          : `<div class="card-empty">Nenhum ${label} cadastrado.</div>`
      }</div>`;
  }

  function viewCadUsers() {
    return `
      <div class="card" style="margin-bottom:14px"><div class="card-head">Novo login</div><div class="card-body">
        <form class="form-grid" data-form="user" onsubmit="return false">
          <div class="field"><label class="req" for="u-name">Nome</label><input id="u-name" type="text" name="name"></div>
          <div class="field"><label class="req" for="u-user">Usuário (login)</label><input id="u-user" type="text" name="username" autocomplete="off"></div>
          <div class="field"><label for="u-email">E-mail (opcional)</label><input id="u-email" type="email" name="email"></div>
          <div class="field"><label class="req" for="u-role">Perfil</label><select id="u-role" name="role"><option value="planejador">Planejador</option><option value="operador">Operador</option></select></div>
          <div class="field"><label class="req" for="u-pass">Senha</label><input id="u-pass" type="password" name="password" autocomplete="new-password"><span class="help">Mínimo de 6 caracteres. Armazenada com hash, nunca em texto puro.</span></div>
          <div class="field" style="justify-content:flex-end"><button class="btn btn-primary" data-act="user-add">Cadastrar login</button></div>
        </form>
      </div></div>
      <div class="card"><div class="card-head"><span>Logins</span><span class="count">${S.users.length}</span></div>
      <div class="list">${S.users
        .map(
          (u) => `<div class="list-item">
          <span class="grow"><b>${esc(u.name)}</b> <span class="muted small">@${esc(u.username)}</span><br><span class="muted small">${esc(u.email || 'sem e-mail')}</span></span>
          <span class="badge b-${u.role}">${esc(S.meta.roles[u.role])}</span>
          <button class="btn btn-sm" data-act="user-edit" data-id="${u.id}">Editar</button>
          ${u.role !== 'gestor' ? `<button class="btn btn-danger btn-sm" data-act="user-remove" data-id="${u.id}" data-name="${esc(u.name)}">Remover</button>` : ''}
        </div>`
        )
        .join('')}</div></div>`;
  }

  function viewCadSystem() {
    const sc = S.scale;
    const desktop = window.api.platform === 'desktop';
    const scaleRows = sc
      ? sc.preview
          .map((p) => `<tr><td>${esc(fmtDate(p.date))}</td><td><span class="badge b-planejada">${esc(p.D || '—')}</span></td><td><span class="badge b-gestor">${esc(p.N || '—')}</span></td><td class="muted">${p.F.map(esc).join(', ')}</td></tr>`)
          .join('')
      : '';
    const orderSel = sc
      ? sc.scale.order.map((t, i) => `<select data-scale-order="${i}" style="width:auto">${S.meta.teams.map((x) => `<option${sel(x === t)}>${x}</option>`).join('')}</select>`).join(' → ')
      : '';
    return `
      <div class="stack">
        <div class="card"><div class="card-head">Escala de equipes (4 equipes, turnos de 12h)</div><div class="card-body">
          <p class="help" style="margin-top:0">Cada equipe faz 4 dias no diurno, 4 no noturno e depois folga; as equipes são defasadas em 4 dias, garantindo exatamente 1 equipe no diurno e 1 no noturno por dia (2 de folga). Defina a data em que a primeira equipe da ordem inicia o diurno.</p>
          <div class="inline" style="margin-bottom:12px">
            <label class="label" for="sc-anchor">Data âncora</label><input id="sc-anchor" type="date" data-scale-anchor value="${esc(sc ? sc.scale.anchor : '')}">
            <span class="label">Ordem</span> ${orderSel}
            <button class="btn btn-primary btn-sm" data-act="scale-save">Salvar escala</button>
          </div>
          <div class="table-wrap"><table class="scale-table"><thead><tr><th>Data</th><th>Diurno</th><th>Noturno</th><th>Folga</th></tr></thead><tbody>${scaleRows}</tbody></table></div>
        </div></div>

        <div class="grid-2">
          <div class="card"><div class="card-head">Logo da empresa</div><div class="card-body">
            <div style="background:var(--navy);border-radius:10px;padding:14px;display:flex;justify-content:center;margin-bottom:10px"><img class="logo-img" src="${esc(logo())}" alt="Logo"></div>
            <div class="inline"><button class="btn btn-sm" data-act="logo-upload">Enviar logo</button>${S.meta.logo ? '<button class="btn btn-danger btn-sm" data-act="logo-reset">Restaurar padrão</button>' : ''}</div>
            <p class="help">Exibida em branco sobre fundo navy (login, menu e impressões).</p>
          </div></div>
          <div class="card"><div class="card-head">Backup do banco de dados local</div><div class="card-body">
            ${
              desktop
                ? `<p class="help" style="margin-top:0">Todos os dados ficam num único arquivo nesta máquina. Exporte cópias periodicamente para um pendrive ou outra pasta.</p>
                   <div class="inline"><button class="btn btn-primary btn-sm" data-act="backup-export">Exportar backup</button><button class="btn btn-sm" data-act="backup-import">Restaurar backup</button></div>
                   <p class="help" data-dbpath></p>`
                : '<p class="help">Disponível apenas no aplicativo desktop.</p>'
            }
          </div></div>
        </div>

        <div class="card"><div class="card-head">Manutenção</div><div class="card-body inline">
          <span class="grow help">“Limpar dados” apaga todas as O.S. e restaura os cadastros de tanques, clientes e produtos ao estado inicial. Logins, escala e logo são mantidos.</span>
          <button class="btn btn-danger" data-act="reset-data">Limpar dados…</button>
        </div></div>
      </div>`;
  }

  // ------------------------------------------------------------------ render
  function render() {
    if (!S.meta) {
      $app.innerHTML = '';
      return;
    }
    if (!S.auth || !S.auth.user) {
      $app.innerHTML = viewLogin();
      const f = $app.querySelector('input');
      if (f) f.focus();
      return;
    }
    let content = '';
    if (S.view === 'os') content = S.os ? viewOsForm() : viewOsList();
    else if (S.view === 'prog') content = viewProg();
    else if (S.view === 'dash') content = viewDash();
    else if (S.view === 'cad') content = viewCad();
    $app.innerHTML = `${viewTopnav()}<main class="page"><div class="container">${content}</div></main>`;
    afterRender();
  }

  function afterRender() {
    // miniaturas dos tanques (carregadas sob demanda)
    $app.querySelectorAll('[data-thumb]').forEach(async (img) => {
      const code = img.dataset.thumb;
      await ensureTankImages([code]);
      if (S.tankImgs[code]) img.src = S.tankImgs[code].image_data;
    });
    const p = $app.querySelector('[data-dbpath]');
    if (p && window.api.info) window.api.info().then((r) => r.ok && (p.textContent = 'Arquivo do banco: ' + r.data.dbPath));
  }

  // ------------------------------------------------------------------ ações
  const formValues = (name) => {
    const v = {};
    const f = $app.querySelector(`[data-form="${name}"]`);
    if (f) f.querySelectorAll('[name]').forEach((el) => (v[el.name] = el.value));
    return v;
  };

  async function afterAuth(status) {
    S.auth = status;
    S.meta = await api('app:meta');
    S.view = 'os';
    await go('os');
  }

  const actions = {
    async login() {
      const v = formValues('login');
      if (!v.username || !v.password) throw new Error('Informe usuário e senha.');
      await afterAuth(await api('auth:login', v));
    },
    async setup() {
      const v = formValues('setup');
      if (v.password !== v.password2) throw new Error('As senhas não conferem.');
      await afterAuth(await api('auth:setup', v));
      toast('Conta do Gestor criada');
    },
    async logout() {
      if (!(await guardDirty())) return;
      await api('auth:logout');
      S.auth = await api('auth:status');
      S.os = null;
      S.form = null;
      S.tankImgs = {};
      render();
    },
    async 'change-password'() {
      const r = await modal({
        title: 'Alterar minha senha',
        fields: [
          { name: 'current', label: 'Senha atual', type: 'password', required: true },
          { name: 'next', label: 'Nova senha', type: 'password', required: true, help: 'Mínimo de 6 caracteres.' },
          { name: 'next2', label: 'Confirmar nova senha', type: 'password', required: true },
        ],
        confirmLabel: 'Alterar senha',
        validate: async (v) => {
          if (v.next !== v.next2) return 'As senhas não conferem.';
          try {
            await api('auth:changePassword', v);
          } catch (e) {
            return e.message;
          }
          return null;
        },
      });
      if (r) toast('Senha alterada');
    },
    async 'reset-data'() {
      const ok = await confirmBox(
        'Limpar dados?',
        'Todas as <b>Ordens de Serviço</b> serão apagadas permanentemente e os cadastros de tanques (incluindo imagens), clientes e produtos voltarão ao estado inicial. Logins são mantidos. Recomenda-se exportar um backup antes. <br><br>Esta ação não pode ser desfeita.',
        { confirmLabel: 'Apagar dados', danger: true }
      );
      if (!ok) return;
      await api('admin:reset');
      S.tankImgs = {};
      S.dirty = false;
      toast('Dados limpos');
      await go(S.view === 'cad' ? 'cad' : 'os');
    },
    async nav(el) {
      await go(el.dataset.view);
    },

    // O.S.
    async 'new-os'() {
      const os = await api('os:create');
      toast(`Rascunho ${os.number} criado`);
      await openOs(os.id, 'agend');
    },
    async 'open-os'(el) {
      if (!(await guardDirty())) return;
      await openOs(Number(el.dataset.id));
    },
    async back() {
      await go('os');
    },
    async 'os-tab'(el) {
      S.osTab = el.dataset.tab;
      S.formError = null;
      render();
    },
    async 'pick-type'(el) {
      S.form.agend.type = el.dataset.type;
      const t = typeOf(el.dataset.type);
      if (!t.tanks) S.form.agend.tanks = [];
      S.dirty = true;
      render();
      if (t.image && (await ensureTankImages(S.form.agend.tanks))) {
        captureForm();
        render();
      }
    },
    async 'toggle-tank'(el) {
      const c = el.dataset.code;
      const list = S.form.agend.tanks;
      S.form.agend.tanks = list.includes(c) ? list.filter((x) => x !== c) : [...list, c];
      S.dirty = true;
      render();
      const t = typeOf(S.form.agend.type);
      if (t && t.image && (await ensureTankImages(S.form.agend.tanks))) {
        captureForm();
        render();
      }
    },
    async 'pick-realized'(el) {
      S.form.final.realized = S.form.final.realized === el.dataset.value ? '' : el.dataset.value;
      S.dirty = true;
      render();
    },
    async 'save-agend'() {
      await saveAgend(false);
    },
    async 'plan-os'() {
      await saveAgend(true);
    },
    async 'save-final'() {
      await saveFinal(false);
    },
    async 'conclude-os'() {
      const f = S.form.final;
      const missing = [];
      if (!(Number(f.staff_real) > 0)) missing.push('Efetivo de operadores real');
      if (!f.start_at) missing.push('Início da atividade');
      if (!f.end_at) missing.push('Final da atividade');
      if (!f.realized) missing.push('Atividade foi realizada?');
      if ((f.realized === 'nao' || f.realized === 'parcial') && !String(f.occurrence || '').trim()) missing.push('Detalhe da ocorrência');
      if (missing.length) {
        S.formError = 'Para concluir a O.S., preencha: ' + missing.join('; ') + '.';
        render();
        return;
      }
      if (hoursPreview(f.start_at, f.end_at).err) {
        S.formError = 'O final da atividade deve ser posterior ao início. Corrija antes de concluir.';
        render();
        return;
      }
      const ok = await confirmBox('Concluir O.S.?', `A O.S. <b>${esc(S.os.number)}</b> será marcada como <b>Concluída</b>.`, { confirmLabel: 'Concluir' });
      if (ok) await saveFinal(true);
    },
    async 'reopen-os'() {
      const ok = await confirmBox('Reabrir O.S.?', `A O.S. <b>${esc(S.os.number)}</b> voltará para o status <b>Planejada</b>, permitindo alterações.`, { confirmLabel: 'Reabrir' });
      if (!ok) return;
      S.os = await api('os:reopen', { id: S.os.id });
      S.form = formFromOs(S.os);
      S.dirty = false;
      toast('O.S. reaberta');
      render();
    },
    async 'delete-os'(el) {
      const id = Number(el.dataset.id);
      const o = (S.os && S.os.id === id ? S.os : S.osList.find((x) => x.id === id)) || {};
      const ok = await confirmBox('Excluir O.S.?', `A O.S. <b>${esc(o.number || '')}</b> será excluída <b>permanentemente</b>. Esta ação não pode ser desfeita.`, { confirmLabel: 'Excluir', danger: true });
      if (!ok) return;
      await api('os:delete', { id });
      toast('O.S. excluída');
      S.dirty = false;
      await go('os');
    },
    async 'print-os'(el) {
      const id = Number(el.dataset.id);
      if (S.os && S.os.id === id && S.dirty) toast('Atenção: alterações não salvas não entram na impressão', true);
      const os = await api('os:get', { id });
      await printDocument(window.PrintTemplates.osDocument(os, S.meta, logo()), `OS-${os.number}`);
    },

    // Programação
    async 'prog-shift'(el) {
      const d = new Date(S.prog.date + 'T12:00:00');
      d.setDate(d.getDate() + Number(el.dataset.delta));
      S.prog.date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      await loadProg();
      render();
    },
    async 'prog-today'() {
      S.prog.date = todayStr();
      await loadProg();
      render();
    },
    async 'prog-print'() {
      await loadProg();
      await printDocument(window.PrintTemplates.programacaoDocument(S.prog.data, S.meta, logo()), `Programacao-${S.prog.date}`);
    },

    // Cadastros
    async 'cad-tab'(el) {
      S.cadTab = el.dataset.tab;
      await loadCad();
      render();
    },
    async 'tank-add'() {
      const input = $app.querySelector('[data-new=tank]');
      await api('cad:tankAdd', { code: input.value });
      toast('Tanque cadastrado');
      await loadCad();
      render();
    },
    async 'tank-rename'(el) {
      const r = await modal({ title: 'Renomear tanque', message: 'As O.S. que usam este tanque serão atualizadas para o novo código.', fields: [{ name: 'code', label: 'Código', value: el.dataset.code, required: true }], confirmLabel: 'Salvar' });
      if (!r) return;
      const res = await api('cad:tankRename', { id: Number(el.dataset.id), code: r.values.code });
      delete S.tankImgs[el.dataset.code];
      toast(`Tanque renomeado${res.migrated ? ` · ${res.migrated} O.S. atualizada(s)` : ''}`);
      await loadCad();
      render();
    },
    async 'tank-remove'(el) {
      const ok = await confirmBox('Excluir tanque?', `O tanque <b>${esc(el.dataset.code)}</b> e sua imagem serão removidos do cadastro. O.S. existentes mantêm o código registrado.`, { confirmLabel: 'Excluir', danger: true });
      if (!ok) return;
      await api('cad:tankRemove', { id: Number(el.dataset.id) });
      delete S.tankImgs[el.dataset.code];
      toast('Tanque excluído');
      await loadCad();
      render();
    },
    async 'tank-image'(el) {
      const file = await pickFile('image/*');
      if (!file) return;
      const dataUrl = await readFileAsDataUrl(file);
      await api('cad:tankSetImage', { id: Number(el.dataset.id), dataUrl, name: file.name });
      S.tankImgs = {};
      toast('Imagem salva no cadastro do tanque');
      await loadCad();
      render();
    },
    async 'tank-image-clear'(el) {
      const ok = await confirmBox('Remover imagem?', 'A imagem deixará de ser anexada às O.S. que usam este tanque.', { confirmLabel: 'Remover', danger: true });
      if (!ok) return;
      await api('cad:tankSetImage', { id: Number(el.dataset.id), dataUrl: null });
      S.tankImgs = {};
      toast('Imagem removida');
      await loadCad();
      render();
    },
    async 'tank-view'(el) {
      await ensureTankImages([el.dataset.code]);
      const img = S.tankImgs[el.dataset.code];
      if (!img) return;
      $modal.innerHTML = `<div class="overlay" data-close><div class="modal" style="max-width:900px"><h2>${esc(img.code)}</h2><p class="muted small">${esc(img.image_name || '')}</p>
        <img src="${esc(img.image_data)}" style="max-width:100%;max-height:70vh;display:block;margin:0 auto" alt=""><div class="form-actions"><button class="btn" data-close>Fechar</button></div></div></div>`;
      $modal.querySelectorAll('[data-close]').forEach((x) => (x.onclick = (e) => e.target === x && ($modal.innerHTML = '')));
    },
    async 'ref-add'(el) {
      const kind = el.dataset.kind;
      const input = $app.querySelector(`[data-new=${kind}]`);
      await api('cad:refAdd', { kind, name: input.value });
      toast(kind === 'clients' ? 'Cliente cadastrado' : 'Produto cadastrado');
      await loadCad();
      render();
    },
    async 'ref-rename'(el) {
      const r = await modal({ title: 'Renomear', message: 'As O.S. existentes serão atualizadas para o novo nome.', fields: [{ name: 'name', label: 'Nome', value: el.dataset.name, required: true }], confirmLabel: 'Salvar' });
      if (!r) return;
      const res = await api('cad:refRename', { kind: el.dataset.kind, id: Number(el.dataset.id), name: r.values.name });
      toast(`Renomeado${res.migrated ? ` · ${res.migrated} O.S. atualizada(s)` : ''}`);
      await loadCad();
      render();
    },
    async 'ref-remove'(el) {
      const ok = await confirmBox('Remover?', `<b>${esc(el.dataset.name)}</b> será removido da lista. O.S. existentes mantêm o nome registrado.`, { confirmLabel: 'Remover', danger: true });
      if (!ok) return;
      await api('cad:refRemove', { kind: el.dataset.kind, id: Number(el.dataset.id) });
      toast('Removido');
      await loadCad();
      render();
    },
    async 'user-add'() {
      await api('users:add', formValues('user'));
      toast('Login cadastrado');
      await loadCad();
      render();
    },
    async 'user-edit'(el) {
      const u = S.users.find((x) => x.id === Number(el.dataset.id));
      const fields = [
        { name: 'name', label: 'Nome', value: u.name, required: true },
        { name: 'email', label: 'E-mail (opcional)', type: 'email', value: u.email || '' },
      ];
      if (u.role !== 'gestor') fields.push({ name: 'role', label: 'Perfil', type: 'select', value: u.role, options: [{ value: 'planejador', label: 'Planejador' }, { value: 'operador', label: 'Operador' }] });
      fields.push({ name: 'password', label: 'Nova senha', type: 'password', help: 'Deixe em branco para manter a senha atual.' });
      const r = await modal({
        title: `Editar login · @${u.username}`,
        fields,
        confirmLabel: 'Salvar',
        validate: async (v) => {
          try {
            await api('users:update', { id: u.id, ...v, role: v.role || u.role });
          } catch (e) {
            return e.message;
          }
          return null;
        },
      });
      if (!r) return;
      toast('Login atualizado');
      S.auth = await api('auth:status');
      await loadCad();
      render();
    },
    async 'user-remove'(el) {
      const ok = await confirmBox('Remover login?', `O acesso de <b>${esc(el.dataset.name)}</b> será removido.`, { confirmLabel: 'Remover', danger: true });
      if (!ok) return;
      await api('users:remove', { id: Number(el.dataset.id) });
      toast('Login removido');
      await loadCad();
      render();
    },
    async 'scale-save'() {
      const anchor = $app.querySelector('[data-scale-anchor]').value;
      const order = [...$app.querySelectorAll('[data-scale-order]')].map((s) => s.value);
      await api('scale:set', { anchor, order });
      toast('Escala salva');
      await loadCad();
      render();
    },
    async 'logo-upload'() {
      const file = await pickFile('image/png,image/jpeg,image/svg+xml,image/webp,image/gif');
      if (!file) return;
      await api('settings:logo', { dataUrl: await readFileAsDataUrl(file) });
      S.meta = await api('app:meta');
      toast('Logo atualizada');
      render();
    },
    async 'logo-reset'() {
      await api('settings:logo', { dataUrl: null });
      S.meta = await api('app:meta');
      toast('Logo padrão restaurada');
      render();
    },
    async 'backup-export'() {
      const r = await window.api.exportBackup();
      if (!r.ok) throw new Error(r.error);
      if (r.data.saved) toast('Backup exportado');
    },
    async 'backup-import'() {
      const ok = await confirmBox('Restaurar backup?', 'Todos os dados atuais serão <b>substituídos</b> pelos do arquivo escolhido (uma cópia do banco atual é guardada ao lado do arquivo do banco). Depois disso será necessário entrar novamente.', { confirmLabel: 'Escolher arquivo…', danger: true });
      if (!ok) return;
      const r = await window.api.importBackup();
      if (!r.ok) throw new Error(r.error);
      if (!r.data.restored) return;
      toast('Backup restaurado. Entre novamente.');
      S.auth = await api('auth:status');
      S.meta = await api('app:meta');
      S.tankImgs = {};
      render();
    },
  };

  async function saveAgend(plan) {
    S.formError = null;
    try {
      const os = await api('os:saveAgendamento', { id: S.os.id, data: S.form.agend, plan });
      const wasDraft = S.os.status === 'rascunho';
      S.os = os;
      S.form.agend = formFromOs(os).agend;
      S.dirty = false;
      toast(plan && wasDraft ? 'O.S. planejada' : 'O.S. salva');
    } catch (e) {
      S.formError = e.message;
    }
    render();
  }

  async function saveFinal(conclude) {
    S.formError = null;
    try {
      const os = await api('os:saveFinal', { id: S.os.id, data: S.form.final, conclude });
      S.os = os;
      S.form = formFromOs(os);
      S.dirty = false;
      toast(conclude ? 'O.S. concluída' : 'O.S. salva');
    } catch (e) {
      S.formError = e.message;
    }
    render();
  }

  // ------------------------------------------------------------------ eventos (delegação)
  $app.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    e.preventDefault();
    const fn = actions[el.dataset.act];
    if (!fn || S.busy) return;
    captureForm(); // preserva o que já foi digitado antes de qualquer re-renderização
    S.busy = true;
    try {
      await fn(el);
    } catch (err) {
      toast(err.message || String(err), true);
    } finally {
      S.busy = false;
    }
  });

  $app.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.f && S.form) {
      const [g, k] = el.dataset.f.split('.');
      S.form[g][k] = el.type === 'checkbox' ? el.checked : el.value;
      S.dirty = true;
      if (k === 'start_at' || k === 'end_at') {
        const box = $app.querySelector('[data-hours]');
        const hp = hoursPreview(S.form.final.start_at, S.form.final.end_at);
        if (box) {
          box.textContent = hp.txt;
          box.classList.toggle('err', hp.err);
        }
      }
    }
    if (el.dataset.filter === 'q') {
      S.osFilter.q = el.value;
      const pos = el.selectionStart;
      render();
      const n = $app.querySelector('[data-filter=q]');
      n.focus();
      n.setSelectionRange(pos, pos);
    }
  });

  $app.addEventListener('change', async (e) => {
    const el = e.target;
    try {
      if (el.dataset.f && S.form && el.type === 'checkbox') {
        S.form[el.dataset.f.split('.')[0]][el.dataset.f.split('.')[1]] = el.checked;
        S.dirty = true;
      }
      if (el.dataset.filter === 'status') {
        S.osFilter.status = el.value;
        render();
      }
      if (el.hasAttribute('data-prog-date') && el.value) {
        S.prog.date = el.value;
        await loadProg();
        render();
      }
      if (el.dataset.dash && el.value) {
        S.dash[el.dataset.dash] = el.value;
        await loadDash();
        render();
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  $app.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    const form = e.target.closest('[data-form], .add-row');
    if (!form) return;
    const btn = form.querySelector('[data-act]');
    if (btn) {
      e.preventDefault();
      btn.click();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (S.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ------------------------------------------------------------------ início
  (async function init() {
    try {
      S.meta = await api('app:meta');
      S.auth = await api('auth:status');
      if (S.auth.user) await go('os');
      else render();
    } catch (e) {
      $app.innerHTML = `<div class="login-wrap"><div class="login-card"><h1>Erro ao iniciar</h1><p class="notice warn">${esc(e.message)}</p></div></div>`;
    }
  })();
})();
