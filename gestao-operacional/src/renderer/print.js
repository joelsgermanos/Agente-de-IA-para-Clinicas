/* Modelos de impressão (PDF) — mesmo padrão visual do sistema. Gerados localmente, sem serviço externo. */
(function () {
  'use strict';

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
  const fmtDT = (s) => (s ? `${fmtDate(s)} ${s.slice(11, 16)}` : '');
  const fmtNum = (n) => (n == null ? '' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
  const dash = (v) => (v == null || v === '' ? '—' : esc(v));

  const CSS = `
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-rounded, "SF Pro Rounded", "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 11px; color: #1f2340; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .head { background: #001869; color: #fff; border-radius: 10px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .head img { filter: brightness(0) invert(1); max-height: 34px; max-width: 200px; }
    .head .right { text-align: right; font-size: 10px; color: #c3bef9; }
    .head .right b { color: #fff; font-size: 11px; }
    .title { display: flex; align-items: center; gap: 12px; margin: 16px 0 4px; }
    h1 { color: #001869; font-size: 20px; margin: 0; }
    .subtitle { color: #574aee; font-weight: 700; font-size: 13px; margin: 0 0 14px; }
    .badge { display: inline-block; border-radius: 999px; padding: 3px 11px; font-size: 10px; font-weight: 700; }
    .b-rascunho { background: #e5e7eb; color: #4b5563; }
    .b-planejada { background: #c3bef9; color: #574aee; }
    .b-concluida { background: #51d698; color: #00113f; }
    .b-warn { background: #fdeee6; color: #e6702f; }
    .section { border: 1px solid #e3e4ee; border-radius: 10px; overflow: hidden; margin-bottom: 12px; page-break-inside: avoid; break-inside: avoid; }
    .section > h2 { background: #f8f8fc; color: #001869; font-size: 12px; margin: 0; padding: 8px 12px; border-bottom: 1px solid #e3e4ee; display: flex; justify-content: space-between; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 14px; padding: 12px; }
    .grid .full { grid-column: 1 / -1; }
    .f .l { font-size: 9px; font-weight: 700; color: #4b5563; text-transform: uppercase; letter-spacing: .3px; }
    .f .v { font-size: 11.5px; color: #001869; font-weight: 600; margin-top: 2px; white-space: pre-wrap; word-break: break-word; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 9px; color: #4b5563; text-transform: uppercase; padding: 6px 10px; border-bottom: 1px solid #e3e4ee; }
    td { padding: 6px 10px; border-bottom: 1px solid #f0f0f6; vertical-align: top; }
    tr:last-child td { border-bottom: 0; }
    td.n { font-weight: 700; color: #001869; white-space: nowrap; }
    .empty { padding: 10px 12px; color: #4b5563; font-style: italic; }
    .count { background: #001869; color: #fff; border-radius: 999px; padding: 1px 9px; font-size: 10px; }
    .img-page { page-break-before: always; break-before: page; }
    .img-page h2 { color: #001869; font-size: 14px; margin: 0 0 4px; }
    .img-page p { color: #574aee; font-weight: 700; margin: 0 0 10px; }
    .img-page .frame { border: 1px solid #e3e4ee; border-radius: 10px; padding: 8px; text-align: center; }
    .img-page img { max-width: 100%; max-height: 235mm; width: auto; height: auto; object-fit: contain; }
    .foot { margin-top: 14px; font-size: 9px; color: #4b5563; text-align: right; }
    .sig { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 34px; }
    .sig div { border-top: 1px solid #4b5563; text-align: center; padding-top: 4px; font-size: 10px; color: #4b5563; }
  `;

  function doc(title, body) {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
  }
  const field = (label, value, full) => `<div class="f${full ? ' full' : ''}"><div class="l">${esc(label)}</div><div class="v">${value}</div></div>`;
  const now = () => new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  function osDocument(os, meta, logo) {
    const type = meta.types.find((t) => t.id === os.type);
    const st = meta.statuses[os.status];
    const tanksTxt = os.tanks && os.tanks.length ? os.tanks.map(esc).join(', ') : '—';
    const isMar = os.type === 'maritima';
    const realized = os.realized ? meta.realized[os.realized] : null;

    let body = `
      <div class="head"><img src="${esc(logo)}" alt=""><div class="right"><b>Ordem de Serviço</b><br>Emitido em ${esc(now())}</div></div>
      <div class="title"><h1>O.S. ${esc(os.number)}</h1><span class="badge b-${esc(os.status)}">${esc(st)}</span></div>
      <p class="subtitle">${esc(type ? type.label : 'Tipo de operação não definido')}</p>

      <div class="section"><h2>Agendamento</h2><div class="grid">
        ${field('Tipo de operação', dash(type && type.label))}
        ${field('Data', dash(fmtDate(os.date)))}
        ${field('Hora', dash(os.time))}
        ${field('Descrição da atividade', dash(os.description), true)}
        ${type && type.tanks ? field('Tanque(s)', tanksTxt) : ''}
        ${isMar ? field('Cliente', dash(os.client)) : ''}
        ${isMar ? field('Volume / massa', dash(os.volume)) : ''}
        ${field('Produto', dash(os.product))}
        ${field('Equipe prevista', dash(os.team_planned && 'Equipe ' + os.team_planned))}
        ${field('Efetivo de operadores programados', dash(os.staff_planned))}
      </div></div>

      <div class="section"><h2>Execução</h2><div class="grid">
        ${field('Executante', dash(os.executor))}
        ${field('Equipe executante', dash(os.team_exec && 'Equipe ' + os.team_exec))}
        ${field('Efetivo real', dash(os.staff_real))}
        ${field('Início da atividade', dash(fmtDT(os.start_at)))}
        ${field('Final da atividade', dash(fmtDT(os.end_at)))}
        ${field('Horas trabalhadas', os.hours_worked != null ? esc(fmtNum(os.hours_worked) + ' h') : '—')}
      </div></div>

      <div class="section"><h2>Encerramento</h2><div class="grid">
        ${field('Atividade foi realizada?', realized ? `<span class="badge ${os.realized === 'sim' ? 'b-concluida' : 'b-warn'}">${esc(realized)}</span>` : '—')}
        ${field('Área ficou organizada e segura?', os.status === 'concluida' || os.area_ok ? (os.area_ok ? 'Sim' : 'Não') : '—')}
        ${field('Status', `<span class="badge b-${esc(os.status)}">${esc(st)}</span>`)}
        ${field('Detalhe da ocorrência', dash(os.occurrence), true)}
      </div></div>

      <div class="sig"><div>Responsável pela programação</div><div>Executante</div></div>
      <div class="foot">Gestão Operacional · O.S. ${esc(os.number)}${os.created_by_name ? ' · criada por ' + esc(os.created_by_name) : ''}</div>`;

    for (const img of os.tank_images || []) {
      body += `
        <section class="img-page">
          <h2>O.S. ${esc(os.number)} — Anexo do tanque ${esc(img.code)}</h2>
          <p>${esc(img.image_name || 'Imagem / diagrama técnico')}</p>
          <div class="frame"><img src="${esc(img.image_data)}" alt="Tanque ${esc(img.code)}"></div>
        </section>`;
    }
    return doc(`O.S. ${os.number}`, body);
  }

  function programacaoDocument(data, meta, logo) {
    const blocks = data.blocks
      .map((b) => {
        const rows = b.orders.length
          ? `<table><thead><tr><th>Nº O.S.</th><th>Cliente</th><th>Produto</th><th>Descrição</th><th>Hora</th><th>Status</th></tr></thead><tbody>${b.orders
              .map(
                (o) => `<tr><td class="n">${esc(o.number)}</td><td>${dash(o.client)}</td><td>${dash(o.product)}</td>
                <td>${dash(o.description)}${o.tanks && o.tanks.length ? `<br><span style="color:#4b5563">Tanques: ${o.tanks.map(esc).join(', ')}</span>` : ''}</td>
                <td>${dash(o.time)}</td><td><span class="badge b-${esc(o.status)}">${esc(meta.statuses[o.status])}</span></td></tr>`
              )
              .join('')}</tbody></table>`
          : '<div class="empty">Nenhuma O.S. programada neste bloco.</div>';
        return `<div class="section"><h2><span>${esc(b.label)}</span><span class="count">${b.orders.length}</span></h2>${rows}</div>`;
      })
      .join('');
    const shifts = data.shifts ? `Diurno: Equipe ${esc(data.shifts.D || '—')} · Noturno: Equipe ${esc(data.shifts.N || '—')}` : '';
    const body = `
      <div class="head"><img src="${esc(logo)}" alt=""><div class="right">Elaborado por<br><b>${esc(data.elaboratedBy)}</b><br>${esc(now())}</div></div>
      <div class="title"><h1>Programação Diária</h1></div>
      <p class="subtitle">${esc(fmtDate(data.date))} · ${data.total} O.S. programada(s)${shifts ? ' · ' + shifts : ''}</p>
      ${blocks}
      <div class="foot">Gestão Operacional · Programação de ${esc(fmtDate(data.date))}</div>`;
    return doc(`Programação ${fmtDate(data.date)}`, body);
  }

  window.PrintTemplates = { osDocument, programacaoDocument, fmtDate, fmtDT, fmtNum, esc };
})();
