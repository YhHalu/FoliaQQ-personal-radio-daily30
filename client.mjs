import {createBridge} from './bridge.mjs';
const messages={LOGIN_REQUIRED:'请先登录 QQ 音乐',ACCOUNT_CHANGED:'账号已切换，请重新打开推荐入口',DAILY_CARD_NOT_FOUND:'当前账号暂未返回每日30首',RADIO_NO_NEW_SONGS:'暂时没有新的电台歌曲，请稍后再试',BUSY:'请求处理中，请稍后再试',ENOTFOUND:'暂时无法连接 QQ 音乐',REQUEST_FAILED:'QQ 音乐请求失败，请检查网络或重新登录'};
export default async function activate(folium){
  if(folium.env.context!=='main')return;
  const {omni}=folium.internals;
  // Folia 0.7.16 exact bundle: its registry is needed to notify existing subscribers.
  const registry=await import(new URL('./assets/providerRegistry-CFhm3rDN.js',document.baseURI).href);
  const provider=registry.t('qq');
  if(!provider?.normalizeSong||typeof registry.o!=='function')throw new Error('QQ provider compatibility check failed');
  let lastError=0;
  const bridge=createBridge({omni,provider,register:p=>registry.o(p),storage:localStorage,rpc:(kind,owner)=>folium.rpc.call('recommend',kind,owner),onError:code=>{
    if(Date.now()-lastError<4000)return;lastError=Date.now();
    folium.log.warn(messages[code]||'QQ 音乐推荐暂时不可用');
  }});
  const timer=setInterval(()=>bridge.poll(),1000);
  return ()=>{clearInterval(timer);bridge.dispose();};
}
