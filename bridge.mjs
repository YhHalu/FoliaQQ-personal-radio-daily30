const cookieKey='online_provider:qq:cookie';
export function readToken(storage) {
  const cookie=storage.getItem(cookieKey)||'';
  return cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('qqmusic_session='))?.slice('qqmusic_session='.length)||'';
}
const day=now=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date(now));
export function createBridge({omni,provider,register,rpc,storage,now=Date.now,onError=()=>{}}) {
  const originalSummaries=omni.getProviderSummaries;
  let disposed=false,epoch=0,ownerKey='',dailyCache=null,dailyPending=null;
  let radioTail=Promise.resolve(),seen=new Set();
  const owner=()=>{
    const summary=originalSummaries.call(omni).find(p=>p.providerId==='qq');
    const token=readToken(storage),accountId=summary?.user?.id;
    if(!token || accountId==null || !String(accountId) || summary?.error==='auth-required' || ['anonymous','logged-out','unauthenticated','error'].includes(summary?.status))return null;
    return {token,accountId:String(accountId)};
  };
  function sync(){
    if(disposed)return null;
    const o=owner(),key=o?`${o.accountId}|${o.token}|${day(now())}`:'';
    if(key!==ownerKey){ownerKey=key;epoch++;dailyCache=null;dailyPending=null;seen=new Set();}
    return o;
  }
  function assertCurrent(o,generation){
    const current=sync();
    if(disposed || generation!==epoch || !current || current.accountId!==o.accountId || current.token!==o.token)throw new DOMException('QQ account changed','AbortError');
  }
  async function request(kind,o,generation){
    const response=await rpc(kind,o);
    assertCurrent(o,generation);
    if(!response?.ok){const e=new Error(response?.error||'REQUEST_FAILED');onError(e.message);throw e;}
    if(response.data?.accountId!==o.accountId || !Array.isArray(response.data?.songs))throw new Error('ACCOUNT_CHANGED');
    return response.data.songs.map(s=>provider.normalizeSong(s));
  }
  async function getDailySongs(force=false){
    const o=sync(),generation=epoch;
    if(!o)throw new Error('LOGIN_REQUIRED');
    if(!force&&dailyCache)return dailyCache;
    if(dailyPending)return dailyPending;
    const pending=request('daily',o,generation).then(songs=>{assertCurrent(o,generation);dailyCache=songs;return songs;});
    dailyPending=pending;
    try{return await pending;}finally{if(dailyPending===pending)dailyPending=null;}
  }
  function getPersonalFm(){
    const o=sync(),generation=epoch;
    if(!o)return Promise.reject(new Error('LOGIN_REQUIRED'));
    const work=radioTail.catch(()=>{}).then(async()=>{
      assertCurrent(o,generation);
      for(let attempt=0;attempt<3;attempt++){
        const songs=await request('radio',o,generation),batch=new Set();
        const fresh=songs.filter(s=>{const id=String(s.sourceRef?.mediaId||s.qqMid||s.id);if(seen.has(id)||batch.has(id))return false;batch.add(id);return true;});
        if(fresh.length){for(const id of batch)seen.add(id);while(seen.size>300)seen.delete(seen.values().next().value);return fresh;}
        if(!songs.length)break;
      }
      throw new Error('RADIO_NO_NEW_SONGS');
    });
    radioTail=work;return work;
  }
  const replacement={...provider,recommendations:{...provider.recommendations,getDailySongs,getPersonalFm}};
  // Keep the stock radio tab unchanged: our account/date-scoped daily card avoids
  // the host's shared native daily resource key and sits beside imported playlists.
  function summaries(){
    const current=sync();
    return originalSummaries.call(omni).map(p=>{
      if(p.providerId!=='qq'||!current||String(p.user?.id)!==current.accountId)return p;
      const extra=[
        {providerId:'qq',id:`folium-qq-daily:${encodeURIComponent(current.accountId)}:${day(now())}`,type:'daily_recommendations',name:'每日30首',description:'QQ 音乐每天为当前账号推荐的歌曲 · 独立入口',trackCount:dailyCache?.length,hideable:false,isOwned:false},
        {providerId:'qq',id:'personal_fm',type:'radio',name:'个性电台',description:'跟随当前账号，播放时持续推荐 · 独立入口',hideable:false,isOwned:false},
      ];
      return {...p,collections:[...(p.collections||[]),...extra]};
    });
  }
  omni.getProviderSummaries=summaries;
  try{register(replacement);}catch(e){omni.getProviderSummaries=originalSummaries;throw e;}
  return {provider:replacement,getDailySongs,getPersonalFm,sync,
    poll(){const previous=ownerKey;sync();if(previous!==ownerKey&&!disposed)register(replacement);},
    refresh(){dailyCache=null;register(replacement);},
    dispose(){
      disposed=true;epoch++;dailyCache=null;dailyPending=null;seen.clear();
      if(omni.getProviderSummaries===summaries)omni.getProviderSummaries=originalSummaries;
      register(provider);
    },
  };
}
