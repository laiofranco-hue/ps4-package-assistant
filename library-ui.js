(() => {
  const $ = selector => document.querySelector(selector);
  let catalog = { sources: [], items: [], syncing: false };
  let poll, shown = 100;
  const buttons = ['#library-files','#library-folders','#library-outputs','#library-sync'];
  const availability = { available: 'Disponível', missing: 'Arquivo ausente', unavailable: 'Origem indisponível' };
  function say(text, error = false) { $('#library-message').textContent = text; $('#library-message').classList.toggle('library-error', error); }
  async function request(route, body = {}) {
    const response = await fetch('/api/library' + route, { method: 'POST', headers: {'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível atualizar a biblioteca.');
    return data;
  }
  async function refresh() {
    clearTimeout(poll);
    try {
      const response = await fetch('/api/library');
      if (!response.ok) throw new Error('Não foi possível carregar o catálogo.');
      render(await response.json());
    } catch (error) { say(error.message + ' Tentando reconectar…', true); poll=setTimeout(refresh,2500); }
  }
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function action(text, handler, disabled = false) {
    const button = node('button', text, 'secondary'); button.type='button'; button.disabled=disabled; button.onclick=handler; return button;
  }
  function render(data) {
    catalog = data;
    for (const selector of buttons) $(selector).disabled = data.syncing || data.readOnly;
    $('#library-sync').disabled ||= !data.sources.length;
    $('#library-cancel').hidden = !data.syncing;
    const selectedPlatform = $('#library-platform').value;
    $('#library-platform').replaceChildren(new Option('Todas as plataformas', ''));
    for (const platform of [...new Set(data.items.map(item => item.platform))].sort()) $('#library-platform').add(new Option(platform, platform));
    if ([...$('#library-platform').options].some(option => option.value === selectedPlatform)) $('#library-platform').value = selectedPlatform;
    const status = data.syncing ? `Sincronizando… ${data.progress.files} arquivos encontrados · ${data.progress.hashed} verificados. A primeira leitura calcula a identidade completa dos arquivos; pode demorar.` : data.lastSync ? 'Última sincronização: ' + new Date(data.lastSync).toLocaleString('pt-BR') : 'Adicione arquivos ou pastas para começar. Nenhum local é pesquisado automaticamente.';
    say(data.error || status, Boolean(data.error));
    $('#library-current').textContent = data.syncing ? data.progress.current : '';
    $('#library-warning').textContent = data.warnings?.length ? data.warnings.join('\n') : '';
    const sources = $('#library-sources'); sources.replaceChildren();
    for (const source of data.sources) {
      const row = node('li'); const label = node('span', `${source.kind === 'folder' ? 'Pasta' : 'Arquivo'}: ${source.path}`);
      label.title = source.error || ''; row.append(label);
      if (source.status === 'unavailable') row.append(node('span', 'Indisponível', 'library-badge'));
      row.append(action('Retirar origem', async () => {
        if (!confirm('Retirar esta origem do catálogo? Os arquivos originais permanecerão no disco.\n' + source.path)) return;
        try { render(await request('/remove-source', {id:source.id})); } catch (error) { say(error.message,true); }
      }, data.syncing)); sources.append(row);
    }
    $('#library-source-count').textContent = `Origens da biblioteca (${data.sources.length})`;
    renderItems();
    if (data.syncing) poll = setTimeout(refresh, 900);
  }
  function renderItems() {
    const query = $('#library-search').value.trim().toLocaleLowerCase('pt-BR');
    const platform = $('#library-platform').value, filter = $('#library-availability').value;
    const items = catalog.items.filter(item => (!query || `${item.title} ${item.path}`.toLocaleLowerCase('pt-BR').includes(query)) && (!platform || item.platform === platform) && (!filter || (filter === 'duplicates' ? item.duplicateCount > 0 : filter === 'offline' ? item.availability !== 'available' : item.availability === 'available'))).sort((a,b)=>a.title.localeCompare(b.title,'pt-BR'));
    const list = $('#library-items'); list.replaceChildren();
    $('#library-count').textContent = `${items.length} de ${catalog.items.length} arquivo(s)`;
    if (!items.length) list.append(node('li',catalog.items.length ? 'Nenhum arquivo corresponde aos filtros.' : 'Sua biblioteca está vazia. Use Adicionar jogos, Adicionar pasta ou Incluir convertidos.', 'library-empty'));
    for (const item of items.slice(0,shown)) {
      const row = node('li',null,'library-item'), info = node('div',null,'library-info');
      info.append(node('strong',item.title));
      info.append(node('div',`${item.platform} · ${item.format} · ${(item.size/1024/1024).toLocaleString('pt-BR',{maximumFractionDigits:1})} MB · ${availability[item.availability]}`, 'hint'));
      if (item.duplicateCount) info.append(node('span',`Cópia idêntica: ${item.duplicateCount} outra(s)`, 'library-badge'));
      if (item.previousPath) info.append(node('span','Relocalizado pelo conteúdo','library-badge'));
      if (item.format === 'PKG' && !item.validPkg) info.append(node('span','Cabeçalho PKG inválido','library-error'));
      info.append(node('div',item.path,'library-path'));
      row.append(info);
      const actions = node('div',null,'library-item-actions');
      const isPkg = item.format === 'PKG';
      const canConvert = item.format === 'ISO' && ['PS2','ISO não identificada'].includes(item.platform);
      if (isPkg || canConvert) actions.append(action(isPkg ? 'Usar PKG no envio' : item.platform === 'PS2' ? 'Preparar PS2' : 'Preparar como PS2', async () => {
        const confirmPS2 = item.platform === 'ISO não identificada';
        if (confirmPS2 && !confirm('A plataforma desta ISO não foi identificada. Confirma que é um jogo de PS2? O conversor integrado ainda é exclusivo para PS2.')) return;
        try {
          const selected = await request('/use',{id:item.id,confirmPS2});
          await state();
          if (selected.kind === 'iso') {
            document.querySelector('#convert-panel').open=true;
            document.querySelector('#convert-title').value=selected.title;
            renderConversion(selected.conversion);
            document.querySelector('#convert-panel').scrollIntoView({block:'start',behavior:'smooth'});
          } else document.querySelector('#file').scrollIntoView({block:'center',behavior:'smooth'});
          say(selected.kind==='iso' ? 'ISO selecionada. Confira nome, capa e opções antes de converter.' : 'PKG selecionado. Confira a conexão e clique em Enviar ao PS4.');
        } catch (error) { say(error.message,true); }
      },item.availability!=='available'||(isPkg&&!item.validPkg)));
      else actions.append(node('span','Somente catálogo nesta etapa','hint'));
      actions.append(action('Mostrar no Finder',async()=>{try{await request('/reveal',{id:item.id})}catch(error){say(error.message,true)}},item.availability!=='available'));
      row.append(actions);list.append(row);
    }
    $('#library-more').hidden = items.length <= shown;
  }
  for (const [selector,route] of [['#library-files','/files'],['#library-folders','/folders'],['#library-outputs','/outputs'],['#library-sync','/sync']]) $(selector).onclick=async()=>{
    buttons.forEach(id=>$(id).disabled=true);say(route==='/files'||route==='/folders'?'Escolha a origem no seletor do Mac…':'Preparando sincronização…');
    try {const data=await request(route);if(data.cancelled)await refresh();else render(data)}catch(error){await refresh();say(error.message,true)}
  };
  $('#library-cancel').onclick=async()=>{try{render(await request('/cancel'))}catch(error){say(error.message,true)}};
  for(const selector of ['#library-search','#library-platform','#library-availability']) $(selector).addEventListener(selector==='#library-search'?'input':'change',()=>{shown=100;renderItems()});
  $('#library-more').onclick=()=>{shown+=100;renderItems()};
  refresh();
})();
