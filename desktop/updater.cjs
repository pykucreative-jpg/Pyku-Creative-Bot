'use strict';
function createUpdateController({updater,currentVersion,enabled=true,onState=()=>{}}){
 let state={status:enabled?'idle':'disabled',currentVersion,version:null,percent:0},checking=null,downloading=null;
 const publish=patch=>{state={...state,...patch};onState({...state});};
 const version=value=>typeof value==='string'&&/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(value)?value:null;
 if(enabled){
  updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowPrerelease=false;updater.allowDowngrade=false;
  updater.on('checking-for-update',()=>publish({status:'checking'}));
  updater.on('update-available',info=>publish({status:'available',version:version(info.version),percent:0}));
  updater.on('update-not-available',()=>publish({status:'current',version:null,percent:0}));
  updater.on('download-progress',p=>publish({status:'downloading',percent:Math.max(0,Math.min(100,Number(p.percent)||0))}));
  updater.on('update-downloaded',info=>publish({status:'ready',version:version(info.version),percent:100}));
  updater.on('error',()=>publish({status:'error',message:'Nie udało się sprawdzić lub pobrać aktualizacji. Sprawdź internet i spróbuj ponownie.'}));
 }
 return {
  state:()=>({...state}),
  async check(){if(!enabled||['downloading','ready','installing'].includes(state.status))return {...state};if(!checking)checking=Promise.resolve().then(()=>updater.checkForUpdates()).catch(()=>publish({status:'error',message:'Nie udało się sprawdzić aktualizacji. Spróbuj ponownie później.'})).finally(()=>checking=null);await checking;return {...state};},
  async download(){if(!enabled)throw new Error('Aktualizacje są dostępne w zainstalowanej aplikacji Windows.');if(downloading)return downloading;if(!state.version||!['available','error'].includes(state.status))throw new Error('Najpierw sprawdź dostępność aktualizacji.');publish({status:'downloading',percent:0});downloading=Promise.resolve().then(()=>updater.downloadUpdate()).catch(()=>publish({status:'error',message:'Nie udało się pobrać aktualizacji. Możesz spróbować ponownie.'})).then(()=>({...state})).finally(()=>downloading=null);return downloading;},
  install(){if(state.status!=='ready')throw new Error('Aktualizacja nie jest jeszcze pobrana.');publish({status:'installing'});setTimeout(()=>updater.quitAndInstall(false,true),250).unref();return {restarting:true};}
 };
}
module.exports={createUpdateController};
