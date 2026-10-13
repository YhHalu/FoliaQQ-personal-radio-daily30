'use strict';
const path=require('node:path');
const {app}=require('electron');
const {createBackend}=require('./backend.cjs');
module.exports=function activate(api){
  const base=path.join(app.getAppPath(),'node_modules/@yakult-green-tea/qq-music-api');
  if(require(path.join(base,'package.json')).version!=='3.1.3')throw new Error('Unsupported QQ backend version');
  const service=require(path.join(base,'dist/src/services/auth/qrLogin.node.js')).qrLoginService;
  const http=require(path.join(base,'dist/src/services/auth/httpClient.js')).default();
  const {buildAndroidComm}=require(path.join(base,'dist/src/services/auth/androidDevice.js'));
  const backend=createBackend({service,http,buildComm:buildAndroidComm});
  api.rpc.handle('recommend',(kind,owner,payload)=>backend.request(kind,owner,payload));
  api.log.info('QQ personal collections ready');
  return ()=>backend.dispose();
};
