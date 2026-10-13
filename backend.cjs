'use strict';
const error = code => Object.assign(new Error(code), {code});
const accountIds = auth => [auth.credential.str_musicid,auth.credential.musicid].filter(x=>x!=null).map(String);
function checked(data) {
  if (!data || typeof data!=='object') throw error('INVALID_RESPONSE');
  for (const key of ['code','retcode','retCode']) if(data[key]!==undefined && Number(data[key])!==0) throw error('UPSTREAM_REJECTED');
  return data;
}
function publicSong(raw) {
  const s=raw?.track||raw?.Track||raw;
  if(!s?.mid || !(s.name||s.title)) throw error('INVALID_SONG');
  const str=v=>String(v??'');
  return {id:s.id,mid:str(s.mid),name:str(s.name||s.title),title:str(s.title||s.name),interval:Number(s.interval)||0,
    singer:(Array.isArray(s.singer)?s.singer:[]).map(a=>({id:a.id,mid:str(a.mid),name:str(a.name)})),
    album:{id:s.album?.id,mid:str(s.album?.mid),name:str(s.album?.name)},
    file:{media_mid:str(s.file?.media_mid)}};
}
function createBackend({service,http,buildComm,now=Date.now}) {
  let disposed=false,pending=0;
  async function resolve(owner) {
    if(disposed) throw error('MOD_DISABLED');
    if(!owner || typeof owner.token!=='string' || !owner.token || owner.token.length>1024 || typeof owner.accountId!=='string' || !owner.accountId) throw error('LOGIN_REQUIRED');
    const auth=await service.authFor(owner.token);
    if(!auth || auth.expiresAt<=now()) throw error('LOGIN_REQUIRED');
    if(!accountIds(auth).includes(owner.accountId)) throw error('ACCOUNT_CHANGED');
    return auth;
  }
  async function call(owner,module,method,param) {
    const auth=await resolve(owner),c=auth.credential,uin=String(c.str_musicid||c.musicid);
    const response=await http.post('https://u.y.qq.com/cgi-bin/musicu.fcg',{
      comm:buildComm(auth.device,c),req_0:{module,method,param},
    },{headers:{'User-Agent':`QQMusic 14090008(android ${auth.device.osRelease})`,Cookie:`uin=${uin}; qqmusic_uin=${uin}; qm_keyst=${c.musickey}; qqmusic_key=${c.musickey}`}});
    await resolve(owner);
    const body=checked(response.data),block=checked(body.req_0);
    return checked(block.data);
  }
  async function daily(owner) {
    const feed=await call(owner,'music.recommend.RecommendFeed','get_recommend_feed',{page:1,direction:0,s_num:0,v_cache:[]});
    const candidates=(feed.v_shelf||[]).flatMap(s=>(s.v_niche||[]).flatMap(n=>n.v_card||[]))
      .filter(c=>Number(c.type)===500&&/^(每日\s*30\s*首|每日三十首)$/.test(String(c.title).trim()));
    const ids=new Set(candidates.map(c=>String(c.id)));
    if(ids.size!==1) throw error(ids.size?'DAILY_CARD_AMBIGUOUS':'DAILY_CARD_NOT_FOUND');
    const card=candidates[0],id=String(card.id);
    if(!/^\d+$/.test(id)) throw error('INVALID_PLAYLIST_ID');
    const songs=[],seenPages=new Set();let total=0;
    for(let page=0;page<10;page++) {
      await resolve(owner);
      const data=checked(await service.getOwnedPlaylistSongs(owner.token,{disstid:id,dirid:Number(card.miscellany?.dirid)||0,offset:songs.length,limit:100}));
      await resolve(owner);
      if(data.dirinfo?.id && String(data.dirinfo.id)!==id) throw error('PLAYLIST_ID_MISMATCH');
      if(!Array.isArray(data.songlist)) throw error('INVALID_RESPONSE');
      const incoming=data.songlist.map(publicSong),fingerprint=incoming.map(s=>s.mid).join(',');
      if(incoming.length&&seenPages.has(fingerprint)) throw error('PAGINATION_REPEATED');
      seenPages.add(fingerprint);songs.push(...incoming);
      total=Number(data.total_song_num??songs.length);
      if(!(data.hasmore===true||Number(data.hasmore)===1)) {
        if(songs.length<total) throw error('INCOMPLETE_PLAYLIST');
        return {accountId:owner.accountId,kind:'daily',playlistId:id,songs,total,fetchedAt:now()};
      }
      if(!incoming.length) throw error('PAGINATION_EMPTY');
    }
    throw error('PAGINATION_LIMIT');
  }
  async function radio(owner) {
    const data=await call(owner,'music.radioProxy.MbTrackRadioSvr','get_radio_track',{id:99,num:5,from:0,scene:0,song_ids:[]});
    if(!Array.isArray(data.tracks)) throw error('INVALID_RESPONSE');
    return {accountId:owner.accountId,kind:'radio',songs:data.tracks.map(publicSong),fetchedAt:now()};
  }
  return {
    async request(kind,owner){
      if(!['daily','radio'].includes(kind))return {ok:false,error:'UNSUPPORTED_OPERATION'};
      if(pending>=4)return {ok:false,error:'BUSY'};
      pending++;
      try{return {ok:true,data:await(kind==='daily'?daily(owner):radio(owner))};}
      catch(e){return {ok:false,error: typeof e.code==='string'&&/^[A-Z_]+$/.test(e.code)?e.code:'REQUEST_FAILED'};}
      finally{pending--;}
    },
    dispose(){disposed=true;},
  };
}
module.exports={createBackend,publicSong};
