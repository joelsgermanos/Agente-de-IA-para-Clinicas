/* Ponte da interface com o servidor quando aberta no navegador (no app desktop, o preload já define window.api). */
if (!window.api) {
  window.api = {
    platform: 'web',
    call: async (channel, payload) => {
      try {
        const r = await fetch('/api/' + encodeURIComponent(channel), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {}),
        });
        const data = await r.json().catch(() => null);
        if (data) return data;
        return { ok: false, error: 'Resposta inválida do servidor (' + r.status + ').' };
      } catch (_) {
        return { ok: false, error: 'Sem conexão com o servidor. Verifique a internet e tente novamente.' };
      }
    },
  };
}
