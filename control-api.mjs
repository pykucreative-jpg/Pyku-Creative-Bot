import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
const BODY_LIMIT = 29 * 1024 * 1024;
const CODE_DELIVERY_ERROR = 'Nie udało się dostarczyć kodu na Discordzie. Włącz prywatne wiadomości na serwerze FivemShop, sprawdź, czy bot nie jest zablokowany, i spróbuj ponownie za minutę.';
export function createControlApi({ secret, accounts, sendCode, actions, now = Date.now }) {
  if (!secret || secret.length < 16) throw new Error('Control API requires a server secret.');
  const key = createHmac('sha256', secret).update('fivemshop-desktop-control-v1').digest();
  const challenges = new Map(), limits = new Map(), pending = new Map();
  const mac = value => createHmac('sha256', key).update(value).digest('base64url');
  const equal = (a,b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
  const sign = value => { const payload=Buffer.from(JSON.stringify(value)).toString('base64url');return `${payload}.${mac(payload)}`; };
  function auth(request) {
    const token=request.headers.authorization?.replace(/^Bearer /,'');
    if (!token || token.length>2048) return null;
    const [data,sig,extra]=token.split('.');
    if (extra || !equal(sig,mac(data??''))) return null;
    try { const value=JSON.parse(Buffer.from(data,'base64url'));return Object.hasOwn(accounts,value.id) && value.exp>now() ? value : null; } catch { return null; }
  }
  function rate(key,max,window) {
    const time=now();const old=limits.get(key);const slot=old && old.until>time ? old : {count:0,until:time+window};
    slot.count++;limits.set(key,slot);if(slot.count>max)throw Object.assign(new Error('Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie.'),{status:429});
  }
  function prune() { const time=now();for(const [key,v] of challenges)if(v.exp<time)challenges.delete(key);for(const [key,v] of limits)if(v.until<time)limits.delete(key);for(const [key,v] of pending)if(v.until<time)pending.delete(key); }
  async function body(request, limit=8192) {
    if (!(request.headers['content-type']??'').startsWith('application/json')) throw Object.assign(new Error('Wymagany format JSON.'),{status:415});
    let length=0;const chunks=[];
    for await (const chunk of request) { length+=chunk.length;if(length>limit)throw Object.assign(new Error('Załączniki są za duże. Limit łączny to 20 MB.'),{status:413});chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Nieprawidłowe dane.'),{status:400}); }
  }
  function json(response,status,data) {response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer'});response.end(JSON.stringify(data));}
  return async (request,response) => {
    let path;
    try { path=new URL(request.url,'http://local').pathname; } catch { json(response,400,{error:'Nieprawidłowy adres żądania.'});return true; }
    if(!path.startsWith('/control/v1/'))return false;
    try {
      prune();rate('ip:'+request.socket.remoteAddress,240,60_000);
      const route=path.slice('/control/v1/'.length);
      if(request.method==='POST' && route==='request-code') {
        const data=await body(request);rate('auth-ip:'+request.socket.remoteAddress,8,10*60_000);
        if(!Object.hasOwn(accounts,data.id))throw Object.assign(new Error('To konto nie ma dostępu do aplikacji.'),{status:403});
        rate('code:'+data.id,1,60_000);
        const code=String(randomInt(100000,1000000)),challenge=randomBytes(24).toString('base64url');
        challenges.set(challenge,{id:data.id,hash:mac(challenge+code),exp:now()+5*60_000,attempts:0});
        try{await sendCode(data.id,code);}catch(cause){challenges.delete(challenge);const discordCode=String(cause?.code??'');console.error('Logowanie Windows: dostarczenie DM nie powiodło się; kod Discord:',/^\d{3,8}$/.test(discordCode)?discordCode:'nieznany');throw Object.assign(new Error(CODE_DELIVERY_ERROR),{status:502,code:'CODE_DELIVERY_FAILED'});}
        json(response,200,{challenge,expiresIn:300});return true;
      }
      if(request.method==='POST' && route==='verify-code') {
        const data=await body(request);rate('verify:'+request.socket.remoteAddress,20,10*60_000);
        const entry=challenges.get(data.challenge);
        if(!entry || entry.exp<now() || ++entry.attempts>5 || !equal(entry.hash,mac(String(data.challenge)+String(data.code)))){
          if(entry?.attempts>=5)challenges.delete(data.challenge);
          throw Object.assign(new Error('Nieprawidłowy lub wygasły kod logowania.'),{status:401});
        }
        challenges.delete(data.challenge);
        json(response,200,{token:sign({id:entry.id,exp:now()+7*24*60*60_000,nonce:randomBytes(16).toString('hex')}),user:{id:entry.id,...accounts[entry.id]}});return true;
      }
      const user=auth(request);
      if(!user)throw Object.assign(new Error('Zaloguj się ponownie.'),{status:401});
      if(route==='session' && request.method==='GET'){json(response,200,{user:{id:user.id,...accounts[user.id]}});return true;}
      const action=Object.hasOwn(actions,route)?actions[route]:null;
      if(!action || request.method!=='POST')throw Object.assign(new Error('Nie znaleziono operacji.'),{status:404});
      const data=await body(request,action.mutation?BODY_LIMIT:8192);
      rate('user:'+user.id,120,60_000);
      if(action.mutation) {
        if(typeof data.operationId!=='string' || !/^[a-zA-Z0-9-]{16,80}$/.test(data.operationId))throw Object.assign(new Error('Brak identyfikatora operacji.'),{status:400});
        const id=`${user.id}:${route}:${data.operationId}`;let task=pending.get(id);
        if(!task){if(pending.size>=1500)throw Object.assign(new Error('Serwer jest zajęty. Spróbuj później.'),{status:503});task={until:now()+60*60_000,promise:Promise.resolve().then(()=>action.run(user.id,data))};pending.set(id,task);}
        const result=await task.promise;json(response,200,result);return true;
      }
      json(response,200,await action.run(user.id,data));return true;
    } catch(error) {
      const status=error.status??400;console.error('Aplikacja Windows:',error.message);
      json(response,status,{error:error.code==='CODE_DELIVERY_FAILED' ? CODE_DELIVERY_ERROR : status>=500 ? 'Operacja nie została zakończona. Sprawdź historię przed ponowieniem.' : error.message});return true;
    }
  };
}
export function uploadedFiles(input, { imagesOnly=false, max=10 }={}) {
  if(!Array.isArray(input) || input.length>max)throw new Error('Nieprawidłowa liczba załączników.');
  let total=0;
  return input.map((item,index)=>{
    if(typeof item.base64!=='string' || item.base64.length>14*1024*1024)throw new Error('Załącznik jest za duży.');
    const buffer=Buffer.from(item.base64,'base64');total+=buffer.length;
    if(buffer.length>10*1024*1024 || total>20*1024*1024)throw new Error('Maksymalnie 10 MB na plik i 20 MB łącznie.');
    const png=buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));const jpg=buffer[0]===255&&buffer[1]===216&&buffer[2]===255;const gif=/^GIF8[79]a/.test(buffer.subarray(0,6).toString());const webp=buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP';
    if(imagesOnly && !png&&!jpg&&!gif&&!webp)throw new Error('Dodaj zdjęcia PNG, JPG, GIF lub WEBP.');
    const ext=png?'png':jpg?'jpg':gif?'gif':webp?'webp':String(item.name??'plik.bin').split('.').pop().replace(/[^a-zA-Z0-9]/g,'').slice(0,8)||'bin';
    return {attachment:buffer,name:`zalacznik-${index}.${ext}`,url:buffer};
  });
}
