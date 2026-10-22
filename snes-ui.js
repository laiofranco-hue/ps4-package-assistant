(() => {
  const $ = id => document.getElementById(id);
  let data = {items:[]}, shown = 48, timer, revision = '';
  const controls = ['snes-folder','snes-import','snes-prepare','snes-sync','snes-reveal'];
  function message(text, error=false) {
    $('snes-message').textContent=text;
    $('snes-message').classList.toggle('library-error',error);
  }
  async function request(route,body={}) {
    const response=await fetch('/api/snes'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error || 'Não foi possível completar a tarefa SNES.');
    return result;
  }
  function node(tag,text,className) {
    const element=document.createElement(tag);
    if(text != null)element.textContent=text;
    if(className)element.className=className;
    return element;
  }
  function renderItems() {
    const query=$('snes-search').value.trim().toLocaleLowerCase('pt-BR'), filter=$('snes-art').value;
    const items=data.items.filter(item=>(!query || (item.title+' '+item.name).toLocaleLowerCase('pt-BR').includes(query)) && (!filter || (filter==='neutral' ? item.art==='neutral' : item.art!=='neutral'))).sort((a,b)=>a.title.localeCompare(b.title,'pt-BR'));
    const list=$('snes-items');list.replaceChildren();
    $('snes-count').textContent=`${items.length} de ${data.items.length} entradas`;
    if(!items.length)list.append(node('li',data.items.length?'Nenhum jogo corresponde aos filtros.':'Comece em Escolher ISO e preparar, acima. Os jogos extraídos aparecerão aqui.','library-empty'));
    for(const item of items.slice(0,shown)) {
      const row=node('li',null,'snes-game');
      if(item.cover) {
        const image=node('img');image.src='/api/snes/cover?id='+encodeURIComponent(item.id)+'&v='+encodeURIComponent(data.revision || '');image.alt='';image.loading='lazy';image.width=140;image.height=160;
        image.onerror=()=>{image.hidden=true;};row.append(image);
      } else row.append(node('div','Sem capa','snes-no-cover'));
      row.append(node('strong',item.title),node('span',item.art==='neutral'?'Capa original não identificada':item.art.startsWith('game-base')?'Arte do jogo-base':'Capa do título','hint'),node('span',item.name,'library-path'));
      list.append(row);
    }
    $('snes-more').hidden=items.length<=shown;
  }
  function render(value) {
    data=value;
    controls.forEach(id=>$(id).disabled=Boolean(data.running));
    $('snes-prepare').disabled ||= !data.iso;
    $('snes-sync').disabled ||= !data.folder || !$('snes-closed').checked || !$('snes-ps4').value.trim();
    $('snes-reveal').disabled ||= !data.folder;
    $('snes-closed').disabled=Boolean(data.running);
    $('snes-cancel').hidden=!data.running;
    $('snes-cancel').disabled=data.status==='cancelling';
    $('snes-path').textContent=data.folder || 'Nenhuma biblioteca preparada ainda.';
    $('snes-selected-iso').textContent=data.iso || 'Nenhuma ISO selecionada.';
    const labels={idle:'A biblioteca fica no Mac. O envio ao PS4 só começa ao clicar em Enviar jogos e capas ao PS4.',preparing:'Preparando jogos e capas automaticamente… Ao concluir, confira a etapa 2. Mantenha o app aberto.',syncing:'Sincronizando com o pSNES… Mantenha o Mac e o PS4 ligados.',success:data.kind==='prepare'?'Biblioteca preparada no Mac. Confira os jogos abaixo antes de sincronizar.':'Sincronização concluída. Reabra o pSNES e confira os jogos e saves.',cancelling:'Cancelamento solicitado. Aguarde a operação atual terminar; a atualização final da lista precisa concluir ou restaurar o backup.',cancelled:'Tarefa cancelada. Arquivos e backups preservados.',attention:'Confira a tarefa anterior antes de continuar.'};
    message(data.error || labels[data.status] || '',Boolean(data.error));
    $('snes-log').textContent=(data.log||[]).join('\n');
    $('snes-log-panel').hidden=!(data.log||[]).length;
    const next=data.folder+'|'+data.revision;
    if(next!==revision){revision=next;renderItems();}
    clearTimeout(timer);
    if(data.running)timer=setTimeout(refresh,1000);
  }
  async function refresh() {
    try {
      const response=await fetch('/api/snes');
      if(!response.ok)throw new Error('Não foi possível carregar a biblioteca SNES.');
      render(await response.json());
    } catch(error){message(error.message+' Reabra o app se a conexão não voltar.',true);timer=setTimeout(refresh,3000);}
  }
  for(const [id,route] of [['snes-folder','/folder'],['snes-import','/import'],['snes-prepare','/prepare'],['snes-reveal','/reveal'],['snes-cancel','/cancel'],['snes-sync','/sync']]) {
    $(id).onclick=async()=>{
      controls.forEach(key=>$(key).disabled=true);
      try {
        const value=await request(route,route==='/sync'?{ps4Ip:$('snes-ps4').value.trim(),closed:$('snes-closed').checked}:{});
        if(route==='/sync')$('snes-closed').checked=false;
        render(value);
      } catch(error){await refresh();message(error.message,true);}
    };
  }
  $('snes-closed').onchange=()=>{$('snes-sync').disabled=data.running||!data.folder||!$('snes-closed').checked||!$('snes-ps4').value.trim();};
  $('snes-ps4').oninput=$('snes-closed').onchange;
  $('snes-search').oninput=()=>{shown=48;renderItems();};
  $('snes-art').onchange=()=>{shown=48;renderItems();};
  $('snes-more').onclick=()=>{shown+=48;renderItems();};
  refresh();
})();
