const {app,BrowserWindow,ipcMain,protocol,safeStorage,shell,session}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path');
protocol.registerSchemesAsPrivileged([{scheme:'fivemshop',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let window,token='',server='';
let updates=null;
const methods=new Set(['bootstrap','offers/list','offers/save','offers/status','tickets/list','tickets/messages','tickets/reply','tickets/close']);
const configPath=()=>path.join(app.getPath('userData'),'connection.json');
const tokenPath=()=>path.join(app.getPath('userData'),'session.bin');
function validServer(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!(u.hostname.endsWith('.up.railway.app')||u.hostname==='api-fivemshop.pykucreative.pl'))throw new Error('Wpisz poprawny adres HTTPS serwera FivemShop.');return u.origin;}
async function clearToken(){token='';await fs.rm(tokenPath(),{force:true});}
async function request(route,data,method='POST'){
 if(!server)throw new Error('Połączenie z botem nie zostało jeszcze skonfigurowane.');
 let response;try{response=await fetch(server+'/control/v1/'+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(method==='POST'?{body:JSON.stringify(data??{})}:{}),redirect:'error',signal:AbortSignal.timeout(90000)});}catch{throw new Error('Nie udało się połączyć z botem. Sprawdź internet i ustawienia połączenia.');}
 let result;try{result=await response.json();}catch{throw new Error('Serwer zwrócił nieprawidłową odpowiedź.');}
 if(response.status===401){await clearToken();throw new Error(result.error??'Zaloguj się ponownie.');}
 if(!response.ok)throw new Error(result.error??'Operacja nie została zakończona.');return result;
}
function checked(event){if(event.sender!==window.webContents||event.senderFrame?.url!=='fivemshop://app/index.html')throw new Error('Nieprawidłowe okno aplikacji.');}
ipcMain.handle('fivemshop',async(event,action,data)=>{checked(event);
 if(action==='update-state')return updates?.state()??{status:'disabled',currentVersion:app.getVersion()};
 if(action==='check-updates')return updates?updates.check():{status:'disabled',currentVersion:app.getVersion()};
 if(action==='download-update'){if(!updates)throw new Error('Uruchom zainstalowaną aplikację Windows.');return updates.download();}
 if(action==='install-update'){if(!updates)throw new Error('Uruchom zainstalowaną aplikację Windows.');return updates.install();}
 if(action==='connection')return {server,version:app.getVersion(),savedSession:Boolean(token)};
 if(action==='set-connection'){const next=validServer(String(data.server));if(next!==server){await clearToken();server=next;await fs.writeFile(configPath(),JSON.stringify({server}));}return {server};}
 if(action==='request-code')return request('request-code',{id:data.id});
 if(action==='verify-code'){const result=await request('verify-code',{challenge:data.challenge,code:data.code});token=result.token;if(safeStorage.isEncryptionAvailable())await fs.writeFile(tokenPath(),safeStorage.encryptString(token));return {user:result.user};}
 if(action==='session'){if(!token)throw new Error('Zaloguj się, aby kontynuować.');return request('session',null,'GET');}
 if(action==='logout'){await clearToken();return {ok:true};}
 if(methods.has(action))return request(action,data);
 throw new Error('Nieznana operacja.');
});
ipcMain.handle('fivemshop-link',async(event,value)=>{checked(event);const u=new URL(value);if(u.protocol!=='https:'||!['discord.com','cdn.discordapp.com','media.discordapp.net'].includes(u.hostname))throw new Error('Ten link nie jest dozwolony.');await shell.openExternal(u.href);});
app.whenReady().then(async()=>{
 if(app.isPackaged){
  const {autoUpdater}=require('electron-updater');
  updates=require('./updater.cjs').createUpdateController({updater:autoUpdater,currentVersion:app.getVersion(),onState:state=>{if(window&&!window.isDestroyed())window.webContents.send('fivemshop-update',state);}});
 }
 app.setAppUserModelId('pl.pykucreative.fivemshop');
 await fs.mkdir(app.getPath('userData'),{recursive:true});
 try{server=validServer(JSON.parse(await fs.readFile(configPath(),'utf8')).server);}catch{try{server=validServer(JSON.parse((await fs.readFile(path.join(__dirname,'connection.json'),'utf8')).replace(/^\uFEFF/,'')).server);}catch{}}
 try{if(safeStorage.isEncryptionAvailable())token=safeStorage.decryptString(await fs.readFile(tokenPath()));}catch{}
 protocol.handle('fivemshop',async request=>{const u=new URL(request.url);const name=u.pathname==='/'?'index.html':u.pathname.slice(1);const allowed={'index.html':'text/html','app.js':'text/javascript','style.css':'text/css','logo.png':'image/png','showroom.png':'image/png','showroom.jpg':'image/jpeg','logo.ico':'image/x-icon'};if(u.host!=='app'||!allowed[name])return new Response('Not found',{status:404});return new Response(await fs.readFile(path.join(__dirname,'ui',name)),{headers:{'Content-Type':allowed[name],'X-Content-Type-Options':'nosniff'}});});
 session.defaultSession.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
 window=new BrowserWindow({width:1320,height:880,minWidth:980,minHeight:680,title:'FivemShop',backgroundColor:'#111016',icon:path.join(__dirname,'ui/logo.png'),autoHideMenuBar:true,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('fivemshop://app/'))event.preventDefault();});
 window.once('ready-to-show',()=>window.show());await window.loadURL('fivemshop://app/index.html');
 if(updates){updates.check().catch(()=>{});setInterval(()=>updates.check().catch(()=>{}),4*60*60*1000).unref();}
});
app.on('window-all-closed',()=>app.quit());
