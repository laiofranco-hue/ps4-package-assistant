(() => {
  const $ = id => document.getElementById(id);
  const labels = { pending: 'Aguardando', running: 'Em andamento', success: 'Concluída', error: 'Falhou', cancelled: 'Cancelada', interrupted: 'Interrompida', attention: 'Conferir no PS4', retried: 'Nova tentativa criada' };
  let last = '', limit = 20, timer, latest, lastResult = '';
  const message = $('queue-message');
  function displayTitle(job) {
    const title = String(job.title || '').replace(/\.(pkg|iso)$/i, '').replace(/^IV\d{4}-/, '');
    return title.length > 54 ? title.slice(0, 51) + '…' : title;
  }
  function failure(e) { $('queue-error').textContent = e.message; $('queue-error').hidden = false; }
  function node(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
  async function request(action, body = {}) {
    $('queue-error').hidden = true;
    const response = await fetch('/api/queue/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Falha ao atualizar a fila.');
    last = ''; render(data); return data;
  }
  function action(label, run) {
    const b = node('button', label, 'secondary');
    b.onclick = async () => { b.disabled = true; try { await run(); } catch (e) { failure(e); } finally { if (b.isConnected) b.disabled = false; } };
    return b;
  }
  function row(job) {
    const li = node('li', null, 'library-item'); const info = node('div', null, 'library-info');
    info.append(node('strong', displayTitle(job)));
    info.append(node('p', `${job.kind === 'convert' ? 'Conversão PS2' : 'Envio ao PS4'} · ${labels[job.status] || job.status}`, 'hint'));
    info.append(node('p', job.file, 'library-path'));
    if (job.kind === 'convert') info.append(node('p', `${job.options.emulator} · ${job.options.resolution} · ${job.options.cover ? 'Capa personalizada' : 'Capa padrão'}`, 'hint'));
    else info.append(node('p', `PS4: ${job.options.ps4Ip}${job.taskId != null ? ' · Tarefa ' + job.taskId : ''}`, 'hint'));
    if (job.createdAt) info.append(node('p', new Date(job.createdAt).toLocaleString('pt-BR'), 'library-path'));
    if (job.progress && Number.isFinite(job.progress.total) && job.progress.total > 0) {
      const p = node('progress'); p.max = job.progress.total; p.value = Math.max(0, Math.min(job.progress.transferred || 0, job.progress.total)); p.setAttribute('aria-label', 'Bytes recebidos pelo PS4'); p.style.width = '100%';
      info.append(p, node('p', `${(p.value / p.max * 100).toFixed(1)}% · ${(p.value / 1073741824).toFixed(2)} / ${(p.max / 1073741824).toFixed(2)} GB recebidos`, 'hint'));
    } else if (job.status === 'running') info.append(node('p', job.kind === 'convert' ? 'Convertendo… Acompanhe o registro.' : 'Aguardando o PS4 informar o progresso…', 'hint'));
    if (job.status === 'success' && job.kind === 'send') info.append(node('p', 'Transferência concluída pelo PS4. Confira a instalação e a abertura do jogo no console.', 'hint'));
    if (job.error) info.append(node('p', job.error, 'hint library-error'));
    if (job.output) info.append(node('p', 'Resultado: ' + job.output, 'library-path'));
    if (job.log?.length) { const d = node('details'); d.append(node('summary', 'Registro da conversão'), node('pre', job.log.join('\n'))); info.append(d); }
    const buttons = node('div', null, 'library-item-actions');
    if (job.status === 'pending') buttons.append(action('Retirar da fila', () => request('cancel', { id: job.id })));
    if (job.status === 'running') buttons.append(action(job.kind === 'convert' ? 'Cancelar conversão' : 'Parar acompanhamento', async () => {
      if (job.kind === 'send' && !confirm('Parar apenas o acompanhamento? O download pode continuar no PS4. Mantenha o app aberto e confira Downloads.')) return;
      await request('cancel', { id: job.id });
    }));
    if (['error', 'cancelled', 'interrupted', 'attention'].includes(job.status)) buttons.append(action('Criar nova tentativa', async () => {
      if (job.status === 'attention' && !confirm('Confira Downloads no PS4. Se a tarefa ainda estiver ativa, consulte o progresso. Criar outra tentativa pode duplicar o envio. Deseja repetir mesmo assim?')) return;
      await request('retry', { id: job.id, confirm: job.status === 'attention' });
    }));
    if (job.status === 'attention' && job.taskId != null) buttons.append(action('Consultar progresso', () => request('recheck', { id: job.id })));
    if (job.kind === 'convert' && job.status === 'success') buttons.append(action('Usar PKG no envio', async () => { await request('use-output', { id: job.id }); await state(); $('send').scrollIntoView({ block: 'center', behavior: 'smooth' }); }));
    li.append(info, buttons); return li;
  }
  function updateList(list, jobs) {
    const ids = new Set(jobs.map(j => j.id));
    for (const child of [...list.children]) if (!ids.has(child.dataset.id)) child.remove();
    jobs.forEach((job, index) => {
      const old = [...list.children].find(child => child.dataset.id === job.id);
      const signature = JSON.stringify(job);
      let item = old;
      if (!old || old.dataset.signature !== signature) {
        item = row(job); item.dataset.id = job.id; item.dataset.signature = signature;
        if (old) {
          const focusedIndex = [...old.querySelectorAll('button,summary')].indexOf(document.activeElement);
          old.querySelectorAll('details').forEach((d, i) => { if (item.querySelectorAll('details')[i]) item.querySelectorAll('details')[i].open = d.open; });
          old.replaceWith(item);
          if (focusedIndex >= 0) item.querySelectorAll('button,summary')[focusedIndex]?.focus({ preventScroll: true });
        }
      }
      if (list.children[index] !== item) list.insertBefore(item, list.children[index] || null);
    });
  }
  function render(data) {
    latest = data;
    const completed = [...data.jobs].reverse().find(j => j.kind === 'convert' && j.status === 'success');
    if (completed && completed.id !== lastResult) { lastResult = completed.id; state(); conversionStateRefresh(); }
    $('queue-start').disabled = data.readOnly || !!data.active || !data.jobs.some(j => j.status === 'pending') || data.jobs.some(j => j.status === 'attention');
    $('queue-pause').disabled = !data.enabled;
    $('queue-send').disabled = data.readOnly;
    $('queue-convert').disabled = data.readOnly || !!data.active;
    const signature = JSON.stringify(data) + limit;
    if (signature === last) return;
    last = signature;
    message.classList.toggle('library-error', !!data.error);
    const pending = data.jobs.filter(j => ['pending', 'running', 'attention'].includes(j.status));
    const history = data.jobs.filter(j => !['pending', 'running', 'attention'].includes(j.status)).reverse();
    message.textContent = data.error || (data.active ? (data.enabled ? 'Executando fila.' : 'A tarefa atual continua; as próximas estão pausadas.') : pending.some(j => j.status === 'attention') ? 'Confira o envio sinalizado no PS4 antes de continuar.' : pending.length ? `${pending.length} tarefa(s) aguardando. Clique em Iniciar fila quando estiver pronto.` : 'Fila vazia. Adicione uma conversão ou um envio pelos controles acima.');
    updateList($('queue-pending'), pending);
    $('queue-history-count').textContent = `Histórico (${history.length})`;
    updateList($('queue-history'), history.slice(0, limit));
    $('queue-more').hidden = history.length <= limit;
  }
  async function refresh() {
    clearTimeout(timer);
    try { const response = await fetch('/api/queue'); if (!response.ok) throw new Error('Reabra o app para consultar a fila.'); render(await response.json()); }
    catch (e) { failure(e); }
    timer = setTimeout(refresh, latest?.active ? 1000 : 3000);
  }
  function bind(id, run) { $(id).onclick = async () => { $(id).disabled = true; try { await run(); } catch (e) { failure(e); } finally { $(id).disabled = false; if (latest) render(latest); refreshSoon(); } }; }
  function refreshSoon() { clearTimeout(timer); timer = setTimeout(refresh, 1500); }
  bind('queue-convert', () => request('add', { kind: 'convert', title: $('convert-title').value.trim(), emulator: $('emulator').value, resolution: $('resolution').value }));
  bind('queue-send', () => request('add', { kind: 'send', ps4Ip: $('ps4').value.trim(), macIp: $('mac').value.trim() }));
  bind('queue-start', () => request('start'));
  bind('queue-pause', () => request('pause'));
  $('queue-more').onclick = () => { limit += 20; last = ''; render(latest); };
  refresh();
})();
