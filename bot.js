import {
  Client, Events, GatewayIntentBits, Partials, ChannelType, PermissionFlagsBits as P,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
  MessageFlags, ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle, FileUploadBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder,
} from 'discord.js';
import { createServer } from 'node:http';
import { createControlApi, uploadedFiles } from './control-api.mjs';

const OWNER_ID = '795755381744861184';
const CAR_OWNER_ID = '317932984663539723';
const SUPPORT_ROLE_ID = '1562454115206955059';
const VERIFY_ROLE_ID = '1562457525868040192';
const VERIFY_CHANNEL_ID = '1562457528829214760';
const WELCOME_CHANNEL_ID = '1562442549099110560';
const MEMBER_WELCOME_CHANNEL_ID = '1566845033980887060';
const BUMP_CHANNEL_ID = '1565758802970546206';
const DISBOARD_ID = '302050872383242240';
const BUMP_COOLDOWN = 2 * 60 * 60 * 1000;
const BUMP_REPEAT = 30 * 60 * 1000;
const BUMP_MARKER = 'FivemShop • Przypomnienie /bump';
const bumpState = { lastBump: 0, nextAt: 0, lastSignalAt: 0, successes: new Map(), lastReminder: 0, reminders: new Set(), ready: false };
const VERIFY_BUTTON_ID = 'fivemshop_accept_rules_v1';
let verificationMessageId;
const { DISCORD_TOKEN, GUILD_ID } = process.env;
if (![DISCORD_TOKEN, GUILD_ID].every(Boolean)) {
  throw new Error('Uzupełnij DISCORD_TOKEN i GUILD_ID w pliku .env.');
}
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
  allowedMentions: { parse: [] },
});
const memberWelcomes = new Map();
function memberWelcomePayload(member, count) {
  const card = new EmbedBuilder().setColor(0xc7a36b)
    .setAuthor({name:'FivemShop • A new member has joined',iconURL:client.user.displayAvatarURL()})
    .setTitle('Great to see you! 👋')
    .setDescription(`Hi <@${member.id}>! Welcome to **FivemShop**.\n\n🏎️ Cars with character\n🎨 Weapon skins, mods & citizen packs\n👕 Clothing for characters, crews & businesses\n⚡ PC optimisation\n\nStart with verification, then explore the catalogs. DM our bot for questions and orders — English and Polish support are available.`)
    .setThumbnail(member.user.displayAvatarURL({size:256}))
    .addFields({name:'🖤 Welcome to the community',value:`You are member **#${count.toLocaleString('en-GB')}**.`,inline:false})
    .setFooter({text:'FivemShop • Your style. Your FiveM.'}).setTimestamp(member.joinedTimestamp??Date.now());
  return {content:`👋 <@${member.id}>, witaj w **FivemShop**!`,embeds:[card],components:[],allowedMentions:{users:[member.id],parse:[]}};
}
async function removeMemberWelcomeButtons(guild) {
  const channel = await guild.channels.fetch(MEMBER_WELCOME_CHANNEL_ID);
  if(channel?.type !== ChannelType.GuildText)return;
  const messages = await channel.messages.fetch({limit:100});
  let updated=0;
  for(const message of messages.values())if(message.author.id===client.user.id && message.components.length && message.embeds[0]?.author?.name==='FivemShop • A new member has joined'){
    await message.edit({components:[]});updated++;
  }
  console.log(`Powitania nowych członków: usunięto przyciski z ${updated} wiadomości.`);
}
async function welcomeNewMember(member) {
  if (member.guild.id !== GUILD_ID) return;
  const key = `${member.id}:${member.joinedTimestamp}`;
  if (memberWelcomes.has(key)) return memberWelcomes.get(key);
  const count = member.guild.memberCount;
  const task = (async()=>{
    const channel = await member.guild.channels.fetch(MEMBER_WELCOME_CHANNEL_ID);
    if(channel?.type !== ChannelType.GuildText)throw new Error('Nie znaleziono kanału powitań nowych członków.');
    const me = await member.guild.members.fetchMe();
    if(!channel.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks]))throw new Error('Bot potrzebuje uprawnień Wyświetlanie kanału, Wysyłanie wiadomości i Osadzanie linków na kanale powitań.');
    await channel.send(memberWelcomePayload(member,count));
    console.log(`Powitanie nowego członka: wysłano; licznik ${count}.`);
  })();
  memberWelcomes.set(key,task);
  if(memberWelcomes.size>500)memberWelcomes.delete(memberWelcomes.keys().next().value);
  try{await task;}catch(error){memberWelcomes.delete(key);throw error;}
}
client.on(Events.GuildMemberAdd, member => {welcomeNewMember(member).catch(error=>console.error('Powitanie nowego członka:',error.message));});
const BRAND = 'P.Y.K.U CREATIVE';
const webCatalog = { data: null, expires: 0, pending: null };
const CAR_GROUPS = [
  ['sportowe', /sport/, 'Sportowe'], ['sedan', /sedan/, 'Sedan'], ['offroad', /off.?road|teren/, 'Offroad'],
  ['bogate-tune', /bogate|tune|tuning/, 'Bogate tune'], ['motocykle', /motocykl|motor/, 'Motocykle'],
  ['pakiety', /pakiet/, 'Pakiety aut'], ['suv', /suv/, 'SUV'], ['coupe', /coupe/, 'Coupe'], ['muscle', /muscle/, 'Muscle'], ['supersamochody', /super/, 'Supersamochody'],
];
function websiteOffer(message, channel) {
  if (message.author.id !== client.user.id) return null;
  const card = offerEmbeds(message)[0];
  if (!card?.title || !/^P\.Y\.K\.U CREATIVE • (Auta FiveM|Oferta FiveM)$/.test(card.footer?.text ?? '')) return null;
  const cars = card.footer.text.includes('Auta FiveM');
  if (cars && card.fields.some(field => field.name === 'Status' && ['Sprzedane','Wycofane'].includes(field.value))) return null;
  const chosen = card.fields.find(field => field.name === '📂 Kategoria')?.value;
  const category = cars ? (CAR_GROUPS.find(([key, , label]) => chosen === key || chosen === label)
    ?? CAR_GROUPS.find(([, regex]) => regex.test(channel.name.toLowerCase())))?.[0] ?? 'inne-auta' : 'uslugi';
  return { id: message.id, name: card.title, description: card.description ?? '',
    price: card.fields.find(field => field.name === '💰 Cena')?.value ?? 'Wycena indywidualna',
    images: offerEmbeds(message).map(embed => embed.image?.url).filter(Boolean),
    category, type: cars ? 'auta' : 'uslugi', channel: channel.name, discordUrl: message.url,
    createdAt: new Date(message.createdTimestamp).toISOString() };
}
async function loadWebsiteCatalog(guild) {
  if (webCatalog.data && Date.now() < webCatalog.expires) return webCatalog.data;
  if (webCatalog.pending) return webCatalog.pending;
  webCatalog.pending = (async () => {
    const channels = await guild.channels.fetch();
    const offers = new Map(), galleries = [];
    for (const channel of channels.values()) {
      if (channel?.type !== ChannelType.GuildText || /^pyku:/.test(channel.topic ?? '')) continue;
      if (!channel.permissionsFor(guild.members.me)?.has([P.ViewChannel, P.ReadMessageHistory])) continue;
      let before;
      while (true) {
        const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        for (const message of page.values()) {
          const item = websiteOffer(message, channel);
          if (item) offers.set(item.id, item);
          else if (message.author.id === client.user.id && message.embeds[0]?.footer?.text === `${BRAND} • Galeria oferty`) {
            const original = message.embeds[0].description?.match(/discord.com\/channels\/\d+\/\d+\/(\d+)/)?.[1];
            if (original) galleries.push({ id: original, images: offerEmbeds(message).map(embed => embed.image?.url).filter(Boolean) });
          }
        }
        if (page.size < 100) break;
        before = page.last().id;
      }
    }
    for (const gallery of galleries) {
      const item = offers.get(gallery.id);
      if (item) item.images.push(...gallery.images);
    }
    const data = { updatedAt: new Date().toISOString(), offers: [...offers.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
    webCatalog.data = data; webCatalog.expires = Date.now() + 60_000;
    return data;
  })();
  try { return await webCatalog.pending; } finally { webCatalog.pending = null; }
}
function desktopActions(guild) {
  const accounts = { [OWNER_ID]:{name:'OFFWHITE',department:'Projekty i usługi'},[CAR_OWNER_ID]:{name:'Ponczula420',department:'Samochody'} };
  const session = userId => ({user:{id:userId,...accounts[userId]},categories:orderedCarGroups(guild).map(([key,,label])=>({key,label,channel:CAR_CHANNELS[key]}))});
  const id = value => {if(typeof value!=='string'||!/^\d{15,22}$/.test(value))throw new Error('Nieprawidłowy identyfikator.');return value;};
  const actor = async userId => ({guild,guildId:GUILD_ID,user:{id:userId},member:await guild.members.fetch(userId)});
  const record = message => {const data=carDraftFromMessage(message);return {id:message.id,channel:message.channelId,name:data.name,description:data.description,price:data.price,category:data.category,categoryLabel:data.categoryLabel,status:data.status,photos:data.photos.map(p=>p.url),version:message.editedTimestamp??null,url:message.url};};
  async function ticketChannel(userId, channelId, allowClosed=false) {
    const channel=await guild.channels.fetch(id(channelId));
    const open=activeTicket(channel?.topic);const closed=/^pyku:(closed|closedoffer):(\d+)(?::(\d+))?(?::(car))?$/.exec(channel?.topic??'');
    if(!open&&!(allowClosed&&closed))throw new Error('Zgłoszenie jest zamknięte lub nie istnieje.');
    const topic=closed?channel.topic.replace(/^pyku:closedoffer:/,'pyku:offer:').replace(/^pyku:closed:/,'pyku:open:'):channel.topic;
    if(!await canHandleTicket(userId,guild,topic))throw Object.assign(new Error('Nie masz dostępu do tej rozmowy.'),{status:403});
    return {channel,match:open??closed,closed:Boolean(closed),topic};
  }
  return {
    bootstrap:{run:async userId=>{await guild.channels.fetch();return session(userId);}},
    'offers/list':{run:async(userId,data)=>{if(!canManageCars(userId))throw new Error('Brak dostępu do aut.');const key=data.category??'sportowe';if(!CAR_CHANNELS[key])throw new Error('Nieprawidłowa kategoria.');const channel=await offerDestination(await actor(userId),CAR_CHANNELS[key]);const messages=await channel.messages.fetch({limit:25,...(data.before?{before:id(data.before)}:{})});return {offers:[...messages.values()].filter(managedCar).map(record),before:messages.size===25?messages.last().id:null};}},
    'offers/save':{mutation:true,run:async(userId,data)=>{
      if(!canManageCars(userId))throw new Error('Brak dostępu do aut.');
      const name=String(data.name??'').trim(),description=String(data.description??'').trim(),price=String(data.price??'').trim();
      if(!name||name.length>150||!description||description.length>3000||!price||price.length>150||!CAR_CHANNELS[data.category])throw new Error('Uzupełnij nazwę, opis, cenę i kategorię.');
      const uploads=uploadedFiles(data.files??[],{imagesOnly:true});
      const interaction=await actor(userId);const channel=await offerDestination(interaction,CAR_CHANNELS[data.category]);
      const sourceChannel=data.id?id(data.channel??channel.id):null;
      return serial(data.id?`car-offer:${sourceChannel}:${id(data.id)}`:`desktop-new:${userId}`,async()=>{
        let source,previous;if(data.id){source=(await carOfferSource(interaction,sourceChannel,id(data.id))).message;if((source.editedTimestamp??null)!==(data.version??null))throw new Error('Oferta została zmieniona. Odśwież ją przed edycją.');previous=carDraftFromMessage(source);if(previous.status!=='Dostępne')throw new Error('Najpierw przywróć dostępność oferty.');}
        const photos=uploads.length?uploads:previous?.photos??[];if(!photos.length)throw new Error('Dodaj co najmniej jedno zdjęcie.');
        const draft={cars:true,name,description,price,category:data.category,categoryLabel:CAR_GROUPS.find(([key])=>key===data.category)[2],photos};
        const sent=await saveCarListing(channel,draft,source);
        webCatalog.expires=0;return {offer:record(sent)};
      });
    }},
    'offers/status':{mutation:true,run:async(userId,data)=>{
      if(!canManageCars(userId))throw new Error('Brak dostępu do aut.');if(!['Dostępne','Sprzedane','Wycofane'].includes(data.status))throw new Error('Nieprawidłowy status.');
      const interaction=await actor(userId);return serial(`car-offer:${id(data.channel)}:${id(data.id)}`,async()=>{const {message}=await carOfferSource(interaction,data.channel,data.id);if((message.editedTimestamp??null)!==(data.version??null))throw new Error('Oferta została zmieniona. Odśwież katalog.');const draft=carDraftFromMessage(message);draft.status=data.status;const sent=await message.edit({...carListingPayload(draft),content:null,embeds:[],attachments:[]});webCatalog.expires=0;return {offer:record(sent)};});
    }},
    'tickets/list':{run:async(userId,data)=>{
      const channels=await guild.channels.fetch();const rows=[];
      for(const channel of channels.values()){
        if(channel?.type!==ChannelType.GuildText||!/^pyku:(open|offer|closed|closedoffer):/.test(channel.topic??''))continue;
        const closed=/^pyku:closed/.test(channel.topic);if(closed!==Boolean(data.closed))continue;
        try{const info=await ticketChannel(userId,channel.id,true);const user=await client.users.fetch(info.match[2]);rows.push({id:channel.id,customerId:user.id,name:user.globalName??user.username,username:user.username,label:ticketLabel(activeTicket(info.topic)),closed,lastMessageId:channel.lastMessageId??null});}catch(error){if(error.status!==403)console.error('Lista rozmów:',channel.id,error.message);}
      }
      return {tickets:rows.sort((a,b)=>String(b.lastMessageId??b.id).localeCompare(String(a.lastMessageId??a.id)))};
    }},
    'tickets/messages':{run:async(userId,data)=>{
      const {channel,closed,match}=await ticketChannel(userId,data.channel,true);
      const customer=await client.users.fetch(match[2]);
      const messages=await channel.messages.fetch({limit:50,...(data.before?{before:id(data.before)}:{})});
      return {closed,before:messages.size===50?messages.last().id:null,messages:[...messages.values()].reverse().filter(m=>m.embeds[0]?.footer?.text!==TICKET_PANEL_MARKER).map(m=>ticketMessageRecord(m,customer))};
    }},
    'tickets/reply':{mutation:true,run:async(userId,data)=>serial('tickets',async()=>{
      const {channel,match,topic}=await ticketChannel(userId,data.channel);const text=String(data.text??'').trim();const files=uploadedFiles(data.files??[],{max:3});
      if((!text&&!files.length)||text.length>1800)throw new Error('Wpisz odpowiedź do 1800 znaków lub dodaj załącznik.');
      const user=await client.users.fetch(match[2]);
      const sent=await user.send({content:`**FivemShop • ${publicTicketLabel(activeTicket(topic),ticketLanguages.get(channel.id)??'en')}**\n${text}`,files:files.map(f=>({attachment:f.attachment,name:f.name})),allowedMentions:{parse:[]}});
      try{await channel.send({content:`**Obsługa (${accounts[userId].name}) → klient:**\n${text}`,files:files.map(f=>({attachment:f.attachment,name:f.name})),embeds:[new EmbedBuilder().setFooter({text:`FivemShop Desktop • ${data.operationId}`})],allowedMentions:{parse:[]}});}catch{throw new Error(`DM został wysłany (ID ${sent.id}), ale zapis w historii nie powiódł się. Nie wysyłaj ponownie tej odpowiedzi.`);}
      return {sent:true,messageId:sent.id};
    })},
    'tickets/close':{mutation:true,run:async(userId,data)=>serial('tickets',async()=>{
      const {channel}=await ticketChannel(userId,data.channel);
      return closeTicket(channel,userId,accounts[userId].name);
    })},
  };
}

const DESKTOP_LOGIN_CHANNEL = '1565758802970546206';
const desktopLoginCards = new Map();
let desktopLoginSequence = 0;
async function sendDesktopLoginCode(guild, id, code) {
  const channel = await guild.channels.fetch(DESKTOP_LOGIN_CHANNEL);
  const me = await guild.members.fetchMe();
  const member = await guild.members.fetch(id);
  if (channel?.type !== ChannelType.GuildText || !channel.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages]) || !channel.permissionsFor(member)?.has(P.ViewChannel)) throw new Error('Kanał logowania jest niedostępny.');
  for (const [key,entry] of desktopLoginCards) if (entry.id === id || entry.expires <= Date.now()) {
    desktopLoginCards.delete(key);await entry.message.delete().catch(()=>{});
  }
  const key = `${Date.now().toString(36)}-${++desktopLoginSequence}`;
  const message = await channel.send({content:`🔐 <@${id}> — logowanie do **FivemShop Command Center**.\nKliknij przycisk poniżej. Kod zobaczysz tylko Ty; jest ważny przez 5 minut.\nJeśli nie logujesz się do programu, zignoruj tę wiadomość.`,components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`desktop_login:${key}`).setLabel('Pokaż mój kod').setEmoji('🔑').setStyle(ButtonStyle.Primary))],allowedMentions:{users:[id],parse:[]}});
  const entry = {id,code,message,expires:Date.now()+5*60_000};desktopLoginCards.set(key,entry);
  setTimeout(()=>{if(desktopLoginCards.get(key)!==entry)return;desktopLoginCards.delete(key);entry.message.delete().catch(()=>{});},5*60_000).unref();
}
async function showDesktopLoginCode(interaction) {
  const entry = desktopLoginCards.get(interaction.customId.slice('desktop_login:'.length));
  if (!entry || entry.expires <= Date.now()) return interaction.editReply('Kod wygasł. Poproś o nowy w aplikacji FivemShop.');
  if (interaction.guildId !== GUILD_ID || interaction.channelId !== DESKTOP_LOGIN_CHANNEL || interaction.message.id !== entry.message.id || interaction.user.id !== entry.id) return interaction.editReply('Ten kod jest przeznaczony wyłącznie dla osoby wskazanej w wiadomości.');
  return interaction.editReply({content:`🔑 Twój kod do FivemShop: **${entry.code}**\nWpisz go w programie Windows. Kod jest jednorazowy i ważny przez 5 minut od wygenerowania.`,allowedMentions:{parse:[]}});
}
function startWebsiteCatalog(guild) {
  const control = createControlApi({secret:DISCORD_TOKEN,
    accounts:{[OWNER_ID]:{name:'OFFWHITE',department:'Projekty i usługi'},[CAR_OWNER_ID]:{name:'Ponczula420',department:'Samochody'}},
    sendCode:(id,code)=>sendDesktopLoginCode(guild,id,code),actions:desktopActions(guild)});
  const server = createServer(async (request, response) => {
    if (await control(request,response)) return;
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'OPTIONS') { response.writeHead(204); return response.end(); }
    if (request.method !== 'GET') { response.writeHead(405); return response.end(JSON.stringify({ error: 'Method not allowed' })); }
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/api/offers') { response.writeHead(410); return response.end(JSON.stringify({error:'Publiczny katalog WWW został wyłączony.'})); }
    if (path === '/health') return response.end(JSON.stringify({ ok: true }));
    if (path !== '/api/offers') { response.writeHead(404); return response.end(JSON.stringify({ error: 'Not found' })); }
    try {
      const data = await loadWebsiteCatalog(guild);
      response.setHeader('Cache-Control', 'public, max-age=30');
      response.end(JSON.stringify(data));
    } catch (error) {
      console.error('Katalog WWW:', error.message);
      response.writeHead(503); response.end(JSON.stringify({ error: 'Katalog jest chwilowo niedostępny' }));
    }
  });
  server.on('error', error => console.error('Katalog WWW — serwer:', error.message));
  server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Katalog WWW: API gotowe.'));
}
const CATEGORY = 'PYKU • ZGŁOSZENIA';
const OFFER_CATEGORY = 'PYKU • TICKETY Z OFERT';
const CAR_CATEGORY = 'FivemShop • SAMOCHODY';
const DM_REASONS = [
  { id: '1', key: 'samochody', label: 'Samochody', emoji: '🚗' },
  { id: '2', key: 'skiny', label: 'Skiny do broni', emoji: '🔫' },
  { id: '3', key: 'mody', label: 'Mody', emoji: '🛠️' },
  { id: '4', key: 'citizeny', label: 'Citizeny', emoji: '🎮' },
  { id: '5', key: 'optymalizacja', label: 'Optymalizacja PC', emoji: '🚀' },
  { id: '6', key: 'ubrania', label: 'Ubrania', emoji: '👕' },
];
const activeTopic = (id, offerId, reason, carOffer = false) => offerId ? `pyku:offer:${id}:${offerId}${carOffer ? ':car' : ''}` : `pyku:open:${id}${reason ? `:${reason.id}` : ''}`;
const activeTicket = topic => /^pyku:(open|offer):(\d+)(?::(\d+))?(?::(car))?$/.exec(topic ?? '');
const isCarTicket = topic => /^pyku:(open|closed):\d+:1$/.test(topic ?? '') || /^pyku:(offer|closedoffer):\d+:\d+:car$/.test(topic ?? '');
const ticketLabel = match => match[1] === 'offer' ? `Oferta ${match[3].slice(-6)}` : DM_REASONS.find(reason => reason.id === match[3])?.label ?? 'Usługi';
function reasonMenu(messageId = 'new',lang='en') {
  return {
    embeds: [new EmbedBuilder().setColor(0xf0ae42).setTitle(lang==='pl'?'📩 FivemShop • W czym możemy pomóc?':'📩 FivemShop • How can we help?')
      .setDescription(lang==='pl'?'Wybierz, w jakiej sprawie piszesz. Twoja wiadomość i załączniki trafią do odpowiedniego zgłoszenia.\n\nAby później wybrać inną sprawę, napisz **menu**.':'Choose a category. Your message and attachments will reach the right team.\n\nType **menu** to start another request or change language.')],
    components: [0, 3].map(start => new ActionRowBuilder().addComponents(DM_REASONS.slice(start, start + 3).map(reason =>
      new ButtonBuilder().setCustomId(`reason:${reason.id}:${messageId}`).setLabel(lang==='pl'?reason.label:reasonEnglish[reason.key]).setEmoji(reason.emoji).setStyle(ButtonStyle.Secondary)))),
  };
}
const userLanguages=new Map(),ticketLanguages=new Map();
const reasonEnglish={samochody:'Cars',skiny:'Weapon skins',mody:'Mods',citizeny:'Citizen packs',optymalizacja:'PC optimisation',ubrania:'FiveM clothing'};
const languageOf=id=>userLanguages.get(id)??'en';
const say=(id,en,pl)=>languageOf(id)==='pl'?pl:en;
const publicTicketLabel=(match,lang)=>lang==='pl'?ticketLabel(match):match[1]==='offer'?`Offer ${match[3].slice(-6)}`:reasonEnglish[DM_REASONS.find(r=>r.id===match[3])?.key]??'Services';
function languageMenu(messageId='new'){
 return {embeds:[new EmbedBuilder().setColor(0xc7a36b).setTitle('🌍 Welcome to FivemShop').setDescription('Choose your support language. Your message and attachments will be kept.\n\nWybierz język obsługi. Twoja wiadomość i załączniki zostaną zachowane.')],components:[new ActionRowBuilder().addComponents(...['en','pl'].map(lang=>new ButtonBuilder().setCustomId(`language:${lang}:${messageId}`).setLabel(lang==='en'?'🇬🇧 English':'🇵🇱 Polski').setStyle(ButtonStyle.Primary)))]};
}
async function internationalizeChannels(guild){
 const names={sportowe:'🏎️・sports-cars',sedan:'🚘・sedans',offroad:'⛰️・off-road','bogate-tune':'🔧・tuned-cars',motocykle:'🏍️・motorcycles',pakiety:'📦・car-packs',suv:'🚙・suv',coupe:'🏁・coupes',muscle:'💪・muscle-cars',supersamochody:'⚡・supercars'};
 const byId=Object.fromEntries(Object.entries(CAR_CHANNELS).map(([key,id])=>[id,names[key]]));
 Object.assign(byId,{[WELCOME_CHANNEL_ID]:'👋・welcome',[MEMBER_WELCOME_CHANNEL_ID]:'🎉・new-members',[VERIFY_CHANNEL_ID]:'✅・verification'});
 const replacements={'regulamin':'rules','otworz-ticket':'open-ticket','otwórz-ticket':'open-ticket','opinie':'reviews','ogloszenia':'announcements','ogłoszenia':'announcements','informacje':'information','skiny-do-broni':'weapon-skins','ubrania':'clothing','optymalizacja':'pc-optimisation','mody-i-citizeny':'mods-and-citizen-packs','oferty':'offers'};
 let renamed=0;
 for(const channel of (await guild.channels.fetch()).values()){
  if(!channel||/^pyku:/.test(channel.topic??'')||[CATEGORY,OFFER_CATEGORY,CAR_CATEGORY].includes(channel.name))continue;
  let name=byId[channel.id];
  if(!name){name=channel.name;for(const [pl,en]of Object.entries(replacements))name=name.replace(new RegExp('(^|[・·丨│ ━-])'+pl+'$','i'),(_,prefix)=>prefix+en);if(channel.type===ChannelType.GuildCategory)name=name.replace(/KATALOG AUT/gi,'CAR CATALOG').replace(/INFORMACJE/gi,'INFORMATION');}
  if(name&&name!==channel.name){try{await channel.setName(name);renamed++;}catch(error){console.error('International channels:',channel.id,error.message);}}
 }
 console.log(`International channels: renamed ${renamed}.`);
}
async function refreshEnglishServicePanels(guild){
 const fieldKeys={'🔫 SKINY DO BRONI':'skiny','🛠️ MODY I CITIZENY':'mody','👕 UBRANIA DO FIVEM':'ubrania','🚀 OPTYMALIZACJA KOMPUTERA':'optymalizacja'};
 let updated=0;
 for(const channel of (await guild.channels.fetch()).values()){
  if(channel?.type!==ChannelType.GuildText||/^pyku:/.test(channel.topic??'')||!channel.permissionsFor(guild.members.me)?.has([P.ViewChannel,P.ReadMessageHistory]))continue;
  try{for(const message of (await channel.messages.fetch({limit:100})).values()){
    const card=message.embeds[0];if(message.author.id!==client.user.id||!['OFERTA • USŁUGI NA ZAMÓWIENIE','CUSTOM SERVICES • FIVEMSHOP'].includes(card?.title)||card?.footer?.text==='P.Y.K.U CREATIVE • Custom projects • Contact through DMs')continue;
    const prices={},descriptions={};for(const field of card.fields){const key=fieldKeys[field.name]??({'🔫 WEAPON SKINS':'skiny','🛠️ MODS & CITIZEN PACKS':'mody','👕 FIVEM CLOTHING':'ubrania','🚀 PC OPTIMISATION':'optymalizacja'})[field.name];if(!key)continue;const parts=field.value.split(/\*\*(?:Cena|Price):\*\*/);if(parts.length===2){prices[key]=parts[1].trim();descriptions[key]=parts[0].trim();}}
    for(const key of Object.keys(descriptions))if(['Customowy wygląd broni do FiveM według Twoich inspiracji.','Gotowe zestawy do RP, pojedyncze customowe mody i citizen pod FPS z dbałością o wygląd gry.','Koszulki, bluzy, spodnie i inne ubrania dla postaci, ekip i organizacji.','Ustawienia pod FPS i płynność. Efekty zależą od sprzętu i konfiguracji.'].includes(descriptions[key]))delete descriptions[key];
    for(const key of Object.keys(prices))for(const [pl,en]of [['Skin ze zdjęciem lub wzorem —','Image or pattern weapon skin —'],['Skin z zawieszką zwisającą po boku, w stylu CS —','Weapon skin with a dangling CS-style charm —'],['Gotowy citizen + mody pod RP —','Ready-to-use RP citizen + mods —'],['Pojedynczy customowy mod —','Individual custom mod —'],['Citizen pod FPS z ładnym wyglądem —','FPS citizen pack with improved visuals —']])prices[key]=prices[key].replace(pl,en);
    await message.edit({embeds:[offer(prices,descriptions)],components:[buttons()],allowedMentions:{parse:[]}});updated++;
  }}catch(error){console.error('English service panels:',channel.id,error.message);}
 }
 console.log(`English service panels: updated ${updated}.`);
}
function verificationPanel(count,lang='en'){
 if(lang==='pl')return polishVerificationPanel(count);
 return {embeds:[new EmbedBuilder().setColor(0xc7a36b).setTitle('✅ Verification • FivemShop').setDescription('Welcome! Read and accept our rules to unlock the server.\n\n**📜 SERVER RULES**\n\n**1. Respect others.** No harassment, threats, discrimination or provocation.\n**2. Keep channels tidy.** No spam, unauthorised advertising or unnecessary mentions.\n**3. Orders.** Contact the bot or use an offer button. Agree on the price, scope and delivery time before work starts.\n**4. Support.** Ponczula420 handles cars; OFFWHITE handles skins, mods, citizen packs, clothing and PC optimisation.\n**5. Safety.** Do not share private data or harmful files. Staff will never ask you to share passwords, tokens or login codes with them.\n**6. Issues.** Use your ticket and avoid duplicate requests.\n**7. Moderation.** Rule violations may lead to a warning, timeout or ban. Discord rules also apply.\n\n**By clicking below, you confirm that you have read and accept these rules.**').addFields({name:'👥 Verified members',value:count===null?'Temporarily unavailable':`**${count}**`})],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(VERIFY_BUTTON_ID).setLabel('Accept rules & verify').setEmoji('✅').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId('rules_pl').setLabel('🇵🇱 Regulamin po polsku').setStyle(ButtonStyle.Secondary))]};
}
const queues = new Map();
function serial(key, task) {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(task);
  queues.set(key, next);
  return next.finally(() => { if (queues.get(key) === next) queues.delete(key); });
}
const priceFields = [
  ['skiny', 'Skiny do broni'], ['mody', 'Mody i citizeny'],
  ['ubrania', 'Ubrania do FiveM'], ['optymalizacja', 'Optymalizacja komputera'],
];
const defaultPrices = {
  skiny: 'Image or pattern weapon skin — 10 zł\nWeapon skin with a dangling CS-style charm — 15 zł',
  mody: 'Ready-to-use RP citizen + mods — 25 zł\nIndividual custom mod — 10 zł\nFPS citizen pack with improved visuals — 20 zł',
  ubrania: '25 zł',
  optymalizacja: '50 zł',
};
const offer = (prices = {}, descriptions = {}) => new EmbedBuilder().setColor(0xa855f7)
  .setAuthor({ name: BRAND }).setTitle('CUSTOM SERVICES • FIVEMSHOP')
  .setDescription('**Your idea. Your style. Made for you.**\nCustom FiveM projects and PC optimisation tailored to your requirements.')
  .addFields(
    { name: '🔫 WEAPON SKINS', value: `${descriptions.skiny || 'Custom FiveM weapon skins based on your references.'}\n**Price:**\n${prices.skiny || defaultPrices.skiny}` },
    { name: '🛠️ MODS & CITIZEN PACKS', value: `${descriptions.mody || 'Ready-to-use RP packs, individual custom mods and FPS citizen packs that keep the game looking good.'}\n**Price:**\n${prices.mody || defaultPrices.mody}` },
    { name: '👕 FIVEM CLOTHING', value: `${descriptions.ubrania || 'T-shirts, hoodies, trousers and other clothing for characters, crews, organisations and businesses.'}\n**Price:**\n${prices.ubrania || defaultPrices.ubrania}` },
    { name: '🚀 PC OPTIMISATION', value: `${descriptions.optymalizacja || 'Settings for FPS and smoother gameplay. Results depend on your hardware and configuration.'}\n**Price:**\n${prices.optymalizacja || defaultPrices.optymalizacja}` },
    { name: '📩 HOW TO ORDER?', value: 'Click **Order a service** and reply to the bot in DMs.\nSend a description, references and your preferred deadline.\nWe confirm the price and scope before starting.' },
  ).setFooter({ text: 'P.Y.K.U CREATIVE • Custom projects • Contact through DMs' });
const buttons = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('order').setLabel('Order a service').setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId('prices').setLabel('Prices').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId('question').setLabel('Ask a question').setStyle(ButtonStyle.Secondary),
);
function withPhotos(command, firstRequired = false) {
  for (let i = 1; i <= 10; i++) command.addAttachmentOption(option => option
    .setName(i === 1 ? 'zdjecie' : `zdjecie_${i}`).setDescription(`Zdjęcie ${i} do galerii`)
    .setRequired(i === 1 && firstRequired));
  return command;
}
function photosFrom(interaction) {
  const photos = [];
  for (let i = 1; i <= 10; i++) {
    const photo = interaction.options.getAttachment(i === 1 ? 'zdjecie' : `zdjecie_${i}`);
    if (!photo) continue;
    if (!/\.(png|jpe?g|gif|webp)$/i.test(photo.name ?? '')) throw new Error('Zdjęcia muszą być PNG, JPG, GIF lub WEBP.');
    photos.push(photo);
  }
  return photos;
}
const contactButton = (reference = 'offer_contact', cars = false) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(reference).setLabel(cars ? 'Ask about this car / order' : 'Ask about this offer / order').setEmoji('📩').setStyle(ButtonStyle.Primary),
);
async function canOperate(userId, guild) {
  if (userId === OWNER_ID || userId === CAR_OWNER_ID) return true;
  const member = await guild.members.fetch(userId);
  return member.roles.cache.has(SUPPORT_ROLE_ID);
}
async function canHandleTicket(userId, guild, topic) {
  if (isCarTicket(topic)) return userId === CAR_OWNER_ID;
  if (userId === CAR_OWNER_ID) return false;
  return canOperate(userId, guild);
}
function imagePayload(photos, first) {
  const embeds = [first];
  const files = photos.map((photo, i) => ({ attachment: photo.url, name: `oferta-${i}.${photo.name.split('.').pop().toLowerCase()}` }));
  photos.forEach((photo, i) => {
    const url = `attachment://${files[i].name}`;
    if (i === 0) first.setImage(url);
    else embeds.push(new EmbedBuilder().setColor(0xa855f7).setImage(url));
  });
  return { embeds, files };
}
const OFFER_PANEL_CHANNEL = '1566745743224737812';
const OFFER_PANEL_MARKER = 'FivemShop • Stały panel ofert v1';
// One public car listing: text, native photo gallery and order button in one container.
const CAR_LABEL_EN={'Sportowe':'Sports cars','Sedan':'Sedans','Offroad':'Off-road','Bogate tune':'Tuned cars','Motocykle':'Motorcycles','Pakiety aut':'Car packs','SUV':'SUV','Coupe':'Coupes','Muscle':'Muscle cars','Supersamochody':'Supercars'};
function offerEmbeds(message) {
  if (message.embeds?.length) return message.embeds;
  const root = message.components?.map(c => c.toJSON?.() ?? c).find(c => c.type === 17 && c.id === 2001);
  if (!root) return [];
  const field = id => root.components.find(c => c.type === 10 && c.id === id)?.content;
  if (!['-# FivemShop • Auta FiveM','-# FivemShop • FiveM Cars'].includes(field(106))) return [];
  const name = field(101)?.replace(/^#{2,3} /, '');
  const description = field(102) ?? '';
  const price = field(103)?.replace(/^(?:\*\*Cena\*\*\n|### )/, '');
  const rawCategory = field(104)?.replace(/^(?:\*\*Kategoria\*\*\n|-# 🏁 FIVEMSHOP · )/, '');
  const category=Object.entries(CAR_LABEL_EN).find(([,en])=>en===rawCategory)?.[0]??rawCategory;
  const rawStatus = field(105)?.replace(/^\*\*Status\*\*\n/, '') ?? 'Dostępne';
  const status=({Sold:'Sprzedane',Withdrawn:'Wycofane',Available:'Dostępne'})[rawStatus]??rawStatus;
  if (!name || !price || !category) return [];
  const images = root.components.filter(c => c.type === 12).flatMap(c => c.items).map(item => {
    const url = item.media?.url;
    if (url?.startsWith('attachment://')) return message.attachments?.find(a => a.name === url.slice(13))?.url ?? item.media?.proxy_url;
    return url;
  }).filter(Boolean);
  const card = { title: name, description, fields: [{ name: '💰 Cena', value: price }, { name: '📂 Kategoria', value: category }, { name: 'Status', value: status }], footer: { text: `${BRAND} • Auta FiveM` } };
  if (images[0]) card.image = { url: images[0] };
  return [card, ...images.slice(1).map(url => ({ image: { url } }))];
}
function carDraftFromMessage(message) {
  const embeds = offerEmbeds(message), card = embeds[0];
  const category = CAR_GROUPS.find(([key, , label]) => card.fields.some(f => f.name === '📂 Kategoria' && [key,label].includes(f.value)))
    ?? CAR_GROUPS.find(([key]) => CAR_CHANNELS[key] === message.channelId);
  return { cars: true, name: card.title, description: card.description ?? '', price: card.fields.find(f => f.name === '💰 Cena')?.value ?? 'Do ustalenia', category: category?.[0], categoryLabel: category?.[2] ?? 'Samochody', status: card.fields.find(f => f.name === 'Status')?.value ?? 'Dostępne',
    photos: embeds.map(e => e.image?.url).filter(Boolean).map((url,i) => ({ url, name: `auto-${i}.${/\.(gif|webp|jpe?g)(?:\?|$)/i.exec(url)?.[1] ?? 'png'}` })) };
}
function carListingPayload(draft, { upload = true } = {}) {
  const status = draft.status ?? 'Dostępne';
  const active = status === 'Dostępne';
  const box = new ContainerBuilder().setId(2001).setAccentColor(active ? 0xc7a36b : 0x777777)
    .addTextDisplayComponents(new TextDisplayBuilder().setId(104).setContent(`-# 🏁 FIVEMSHOP · ${CAR_LABEL_EN[draft.categoryLabel]??draft.categoryLabel}`),
      new TextDisplayBuilder().setId(101).setContent(`## ${draft.name}`),
      new TextDisplayBuilder().setId(103).setContent(`### ${draft.price}`));
  if (!active) box.addTextDisplayComponents(new TextDisplayBuilder().setId(105).setContent(`**Status**\n${({Sprzedane:'Sold',Wycofane:'Withdrawn',Dostępne:'Available'})[status]??status}`));
  box.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  if (draft.description) box.addTextDisplayComponents(new TextDisplayBuilder().setId(102).setContent(draft.description));
  const photos = draft.photos.slice(0,10);
  const files = upload ? photos.map((p,i) => ({ attachment: p.url, name: `auto-${i}.${p.name.split('.').pop().toLowerCase()}` })) : [];
  if (photos.length) box.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(photos.map((p,i) => new MediaGalleryItemBuilder()
    .setURL(upload ? `attachment://${files[i].name}` : p.url).setDescription(`${draft.name} — zdjęcie ${i+1}`.slice(0,1024)))));
  box.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  if (active) box.addActionRowComponents(contactButton('offer_contact', true));
  box.addTextDisplayComponents(new TextDisplayBuilder().setId(106).setContent('-# FivemShop • FiveM Cars'));
  return { components: [box], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] }, ...(upload ? { files } : {}) };
}
async function refreshCarListingLayout(guild) {
  let updated = 0;
  for (const id of Object.values(CAR_CHANNELS)) {
    try {
      const channel = await guild.channels.fetch(id);
      if (channel?.type !== ChannelType.GuildText || !channel.permissionsFor(guild.members.me)?.has([P.ViewChannel,P.ReadMessageHistory,P.SendMessages,P.AttachFiles])) continue;
      const history = await channel.messages.fetch({limit:100});
      for (const message of history.values()) {
        if (!managedCar(message)) continue;
        const container = message.components?.map(c => c.toJSON?.() ?? c).find(c => c.type === 17 && c.id === 2001);
        if (container?.components.some(c=>c.id===106&&c.content==='-# FivemShop • FiveM Cars')) continue;
        const draft = carDraftFromMessage(message);
        draft.photos=draft.photos.map(photo=>{const attached=message.attachments.find(a=>a.url===photo.url);return attached?{...photo,url:`attachment://${attached.name}`}:photo;});
        await message.edit({ ...carListingPayload(draft,{upload:false}), content: null, embeds: [] });
        updated++;
      }
    } catch (error) { console.error('Układ ogłoszeń aut:', id, error.message); }
  }
  console.log(`Układ ogłoszeń aut: odświeżono ${updated} ofert.`);
}

const CAR_CHANNELS = Object.freeze({ sportowe: '1562442778795970682', sedan: '1562442783371825202', offroad: '1562442788107194489', 'bogate-tune': '1562442792771264532', motocykle: '1562488312424304721', pakiety: '1562442797615939594', suv: '1562995799628058624', coupe: '1562995805369925712', muscle: '1562995843680964698', supersamochody: '1562995855466823730' });
function orderedCarGroups(guild) {
  return [...CAR_GROUPS].sort((a,b)=>{
    const position=key=>guild?.channels?.cache?.get(CAR_CHANNELS[key])?.rawPosition;
    const ap=position(a[0]),bp=position(b[0]);
    return (ap??10000+CAR_GROUPS.indexOf(a))-(bp??10000+CAR_GROUPS.indexOf(b));
  });
}
async function saveCarListing(destination,draft,source) {
  const payload=carListingPayload(draft);
  if(!source)return destination.send(payload);
  if(source.channelId===destination.id)return source.edit({...payload,content:null,embeds:[],attachments:[]});
  const sent=await destination.send(payload);
  try{await source.delete();}catch{
    const reverted=await sent.delete().then(()=>true,()=>false);
    throw new Error(reverted?'Nie udało się usunąć oferty z poprzedniego kanału. Przeniesienie cofnięto; dotychczasowa oferta pozostała bez zmian.':`Oferta powstała na nowym kanale (${sent.url}), ale poprzednia wiadomość nadal istnieje. Sprawdź oba kanały przed ponowieniem.`);
  }
  return sent;
}
const canManageCars = userId => [OWNER_ID, CAR_OWNER_ID].includes(userId);
const carChannelMenu = (customId,guild) => new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder('Wybierz katalog samochodów')
  .addOptions(orderedCarGroups(guild).map(([key, , label]) => ({ label, value: CAR_CHANNELS[key] }))));
function managedCar(message) {
  return message?.author?.id === client.user.id && offerEmbeds(message)[0]?.footer?.text === `${BRAND} • Auta FiveM`;
}
async function carOfferSource(interaction, channelId, messageId) {
  if (!Object.values(CAR_CHANNELS).includes(channelId)) throw new Error('To nie jest kanał katalogu samochodów.');
  const channel = await offerDestination(interaction, channelId);
  const message = await channel.messages.fetch(messageId);
  if (!managedCar(message)) throw new Error('Możesz zarządzać tylko ofertami samochodów tego bota.');
  return { channel, message };
}
function carManageView(message, channelId) {
  const status = offerEmbeds(message)[0].fields.find(f => f.name === 'Status')?.value ?? 'Dostępne';
  return { content: `**Zarządzanie samochodem** · <#${channelId}>\n${message.url}\nStatus: **${status}**`, embeds: offerEmbeds(message),
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`offerpanel:caredit:${channelId}:${message.id}`).setLabel('Edytuj ofertę / cenę').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`offerpanel:carstate:${channelId}:${message.id}:sold`).setLabel('Oznacz jako sprzedane').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`offerpanel:carstate:${channelId}:${message.id}:withdrawn`).setLabel('Wycofaj ofertę').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`offerpanel:carstate:${channelId}:${message.id}:active`).setLabel('Przywróć dostępność').setStyle(ButtonStyle.Success))], allowedMentions: { parse: [] } };
}
async function handleCarManagement(interaction) {
  if (!canManageCars(interaction.user.id)) return interaction.reply({ content: 'Panel samochodów jest dostępny dla Ponczula420 i OFFWHITE.', flags: MessageFlags.Ephemeral });
  const [, action, channelId, messageId, state] = interaction.customId.split(':');
  if (action === 'manage') return interaction.reply({ content: '**Oferty samochodów**\nWybierz katalog, a następnie ofertę. Obaj możecie zarządzać samochodami.', components: [carChannelMenu('offerpanel:carlist',interaction.guild)], flags: MessageFlags.Ephemeral });
  if (action === 'carlist' || action === 'carmore') {
    await interaction.deferUpdate();
    const target = action === 'carlist' ? interaction.values[0] : channelId;
    if (!Object.values(CAR_CHANNELS).includes(target)) throw new Error('Nieprawidłowy katalog.');
    const channel = await offerDestination(interaction, target);
    const page = await channel.messages.fetch({ limit: 25, ...(messageId ? { before: messageId } : {}) });
    const found = [...page.values()].filter(managedCar);
    const rows = [carChannelMenu('offerpanel:carlist',interaction.guild)];
    if (found.length) rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`offerpanel:carpick:${target}`).setPlaceholder('Wybierz samochód')
      .addOptions(found.map(m => ({ label: offerEmbeds(m)[0].title.slice(0, 100), description: `${offerEmbeds(m)[0].fields.find(f => f.name === '💰 Cena')?.value ?? 'Cena do ustalenia'} · ${offerEmbeds(m)[0].fields.find(f => f.name === 'Status')?.value ?? 'Dostępne'}`.slice(0, 100), value: m.id })))));
    if (page.size === 25) rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`offerpanel:carmore:${target}:${page.last().id}`).setLabel('Starsze wiadomości / oferty').setStyle(ButtonStyle.Secondary)));
    return interaction.editReply({ content: `**Oferty w <#${target}>**\n${found.length ? 'Wybierz samochód do edycji lub zmiany statusu.' : 'W tej części historii nie ma ofert. Wybierz inny katalog lub starsze wiadomości.'}`, embeds: [], components: rows });
  }
  if (action === 'carpick') {
    await interaction.deferUpdate();
    const { message } = await carOfferSource(interaction, channelId, interaction.values[0]);
    return interaction.editReply(carManageView(message, channelId));
  }
  if (action === 'caredit') {
    const { message, channel } = await carOfferSource(interaction, channelId, messageId);
    const card = offerEmbeds(message)[0];
    if (card.fields.some(f => f.name === 'Status' && f.value !== 'Dostępne')) throw new Error('Najpierw przywróć dostępność oferty, aby ją edytować.');
    const category = CAR_GROUPS.find(([key, , label]) => card.fields.some(f => f.name === '📂 Kategoria' && [key,label].includes(f.value)))
      ?? CAR_GROUPS.find(([key]) => CAR_CHANNELS[key] === channel.id);
    const photos = offerEmbeds(message).map(e => e.image?.url).filter(Boolean).map((url,i) => ({ url, name: `auto-${i}.${/\.(gif|webp|jpe?g)(?:\?|$)/i.exec(url)?.[1] ?? 'png'}` }));
    const draft = { owner: interaction.user.id, guild: interaction.guildId, cars: true, name: card.title, description: card.description ?? '', price: card.fields.find(f => f.name === '💰 Cena')?.value ?? '', category: category[0], categoryLabel: category[2], channel: channel.id, photos, created: Date.now(), busy: false, source: { channel: channel.id, id: message.id, edited: message.editedTimestamp ?? null } };
    cleanOfferDrafts(); offerDrafts.set(interaction.id, draft);
    return interaction.showModal(offerForm(true, interaction.id, draft).setCustomId(`offerpanel:revise:cars:${interaction.id}`));
  }
  if (action === 'carstate' || action === 'carconfirm') {
    if (!['sold','withdrawn','active'].includes(state)) throw new Error('Nieprawidłowy status.');
    await interaction.deferUpdate();
    if (action === 'carstate' && state !== 'active') {
      await carOfferSource(interaction, channelId, messageId);
      return interaction.editReply({ content: `**${state === 'sold' ? 'Oznaczyć samochód jako sprzedany?' : 'Wycofać ofertę z katalogu?'}**\nPrzycisk zamówienia zniknie. Oferta pozostanie na kanale z odpowiednim statusem; możesz ją później przywrócić.`, embeds: [], components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`offerpanel:carconfirm:${channelId}:${messageId}:${state}`).setLabel('Potwierdź zmianę statusu').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`offerpanel:carback:${channelId}:${messageId}`).setLabel('Wróć bez zmian').setStyle(ButtonStyle.Secondary))] });
    }
    return serial(`car-offer:${channelId}:${messageId}`, async () => {
      const { message } = await carOfferSource(interaction, channelId, messageId);
      const draft = carDraftFromMessage(message);
      draft.status = state === 'sold' ? 'Sprzedane' : state === 'withdrawn' ? 'Wycofane' : 'Dostępne';
      const updated = await message.edit({ ...carListingPayload(draft), content: null, embeds: [], attachments: [] });
      webCatalog.expires = 0;
      return interaction.editReply(carManageView(updated, channelId));
    });
  }
  if (action === 'carback') {
    await interaction.deferUpdate();
    const { message } = await carOfferSource(interaction, channelId, messageId);
    return interaction.editReply(carManageView(message, channelId));
  }
}

const offerDrafts = new Map();
const draftLifetime = 15 * 60_000;
function cleanOfferDrafts() {
  for (const [id, draft] of offerDrafts) if (Date.now() - draft.created > draftLifetime) offerDrafts.delete(id);
}
setInterval(cleanOfferDrafts, 60_000).unref();
const serviceGroups = [['skiny', 'Skiny do broni'], ['mody', 'Mody'], ['citizeny', 'Citizeny'], ['ubrania', 'Ubrania'], ['optymalizacja', 'Optymalizacja PC']];
function offerForm(cars, id, draft = null) {
  const text = (key, label, max, paragraph = false) => {
    const input = new TextInputBuilder().setCustomId(key).setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short).setMaxLength(max).setRequired(true);
    const value = draft?.[key === 'name' ? 'name' : key === 'price' ? 'price' : 'description'];
    if (value) input.setValue(value);
    return new LabelBuilder().setLabel(label).setTextInputComponent(input);
  };
  return new ModalBuilder().setCustomId(`offerpanel:form:${cars ? 'cars' : 'services'}:${id}`).setTitle(cars ? 'Dodaj samochód' : 'Dodaj ofertę usługi')
    .addLabelComponents(text('name', 'Nazwa oferty', 150), text('description', 'Opis', 3000, true), text('price', 'Cena, np. 35 zł', 150),
      new LabelBuilder().setLabel('Kategoria').setStringSelectMenuComponent(new StringSelectMenuBuilder().setCustomId('category').setMinValues(1).setMaxValues(1)
        .addOptions((cars ? orderedCarGroups(client.guilds?.cache?.get(GUILD_ID)).map(([value, , label]) => ({ label, value, ...(draft?.category === value ? { default: true } : {}) })) : serviceGroups.map(([value, label]) => ({ label, value }))))),
      new LabelBuilder().setLabel(draft ? 'Nowe zdjęcia (opcjonalnie)' : 'Zdjęcia (od 1 do 10)').setDescription(draft ? 'Zostaw puste, aby zachować zdjęcia. Dodane pliki zastąpią galerię.' : 'PNG, JPG, GIF lub WEBP').setFileUploadComponent(
        new FileUploadBuilder().setCustomId('photos').setMinValues(draft ? 0 : 1).setMaxValues(10).setRequired(!draft)));
}
function draftCard(draft) {
  return new EmbedBuilder().setColor(0xc7a36b).setAuthor({ name: BRAND }).setTitle(draft.name).setDescription(draft.description)
    .addFields({ name: '💰 Cena', value: draft.price }, { name: '📂 Kategoria', value: draft.categoryLabel },
      { name: '📩 Kontakt i zamówienia', value: 'Kliknij przycisk poniżej — porozmawiamy prywatnie przez bota.' })
    .setFooter({ text: `${BRAND} • ${draft.cars ? 'Auta FiveM' : 'Oferta FiveM'}` });
}
function draftView(draft, id) {
  const embeds = [draftCard(draft).setImage(draft.photos[0].url), ...draft.photos.slice(1).map(p => new EmbedBuilder().setImage(p.url))];
  const controls = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`offerpanel:publish:${id}`).setLabel(draft.source ? 'Zapisz zmiany w ofercie' : 'Opublikuj ofertę').setStyle(ButtonStyle.Success).setDisabled(!draft.channel));
  if (draft.cars) {
    if (!draft.source) controls.addComponents(new ButtonBuilder().setCustomId(`offerpanel:publishnext:${id}`).setLabel('Opublikuj i dodaj kolejną').setStyle(ButtonStyle.Primary).setDisabled(!draft.channel));
    controls.addComponents(new ButtonBuilder().setCustomId(`offerpanel:edit:${id}`).setLabel('Popraw ofertę').setStyle(ButtonStyle.Secondary));
  }
  controls.addComponents(new ButtonBuilder().setCustomId(`offerpanel:cancel:${id}`).setLabel('Anuluj szkic').setStyle(ButtonStyle.Secondary));
  const channelRow = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(`offerpanel:channel:${id}`)
    .setPlaceholder('Wybierz kanał publikacji').setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1).setDisabled(Boolean(draft.source)));
  return { content: `**Podgląd — ${draft.source ? 'zmiany nie zostały jeszcze zapisane' : 'oferta nie została jeszcze wysłana'}.**\nKategoria: **${draft.categoryLabel}**\nKanał publikacji: ${draft.channel ? `<#${draft.channel}>` : '**wybierz poniżej**'}\nZdjęć: ${draft.photos.length} • szkic ważny przez 15 minut.`, embeds,
    components: [channelRow, controls], allowedMentions: { parse: [] } };
}
async function publishOfferPanel(guild) {
  const channel = await guild.channels.fetch(OFFER_PANEL_CHANNEL);
  if (channel?.type !== ChannelType.GuildText) throw new Error('Kanał stałego panelu ofert nie jest kanałem tekstowym.');
  const history = await channel.messages.fetch({ limit: 100 });
  const existing = history.find(m => m.author.id === client.user.id && m.embeds[0]?.footer?.text === OFFER_PANEL_MARKER);
  const payload = { embeds: [new EmbedBuilder().setColor(0xc7a36b).setTitle('FivemShop • Panel samochodów')
    .setDescription('Dodawaj samochody, poprawiaj oferty i zarządzaj dostępnością.\n\n**Nowa oferta** — nazwa, opis, cena, kategoria i do 10 zdjęć. Kanał podpowie się automatycznie.\n**Oferty samochodów** — edycja opisu, ceny i galerii, oznaczanie jako sprzedane lub wycofanie z możliwością przywrócenia.\n\nDostęp: **Ponczula420 i OFFWHITE**. Podgląd i przyciski zarządzania widzi tylko osoba korzystająca z panelu.').setFooter({ text: OFFER_PANEL_MARKER })],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('offerpanel:new:cars').setLabel('Dodaj samochód').setEmoji('🚗').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('offerpanel:manage').setLabel('Oferty samochodów').setStyle(ButtonStyle.Secondary))], allowedMentions: { parse: [] } };
  const sent = existing ? await existing.edit(payload) : await channel.send(payload);
  console.log(`Stały panel ofert gotowy: ${sent.url}`);
  return sent;
}
async function offerDestination(interaction, id) {
  const channel = await interaction.guild.channels.fetch(id);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (channel?.type !== ChannelType.GuildText || /^pyku:/.test(channel.topic ?? '')) throw new Error('Wybierz zwykły kanał ofert, a nie kanał ticketa.');
  if (channel.id === OFFER_PANEL_CHANNEL) throw new Error('Wybierz kanał katalogu, a nie kanał tego panelu.');
  if (!channel.permissionsFor(member)?.has([P.ViewChannel, P.SendMessages])) throw new Error('Nie masz uprawnień do publikacji na tym kanale.');
  if (!channel.permissionsFor(interaction.guild.members.me)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles])) throw new Error('Bot potrzebuje na tym kanale uprawnień do wysyłania wiadomości, linków i załączników.');
  return channel;
}
async function handleOfferPanel(interaction) {
  if (interaction.guildId !== GUILD_ID || !await canOperate(interaction.user.id, interaction.guild)) {
    return interaction.reply({ content: 'Panel jest dostępny wyłącznie dla obsługi FivemShop.', flags: MessageFlags.Ephemeral });
  }
  const [, action, id, nonce] = interaction.customId.split(':');
  if (action === 'manage' || action.startsWith('car')) return handleCarManagement(interaction);
  if (action === 'new') {
    const cars = id === 'cars';
    if ((cars && !canManageCars(interaction.user.id)) || (!cars && interaction.user.id === CAR_OWNER_ID)) {
      return interaction.reply({ content: cars ? 'Panel samochodów jest dostępny dla Ponczula420 i OFFWHITE.' : 'Ten dział jest przeznaczony dla OFFWHITE i obsługi usług.', flags: MessageFlags.Ephemeral });
    }
    return interaction.showModal(offerForm(cars, interaction.id));
  }
  if (action === 'form' || action === 'revise') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const cars = id === 'cars';
    if ((cars && !canManageCars(interaction.user.id)) || (!cars && interaction.user.id === CAR_OWNER_ID)) throw new Error('Nie masz dostępu do tego działu.');
    const name = interaction.fields.getTextInputValue('name').trim();
    const description = interaction.fields.getTextInputValue('description').trim();
    const price = interaction.fields.getTextInputValue('price').trim();
    const category = interaction.fields.getStringSelectValues('category')[0];
    const categoryLabel = cars ? CAR_GROUPS.find(([key]) => key === category)?.[2] : serviceGroups.find(([key]) => key === category)?.[1];
    const previous = action === 'revise' ? offerDrafts.get(nonce) : null;
    if (action === 'revise' && (!previous || previous.owner !== interaction.user.id || previous.guild !== interaction.guildId || previous.busy || Date.now() - previous.created > draftLifetime)) throw new Error('Szkic wygasł lub jest już wysyłany.');
    const uploaded = [...(interaction.fields.getUploadedFiles('photos')?.values() ?? [])];
    const photos = uploaded.length ? uploaded : previous?.photos ?? [];
    if (!name || !description || !price || !categoryLabel || !photos.length || photos.length > 10) throw new Error('Uzupełnij wszystkie pola i dodaj od 1 do 10 zdjęć.');
    if (photos.some(p => !/\.(png|jpe?g|gif|webp)$/i.test(p.name ?? '') || (p.contentType && !/^image\//.test(p.contentType)))) throw new Error('Dodaj wyłącznie zdjęcia PNG, JPG, GIF lub WEBP.');
    if (photos.some(p => p.size > (interaction.guild.maximumUploadLimit ?? 10 * 1024 * 1024))) throw new Error('Zdjęcie przekracza limit załącznika tego serwera. Zmniejsz je i otwórz formularz ponownie.');
    cleanOfferDrafts();
    for (const [key, draft] of offerDrafts) if (draft.owner === interaction.user.id && !draft.busy) offerDrafts.delete(key);
    const draft = { owner: interaction.user.id, guild: interaction.guildId, created: Date.now(), cars, name, description, price, category, categoryLabel, photos, busy: false, ...(previous?.source ? {source: previous.source} : {}) };
    if (cars) {
      draft.channel = previous && previous.category === category ? previous.channel : CAR_CHANNELS[category];
      try { await offerDestination(interaction, draft.channel); } catch { draft.channel = undefined; }
    }
    offerDrafts.set(nonce, draft);
    return interaction.editReply(draftView(draft, nonce));
  }
  const draft = offerDrafts.get(id);
  if (!draft || draft.owner !== interaction.user.id || draft.guild !== interaction.guildId || Date.now() - draft.created > draftLifetime) {
    return interaction.reply({ content: 'Szkic wygasł albo bot został zrestartowany. Kliknij „Dodaj samochód” lub „Dodaj usługę” w stałym panelu.', flags: MessageFlags.Ephemeral });
  }
  if (draft.busy) return interaction.reply({ content: 'Ta oferta jest już wysyłana. Sprawdź wybrany kanał.', flags: MessageFlags.Ephemeral });
  if (action === 'edit') {
    if (!draft.cars || !canManageCars(interaction.user.id)) throw new Error('Brak dostępu do panelu samochodów.');
    return interaction.showModal(offerForm(true, id, draft).setCustomId(`offerpanel:revise:cars:${id}`));
  }
  if (action === 'cancel') {
    offerDrafts.delete(id);
    return interaction.update({ content: 'Szkic anulowany. Możesz dodać kolejną ofertę ze stałego panelu.', embeds: [], components: [] });
  }
  if (action === 'channel') {
    await interaction.deferUpdate();
    if (draft.source) throw new Error('Zmieniasz ofertę w jej obecnym kanale.');
    await offerDestination(interaction, interaction.values[0]);
    draft.channel = interaction.values[0];
    return interaction.editReply(draftView(draft, id));
  }
  if (action === 'publish' || (action === 'publishnext' && draft.cars && !draft.source)) {
    draft.busy = true;
    await interaction.deferUpdate();
    let destination;
    try { destination = await offerDestination(interaction, draft.channel); }
    catch (error) { draft.busy = false; throw error; }
    let sent;
    if (draft.source) {
      sent = await serial(`car-offer:${draft.source.channel}:${draft.source.id}`, async () => {
        const { message } = await carOfferSource(interaction, draft.source.channel, draft.source.id);
        if ((message.editedTimestamp ?? null) !== draft.source.edited) { draft.busy = false; throw new Error('Oferta została zmieniona przez inną osobę. Otwórz jej aktualną wersję w panelu.'); }
        return saveCarListing(destination,draft,message).catch(error=>{draft.busy=false;throw error;});
      });
    } else sent = await destination.send(draft.cars ? carListingPayload(draft) : { ...imagePayload(draft.photos, draftCard(draft)), components: [contactButton('offer_contact', false)], allowedMentions: { parse: [] } });
    offerDrafts.delete(id); webCatalog.expires = 0;
    return interaction.editReply({ content: `✅ ${draft.source ? 'Zmiany zapisane' : 'Oferta opublikowana'}: ${sent.url}\nID do komendy /zdjecia: ${sent.id}`, embeds: [],
      components: draft.cars ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('offerpanel:new:cars').setLabel(action === 'publishnext' ? 'Dodaj kolejne auto' : 'Dodaj samochód').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId('offerpanel:manage').setLabel('Zarządzaj samochodami').setStyle(ButtonStyle.Secondary))] : [] });
  }
}

const commands = [
  new SlashCommandBuilder().setName('bumpy').setDescription('Licznik podbić DISBOARD, ranking i czas następnego podbicia'),
  withPhotos(new SlashCommandBuilder().setName('oferty').setDescription('Oferty samochodów — komenda opiekuna aut')
    .addStringOption(o => o.setName('nazwa').setDescription('Nazwa samochodu').setRequired(true).setMaxLength(150))
    .addStringOption(o => o.setName('opis').setDescription('Opis auta').setRequired(true).setMaxLength(3000))
    .addStringOption(o => o.setName('cena').setDescription('Cena z walutą').setRequired(true).setMaxLength(150))
    .addStringOption(o => o.setName('kategoria').setDescription('Katalog auta na Discordzie i stronie').setRequired(true)
      .addChoices(...CAR_GROUPS.map(([value, , name]) => ({ name, value })))))
    .addChannelOption(o => o.setName('kanal').setDescription('Istniejący kanał ofert samochodów').addChannelTypes(ChannelType.GuildText)),
  new SlashCommandBuilder().setName('weryfikacja').setDescription('Opublikuj lub odśwież panel weryfikacji FivemShop'),
  withPhotos(new SlashCommandBuilder().setName('oferta').setDescription('Opublikuj ofertę z opisem, ceną i galerią')
    .addStringOption(o => o.setName('nazwa').setDescription('Nazwa oferty').setRequired(true).setMinLength(1).setMaxLength(150))
    .addStringOption(o => o.setName('opis').setDescription('Opis; wpisz \\n aby zacząć nową linię').setRequired(true).setMaxLength(3000))
    .addStringOption(o => o.setName('cena').setDescription('Cena z walutą, np. 25 zł').setRequired(true).setMaxLength(150)))
    .addStringOption(o => o.setName('dzial').setDescription('Rodzaj oferty').addChoices({ name: 'Auta', value: 'auta' }, { name: 'Usługi i inne', value: 'uslugi' }))
    .addChannelOption(o => o.setName('kanal').setDescription('Gdzie opublikować ofertę').addChannelTypes(ChannelType.GuildText)),
  withPhotos(new SlashCommandBuilder().setName('zdjecia').setDescription('Dodaj kolejne zdjęcia do opublikowanej oferty')
    .addStringOption(o => o.setName('oferta_id').setDescription('ID wiadomości oferty; prawy przycisk → Kopiuj ID wiadomości').setRequired(true)), true),
  priceFields.reduce((command, [key, label]) => command.addStringOption(option => option
    .setName(key).setDescription(`Cena: ${label}, np. od 50 zł / wycena indywidualna`).setMaxLength(150))
    .addStringOption(option => option.setName(`opis_${key}`).setDescription(`Własny opis: ${label}`).setMaxLength(700)),
    new SlashCommandBuilder().setName('panel').setDescription('Opublikuj ofertę i wpisz własne ceny')
      .addChannelOption(option => option.setName('kanal').setDescription('Kanał publikacji oferty').addChannelTypes(ChannelType.GuildText))),
  new SlashCommandBuilder().setName('odpowiedz').setDescription('Wyślij odpowiedź klientowi z kanału zgłoszenia')
    .addStringOption(o => o.setName('tresc').setDescription('Wiadomość do klienta').setMaxLength(1800))
    .addAttachmentOption(o => o.setName('plik').setDescription('Opcjonalny załącznik')),
  new SlashCommandBuilder().setName('zamknij').setDescription('Zamknij zgłoszenie i zachowaj kanał jako archiwum'),
].map(c => c.toJSON());

async function guildAndChannels() {
  const guild = await client.guilds.fetch(GUILD_ID);
  return { guild, channels: await guild.channels.fetch() };
}
function isSuccessfulBump(message) {
  if (message.channelId !== BUMP_CHANNEL_ID || message.author?.id !== DISBOARD_ID) return false;
  const text = [message.content, ...message.embeds.flatMap(embed => [embed.title, embed.description])].filter(Boolean).join('\n');
  return /podbi(?:to|łeś) serwer|bump done|server bumped/i.test(text);
}
function bumpWaitMs(message) {
  if (message.channelId !== BUMP_CHANNEL_ID || message.author?.id !== DISBOARD_ID) return null;
  const text = [message.content, ...message.embeds.flatMap(embed => [embed.title, embed.description])].filter(Boolean).join('\n');
  // Only the actual cooldown line, never the DISBOARD Pro advertisement below it.
  const line = text.match(/(?:poczekaj jeszcze|please wait(?: another)?)\s+([^\n]+)/i)?.[1]?.split(/przed|before/i)[0];
  if (!line) return null;
  let duration = 0, matched = false;
  for (const part of line.matchAll(/(\d+)\s*(godz(?:in(?:y|ę|a)?)?\.?|hours?|hrs?|h\b|min(?:ut(?:y|ę|a)?)?\.?|minutes?|mins?|m\b|sek(?:und(?:y|ę|a)?)?\.?|seconds?|secs?|s\b)/gi)) {
    matched = true;
    const unit = part[2].toLowerCase();
    duration += Number(part[1]) * (/^(godz|hour|hr|h$)/.test(unit) ? 3_600_000 : /^(min|m$)/.test(unit) ? 60_000 : 1000);
  }
  return matched ? duration : null;
}
function bumpStatsEmbed() {
  const ranking = new Map();
  for (const record of bumpState.successes.values()) if (record.userId) ranking.set(record.userId, (ranking.get(record.userId) ?? 0) + 1);
  const top = [...ranking].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const unknown = [...bumpState.successes.values()].filter(record => !record.userId).length;
  return new EmbedBuilder().setColor(0xf0ae42).setTitle('📊 FivemShop • Podbicia DISBOARD')
    .addFields({ name: '✅ Udane podbicia', value: `**${bumpState.successes.size}**`, inline: true },
      { name: '⏱️ Następne podbicie', value: bumpState.nextAt > Date.now() ? `<t:${Math.ceil(bumpState.nextAt / 1000)}:R>` : 'Można spróbować teraz', inline: true },
      { name: '🏆 Ranking', value: top.length ? top.map(([id, count], i) => `**${i + 1}.** <@${id}> — **${count}**`).join('\n') : 'Brak rozpoznanych autorów podbić.' })
    .setFooter({ text: `Na podstawie dostępnej historii kanału${unknown ? ` • Bez rozpoznanego autora: ${unknown}` : ''}` });
}
function isBumpReminder(message) {
  return message.author?.id === client.user.id && message.embeds.some(embed => embed.footer?.text === BUMP_MARKER);
}
async function checkBumpReminder(guild) {
  const channel = await guild.channels.fetch(BUMP_CHANNEL_ID);
  if (channel?.type !== ChannelType.GuildText) throw new Error('Nie znaleziono kanału przypomnień bump.');
  if (!bumpState.ready) {
    let before;
    while (true) {
      const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      for (const message of page.values()) {
        observeBump(message, false);
        if (isBumpReminder(message)) {
          bumpState.reminders.add(message.id);
          bumpState.lastReminder = Math.max(bumpState.lastReminder, message.createdTimestamp);
        }
      }
      if (page.size < 100) break;
      before = page.last().id;
    }
    bumpState.ready = true;
    console.log(`Bump FivemShop: odczytano historię; ostatni bump ${bumpState.lastBump || 'brak'}.`);
  }
  const now = Date.now();
  if (now < bumpState.nextAt || now < bumpState.lastReminder + BUMP_REPEAT) return;
  for (const id of bumpState.reminders) {
    try {
      const previous = await channel.messages.fetch(id);
      if (isBumpReminder(previous)) await previous.delete();
    } catch (error) { if (error.code !== 10008) throw error; }
    bumpState.reminders.delete(id);
  }
  const sent = await channel.send({
    content: `<@${OWNER_ID}> <@${CAR_OWNER_ID}>`,
    embeds: [new EmbedBuilder().setColor(0xf0ae42).setTitle('🔔 Czas na /bump!')
      .setDescription(`Podbijcie **FivemShop** na DISBOARD!\nWpiszcie na tym kanale **/bump** i wybierzcie komendę bota **DISBOARD**.\n\nWystarczy, że zrobi to jedna osoba. Czas kolejnego przypomnienia dostosuję do odpowiedzi DISBOARD.\n\n✅ Udane podbicia: **${bumpState.successes.size}** • Ranking: **/bumpy**`)
      .setFooter({ text: BUMP_MARKER })],
    allowedMentions: { parse: [], users: [OWNER_ID, CAR_OWNER_ID] },
  });
  bumpState.reminders.add(sent.id);
  bumpState.lastReminder = sent.createdTimestamp;
  console.log(`Bump FivemShop: przypomnienie wysłane ${sent.id}; oznaczono obu opiekunów.`);
}
function observeBump(message, log = true) {
  if (message.channelId !== BUMP_CHANNEL_ID || message.author?.id !== DISBOARD_ID) return;
  const success = isSuccessfulBump(message);
  const wait = success ? null : bumpWaitMs(message);
  if (!success && wait === null) return;
  const timestamp = message.editedTimestamp ?? message.createdTimestamp;
  if (success) {
    const userId = message.interactionMetadata?.user?.id ?? message.interaction?.user?.id ?? message.mentions?.users?.first()?.id ?? bumpState.successes.get(message.id)?.userId;
    bumpState.successes.set(message.id, { userId, timestamp: message.createdTimestamp });
    bumpState.lastBump = Math.max(bumpState.lastBump, message.createdTimestamp);
  }
  if (timestamp >= bumpState.lastSignalAt) {
    bumpState.lastSignalAt = timestamp;
    bumpState.nextAt = timestamp + (success ? BUMP_COOLDOWN : wait + 5000);
  }
  if (log) console.log(`Bump FivemShop: ${success ? `udane podbicie; razem ${bumpState.successes.size}` : `czas oczekiwania ${Math.ceil(wait / 60000)} min`} • ${message.id}.`);
}
function polishVerificationPanel(count) {
  return {
    embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle('✅ Weryfikacja • FivemShop')
      .setDescription([
        'Witaj! Przeczytaj regulamin i zaakceptuj go, aby uzyskać dostęp do serwera.',
        '',
        '**📜 REGULAMIN FivemShop**',
        '',
        '**1. 🤝 Szacunek** — bez wyzwisk, gróźb, dyskryminacji i prowokacji.',
        '',
        '**2. 💬 Porządek** — bez spamu, reklam bez zgody i zbędnego oznaczania obsługi.',
        '',
        '**3. 🛒 Zamówienia** — przez DM do bota. Cenę, zakres i termin ustalamy przed realizacją.',
        '',
        '**4. 🚗 Obsługa** — samochody: <@317932984663539723>. Pozostałe usługi: <@795755381744861184> i uprawniona obsługa.',
        '',
        '**5. 🔒 Bezpieczeństwo** — nie udostępniaj cudzych danych ani szkodliwych plików. Obsługa nie prosi o hasła, tokeny ani kody logowania.',
        '',
        '**6. 🛠️ Problemy** — zgłaszaj w tickecie. Nie otwieraj kilku zgłoszeń w tej samej sprawie.',
        '',
        '**7. ⚖️ Moderacja** — naruszenia mogą skutkować ostrzeżeniem, wyciszeniem lub banem. Obowiązują też zasady Discorda.',
        '',
        '**Klikając poniżej, potwierdzasz zapoznanie się z regulaminem i jego akceptację.**',
      ].join('\n'))
      .addFields({ name: '👥 Zweryfikowane osoby', value: count === null ? 'Licznik chwilowo niedostępny' : `**${count}**`, inline: false })],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder()
      .setCustomId(VERIFY_BUTTON_ID).setLabel('Akceptuję regulamin i weryfikuję się').setEmoji('✅').setStyle(ButtonStyle.Success))],
  };
}
async function verificationRole(guild) {
  const role = await guild.roles.fetch(VERIFY_ROLE_ID);
  const me = await guild.members.fetchMe();
  if (!role || role.managed || role.id === guild.id) throw new Error('Nie znaleziono zwykłej rangi weryfikacji.');
  if (!me.permissions.has(P.ManageRoles) || !role.editable) {
    throw new Error('Bot potrzebuje uprawnienia Zarządzanie rolami i swojej rangi powyżej rangi weryfikacji.');
  }
  return role;
}
async function publishWelcome(guild) {
  const channel = await guild.channels.fetch(WELCOME_CHANNEL_ID);
  if (channel?.type !== ChannelType.GuildText) throw new Error('Nie znaleziono kanału powitania.');
  const marker = 'FivemShop • Welcome';
  const payload = { embeds: [new EmbedBuilder().setColor(0xf0ae42).setTitle('👋 Welcome to FivemShop!')
    .setDescription([
      '**Everything you need to give your FiveM a style of its own.**',
      '',
      '🚗 **Cars** — sports, luxury, off-road and tuned vehicles.',
      '🔫 **Weapon skins** — your own images, patterns and charms.',
      '🛠️ **Mods & citizen packs** — for RP, FPS and game visuals.',
      '👕 **Clothing** — for your character, crew, organisation or business.',
      '🚀 **PC optimisation** — for smoother gameplay.',
      '',
      '**📩 Questions & orders**',
      'Click an offer button or DM the bot. Choose English or Polish, then a category — your ticket will reach the right person.',
      '',
      '💰 Agree on the price, scope and delivery time with staff before placing an order.',
      '',
      '**Make yourself at home and find your next upgrade! 🖤**',
    ].join('\n')).setFooter({ text: marker })] };
  let before;
  while (true) {
    const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    const existing = page.find(message => message.author.id === client.user.id
      && message.embeds.some(embed => [marker,'FivemShop • Powitanie'].includes(embed.footer?.text)));
    if (existing) {
      await existing.edit(payload);
      console.log(`Powitanie FivemShop: wiadomość gotowa ${existing.id}`);
      return existing;
    }
    if (page.size < 100) break;
    before = page.last().id;
  }
  const sent = await channel.send(payload);
  console.log(`Powitanie FivemShop: opublikowano ${sent.id}`);
  return sent;
}
async function publishVerification(guild) {
  const channel = await guild.channels.fetch(VERIFY_CHANNEL_ID);
  if (channel?.type !== ChannelType.GuildText) throw new Error('Kanał weryfikacji nie jest kanałem tekstowym na tym serwerze.');
  let count = null;
  try {
    const counts = await client.rest.get(`/guilds/${guild.id}/roles/member-counts`);
    count = counts[VERIFY_ROLE_ID] ?? 0;
    if (!Number.isInteger(count) || count < 0) throw new Error('Nieprawidłowy wynik licznika rangi.');
  } catch (error) { count = null; console.error('Weryfikacja FivemShop — licznik:', error.message); }
  const payload = verificationPanel(count);
  if (verificationMessageId) {
    const existing = await channel.messages.fetch(verificationMessageId).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      return existing;
    }
    verificationMessageId = undefined;
  }
  // Search the channel history so a restart never creates another panel.
  let before;
  while (true) {
    const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    const existing = page.find(message => message.author.id === client.user.id && message.components.some(row =>
      row.components.some(component => [VERIFY_BUTTON_ID, 'fivemshop_verify'].includes(component.customId))));
    if (existing) {
      await existing.edit(payload);
      verificationMessageId = existing.id;
      console.log(`Weryfikacja FivemShop: licznik ${count ?? 'niedostępny'}`);
      console.log(`Weryfikacja FivemShop: panel gotowy ${existing.id}`);
      return existing;
    }
    if (page.size < 100) break;
    before = page.last().id;
  }
  const sent = await channel.send(payload);
  verificationMessageId = sent.id;
  console.log(`Weryfikacja FivemShop: panel opublikowany ${sent.id}`);
  return sent;
}
function privateOverwrites(guild, cars = false) {
  return [
    { id: guild.id, deny: [P.ViewChannel] },
    { id: cars ? CAR_OWNER_ID : OWNER_ID, type: 1, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.UseApplicationCommands] },
    ...(cars ? [] : [{ id: SUPPORT_ROLE_ID, type: 0, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.UseApplicationCommands] }]),
    { id: client.user.id, type: 1, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels, P.AttachFiles, P.EmbedLinks] },
  ];
}
const TICKET_PANEL_MARKER='FivemShop • Panel zgłoszenia';
const CUSTOMER_MESSAGE_MARKER='FivemShop • Wiadomość klienta';
function ticketPanelPayload(channel,user,topic=channel.topic) {
  const match=activeTicket(topic),closed=!match;
  const info=match??activeTicket(topic.replace(/^pyku:closedoffer:/,'pyku:offer:').replace(/^pyku:closed:/,'pyku:open:'));
  const owner=isCarTicket(topic)?CAR_OWNER_ID:OWNER_ID;
  const card=new EmbedBuilder().setColor(closed?0x777777:0xc7a36b).setTitle(closed?'🔒 Zgłoszenie zamknięte':'💬 Centrum obsługi • FivemShop')
    .setDescription('Odpowiedzi i załączniki wysłane przez obsługę na tym kanale trafiają do klienta na DM. Historia rozmowy pozostaje w tickecie.')
    .addFields({name:'👤 Klient',value:`${user.globalName??user.username}\n<@${user.id}> · \`${user.id}\``,inline:false},
      {name:'📂 Sprawa',value:info?ticketLabel(info):'Zgłoszenie',inline:true},
      {name:'🛠️ Opiekun',value:`<@${owner}>`,inline:true},
      {name:'Status',value:closed?'Zamknięte · archiwum':'Otwarte',inline:true},{name:'🌍 Język / Language',value:(ticketLanguages.get(channel.id)??'en')==='pl'?'Polski · PL':'English · EN',inline:true}).setFooter({text:TICKET_PANEL_MARKER});
  return {embeds:[card],content:null,components:closed?[]:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('Zamknij ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger))],allowedMentions:{parse:[]}};
}
async function ensureTicketPanel(channel,user) {
  const info=activeTicket(channel.topic)??activeTicket(channel.topic.replace(/^pyku:closedoffer:/,'pyku:offer:').replace(/^pyku:closed:/,'pyku:open:'));
  if(!info)return;
  user??=await client.users.fetch(info[2]);
  const messages=await channel.messages.fetch({limit:100});
  const existing=messages.find(m=>m.author.id===client.user.id&&(m.embeds[0]?.footer?.text===TICKET_PANEL_MARKER||m.content?.startsWith('Nowe zgłoszenie:')));
  const savedLanguage=existing?.embeds[0]?.fields?.find(f=>f.name==='🌍 Język / Language')?.value;if(savedLanguage){const lang=savedLanguage.includes('PL')?'pl':'en';ticketLanguages.set(channel.id,lang);if(!userLanguages.has(info[2]))userLanguages.set(info[2],lang);}
  const payload=ticketPanelPayload(channel,user);
  return existing?existing.edit(payload):channel.send(payload);
}
async function closeTicket(channel,actorId,actorName) {
  const match=activeTicket(channel.topic);
  if(!match)throw new Error('Zgłoszenie jest już zamknięte.');
  if(!await canHandleTicket(actorId,channel.guild,channel.topic))throw Object.assign(new Error('Nie masz dostępu do tej rozmowy.'),{status:403});
  const user=await client.users.fetch(match[2]);
  await channel.setTopic(channel.topic.replace(/^pyku:(open|offer):/,`pyku:${match[1]==='offer'?'closedoffer':'closed'}:`));
  await channel.setName(`zamkniety-${channel.id}`);
  await channel.send({content:`🔒 Zgłoszenie zamknął **${actorName}**. Historia została zachowana w archiwum.`,allowedMentions:{parse:[]}});
  try{await ensureTicketPanel(channel,user);}catch(error){console.error('Odświeżenie panelu zamknięcia:',error.message);}
  const notified=await user.send((ticketLanguages.get(channel.id)??'en')==='pl'?'FivemShop: zgłoszenie zostało zamknięte. Napisz ponownie do bota, jeśli potrzebujesz pomocy.':'FivemShop: your ticket has been closed. Send the bot a new message if you need help again.').then(()=>true,()=>false);
  return {closed:true,notified};
}
async function handleTicketCloseButton(interaction) {
  const channel=await interaction.guild.channels.fetch(interaction.channelId);
  if(!activeTicket(channel?.topic))return interaction.editReply({content:'Ten ticket jest już zamknięty.',components:[]});
  if(!await canHandleTicket(interaction.user.id,interaction.guild,channel.topic))return interaction.editReply('To zgłoszenie należy do drugiego opiekuna.');
  if(interaction.customId==='ticket_close_cancel')return interaction.editReply({content:'Anulowano zamknięcie. Rozmowa pozostaje otwarta.',components:[]});
  if(interaction.customId==='ticket_close')return interaction.editReply({content:'**Zamknąć ten ticket?**\nRozmowa trafi do archiwum, a klient otrzyma powiadomienie. Historia zostanie zachowana.',components:[new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close_confirm').setLabel('Tak, zamknij ticket').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket_close_cancel').setLabel('Anuluj').setStyle(ButtonStyle.Secondary))]});
  return serial('tickets',async()=>{const fresh=await interaction.guild.channels.fetch(interaction.channelId);const result=await closeTicket(fresh,interaction.user.id,interaction.user.globalName??interaction.user.username);return interaction.editReply({content:`Ticket zamknięty. Historia pozostaje w archiwum.${result.notified?'':' Nie udało się wysłać klientowi powiadomienia na DM.'}`,components:[]});});
}
function ticketMessageRecord(message,customer) {
  const card=message.embeds.find(e=>e.footer?.text===CUSTOMER_MESSAGE_MARKER);
  const isCustomer=Boolean(card)||message.content.startsWith('**Klient:**');
  const staff=message.content.startsWith('**Obsługa')||!message.author.bot;
  const staffName=/^\*\*Obsługa \(([^\n]+)\)/.exec(message.content)?.[1];
  const fileURL=card?.image?.url??card?.url;
  return {id:message.id,content:card?.description??message.content,author:isCustomer?'customer':staff?'staff':'system',name:isCustomer?(card?.author?.name??customer.globalName??customer.username):staff?(staffName??message.member?.displayName??message.author.globalName??message.author.username):'FivemShop',time:message.createdTimestamp,
    files:[...message.attachments.values()].map(a=>({name:a.name,url:a.url,type:a.contentType??''})).concat(fileURL?[{name:card.title??'Załącznik',url:fileURL,type:card.image?'image/unknown':''}]:[]),
    embeds:message.embeds.filter(e=>e!==card).map(e=>({title:e.title,description:e.description,fields:e.fields}))};
}
async function ticket(user, offerId, reason, carOffer = false) {
  const { guild, channels } = await guildAndChannels();
  const existing = channels.find(c => c?.type === ChannelType.GuildText && c.topic === activeTopic(user.id, offerId, reason, carOffer));
  if (existing) return existing;
  const cars = carOffer || reason?.key === 'samochody';
  const overwrites = privateOverwrites(guild, cars);
  const categoryName = cars ? CAR_CATEGORY : offerId ? OFFER_CATEGORY : CATEGORY;
  let category = channels.find(c => c?.type === ChannelType.GuildCategory && c.name === categoryName);
  if (!category) category = await guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory, permissionOverwrites: overwrites });
  const channel = await guild.channels.create({
    name: `${offerId ? 'oferta' : reason?.key ?? 'uslugi'}-${user.id}${offerId ? `-${offerId.slice(-6)}` : ''}`, type: ChannelType.GuildText, parent: category.id,
    topic: activeTopic(user.id, offerId, reason, carOffer), permissionOverwrites: overwrites,
  });
  ticketLanguages.set(channel.id,languageOf(user.id));
  await channel.send(ticketPanelPayload(channel,user));
  return channel;
}
async function forwardCustomer(message, channel) {
  const text = message.content || '(załącznik / wiadomość bez tekstu)';
  const card=()=>{const embed=new EmbedBuilder().setColor(0xa78ac4).setAuthor({name:message.author.globalName??message.author.username,...(message.author.displayAvatarURL?{iconURL:message.author.displayAvatarURL({size:128})}:{})}).setFooter({text:CUSTOMER_MESSAGE_MARKER});if(message.createdTimestamp)embed.setTimestamp(message.createdTimestamp);return embed;};
  for(let offset=0;offset<text.length;offset+=4000)await channel.send({embeds:[card().setDescription(text.slice(offset,offset+4000))],allowedMentions:{parse:[]}});
  for(const attachment of message.attachments.values()){
    const embed=card().setTitle(`📎 ${attachment.name??'Załącznik'}`.slice(0,256)).setURL(attachment.url).setDescription('Załącznik od klienta');
    if(/^image\//.test(attachment.contentType??'')||/\.(png|jpe?g|gif|webp)(?:\?|$)/i.test(attachment.url))embed.setImage(attachment.url);
    await channel.send({embeds:[embed],allowedMentions:{parse:[]}});
  }
}

client.once(Events.ClientReady, async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.members.fetch(OWNER_ID);
    const channels = await guild.channels.fetch();
    for (const channel of channels.values()) {
      if (channel && ((channel.type === ChannelType.GuildCategory && [CATEGORY, OFFER_CATEGORY, CAR_CATEGORY].includes(channel.name))
        || (channel.type === ChannelType.GuildText && /^pyku:(open|offer|closed|closedoffer):\d+(?::\d+)?(?::car)?$/.test(channel.topic ?? '')))) {
        // Identify older offer tickets from their original offer link before applying access.
        if (/^pyku:(offer|closedoffer):\d+:\d+$/.test(channel.topic ?? '')) {
          try {
            const history = await channel.messages.fetch({ limit: 100 });
            const notice = history.find(message => message.author.id === client.user.id && message.embeds.some(embed => embed.title === '📩 Zapytanie o ofertę'));
            const link = notice?.embeds[0]?.description?.match(/https:\/\/discord.com\/channels\/\d+\/(\d+)\/(\d+)/);
            if (link) {
              const sourceChannel = await guild.channels.fetch(link[1]);
              const source = await sourceChannel.messages.fetch(link[2]);
              if (source.author.id === client.user.id && offerEmbeds(source)[0]?.footer?.text.includes('Auta FiveM')) await channel.setTopic(`${channel.topic}:car`);
            }
          } catch (error) { console.error('Migracja zgłoszenia oferty:', channel.id, error.message); }
        }
        const cars = channel.name === CAR_CATEGORY || isCarTicket(channel.topic);
        await channel.permissionOverwrites.set(privateOverwrites(guild, cars));
        if (cars && channel.type === ChannelType.GuildText) {
          let parent = (await guild.channels.fetch()).find(item => item?.type === ChannelType.GuildCategory && item.name === CAR_CATEGORY);
          if (!parent) parent = await guild.channels.create({ name: CAR_CATEGORY, type: ChannelType.GuildCategory, permissionOverwrites: privateOverwrites(guild, true) });
          if (channel.parentId !== parent.id) await channel.setParent(parent.id, { lockPermissions: false });
        }
        if(channel.type===ChannelType.GuildText&&activeTicket(channel.topic)){
          try{await ensureTicketPanel(channel);}catch(error){console.error('Panel istniejącego ticketa:',channel.id,error.message);}
        }
      }
    }
    await internationalizeChannels(guild);
    await refreshEnglishServicePanels(guild);
    await guild.commands.set(commands.map(command=>command.name==='oferty'?{...command,options:command.options.map(option=>option.name==='kategoria'?{...option,choices:orderedCarGroups(guild).map(([value,,name])=>({name,value}))}:option)}:command));
    startWebsiteCatalog(guild);
    refreshCarListingLayout(guild).catch(error=>console.error('English car layout:',error.message));
    try { await publishOfferPanel(guild); } catch (error) { console.error("Stały panel ofert:", error.message); }
    console.log(`${BRAND}: bot działa jako ${client.user.tag}`);
    try { await serial('bump', () => checkBumpReminder(guild)); }
    catch (error) { console.error('Bump FivemShop:', error.message); }
    setInterval(() => serial('bump', () => checkBumpReminder(guild))
      .catch(error => console.error('Bump FivemShop:', error.message)), 60_000).unref();
    try { await publishWelcome(guild); }
    catch (error) { console.error('Powitanie FivemShop:', error.message); }
    try { await removeMemberWelcomeButtons(guild); }
    catch (error) { console.error('Przyciski powitań:', error.message); }
    try {
      await verificationRole(guild);
      console.log('Weryfikacja FivemShop: uprawnienia do nadawania rangi poprawne.');
    } catch (error) { console.error('Weryfikacja FivemShop — uprawnienia:', error.message); }
    try { await publishVerification(guild); }
    catch (error) { console.error('Weryfikacja FivemShop — publikacja:', error.message); }
    setInterval(() => serial('verification', () => publishVerification(guild))
      .catch(error => console.error('Weryfikacja FivemShop — odświeżenie licznika:', error.message)), 60_000).unref();
  } catch (error) { console.error('Nie udało się uruchomić konfiguracji:', error.message); client.destroy(); process.exitCode = 1; }
});

client.on(Events.MessageCreate, message => {
  observeBump(message);
  if (message.author.bot || message.webhookId) return;
  if (message.guildId) {
    if (message.guildId !== GUILD_ID || !activeTicket(message.channel.topic)) return;
    serial('tickets', async () => {
      const channel = await message.guild.channels.fetch(message.channelId);
      if (!await canHandleTicket(message.author.id, message.guild, channel?.topic)) return;
      const match = activeTicket(channel?.topic);
      if (!match) return;
      if (!message.content && !message.attachments.size) return;
      const user = await client.users.fetch(match[2]);
      const prefix = `**FivemShop • ${publicTicketLabel(match,ticketLanguages.get(channel.id)??'en')}**\n`;
      const text = message.content || '(załącznik)';
      const size = 2000 - prefix.length;
      for (let offset = 0; offset < text.length; offset += size) {
        await user.send({ content: prefix + text.slice(offset, offset + size) });
      }
      for (const attachment of message.attachments.values()) {
        await user.send({ content: attachment.url });
      }
      await message.react('✅').catch(() => {});
    }).catch(async error => {
      console.error('Błąd wysyłania odpowiedzi:', error.message);
      await message.reply('❌ Nie udało się dostarczyć całej wiadomości na DM. Klient może mieć wyłączone wiadomości prywatne. Sprawdź dostarczenie przed ponowieniem.').catch(() => {});
    });
    return;
  }
  serial('tickets', async () => {
    const { channels } = await guildAndChannels();
    const active = [...channels.values()].filter(channel => activeTicket(channel?.topic)?.[2] === message.author.id);
    const isMenu = /^(menu|start)$/i.test(message.content.trim());
    if (isMenu || !active.length || (active.length === 1 && !activeTicket(active[0].topic)?.[3])) {
      await message.reply(languageMenu(isMenu ? 'new' : message.id));
      return;
    }
    if (active.length > 1) {
      const rows = [];
      for (let i = 0; i < active.length; i += 5) rows.push(new ActionRowBuilder().addComponents(active.slice(i, i + 5).map(channel =>
        new ButtonBuilder().setCustomId(`route:${channel.id}:${message.id}`).setLabel(channel.name.slice(0, 80)).setStyle(ButtonStyle.Secondary))));
      if (rows.length > 5) return await message.reply('Masz zbyt wiele aktywnych rozmów. Poproś obsługę o zamknięcie zakończonych zgłoszeń.');
      await message.reply({ content:say(message.author.id,'Which conversation is this for? Choose a ticket below. Type **menu** to start another request.','Do której rozmowy przekazać tę wiadomość? Wybierz zgłoszenie. Aby zacząć nową sprawę, napisz **menu**.'), components: rows });
      return;
    }
    const channel = active[0] ?? await ticket(message.author);
    await forwardCustomer(message, channel);
    await message.reply(say(message.author.id,'Your message has been forwarded to FivemShop. We will reply here.','Wiadomość przekazana do FivemShop. Odpowiedź otrzymasz tutaj.'));
  }).catch(async error => {
    console.error('Błąd odbioru zgłoszenia:', error.message);
    await message.reply(say(message.author.id,'We could not forward your message. Please try again later or contact server staff.','Nie udało się przekazać wiadomości. Spróbuj później lub skontaktuj się z administracją serwera.')).catch(() => {});
  });
});
client.on(Events.MessageUpdate, (_old, message) => {
  if (message.channelId === BUMP_CHANNEL_ID) observeBump(message);
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.customId?.startsWith('offerpanel:')) {
    try { await handleOfferPanel(interaction); }
    catch (error) {
      console.error('Panel ofert:', error.message);
      const content = `Nie udało się zakończyć operacji: ${error.message} Jeśli oferta była wysyłana, sprawdź kanał przed ponowieniem.`;
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return;
  }
  if (!interaction.isButton() && !interaction.isChatInputCommand()) return;
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (interaction.isButton()) {
      if (['ticket_close','ticket_close_confirm','ticket_close_cancel'].includes(interaction.customId)) return await handleTicketCloseButton(interaction);
      if (interaction.customId.startsWith('desktop_login:')) return await showDesktopLoginCode(interaction);
      if (interaction.customId === 'fivemshop_verify') return await interaction.editReply('Panel został zaktualizowany. Przeczytaj regulamin w aktualnym panelu i kliknij „Akceptuję regulamin i weryfikuję się”.');
      if(interaction.customId==='rules_pl'){userLanguages.set(interaction.user.id,'pl');return interaction.editReply({embeds:verificationPanel(null,'pl').embeds});}
      if(interaction.customId.startsWith('language:')){
        if(interaction.guildId||interaction.message.author.id!==client.user.id)return interaction.editReply('Choose your language in the DM conversation with the bot.');
        const [,lang,messageId]=interaction.customId.split(':');
        if(!['en','pl'].includes(lang)||(messageId!=='new'&&!/^\d+$/.test(messageId)))return interaction.editReply('Invalid language selection. Type menu to start again.');
        if(messageId!=='new'){const original=await interaction.channel.messages.fetch(messageId);if(original.author.id!==interaction.user.id)return interaction.editReply('This is not your message.');}
        userLanguages.set(interaction.user.id,lang);
        await interaction.message.edit({...reasonMenu(messageId,lang),content:null});
        return interaction.editReply(lang==='pl'?'Wybrano polski. Teraz wybierz kategorię zgłoszenia.':'English selected. Now choose a support category.');
      }
      if (interaction.customId.startsWith('reason:')) {
        if (interaction.guildId || interaction.message.author.id !== client.user.id) return await interaction.editReply('Wybierz sprawę w prywatnej rozmowie z botem.');
        const [, reasonId, messageId] = interaction.customId.split(':');
        const reason = DM_REASONS.find(item => item.id === reasonId);
        if (!reason || (messageId !== 'new' && !/^\d+$/.test(messageId))) return await interaction.editReply('Nieprawidłowy wybór sprawy. Napisz menu.');
        return await serial('tickets', async () => {
          const chooser = await interaction.channel.messages.fetch(interaction.message.id);
          if (!chooser.components.length) return await interaction.editReply(say(interaction.user.id,'This category has already been selected. Type menu to start another request.','Sprawa jest już wybrana. Napisz menu, aby wybrać kolejną.'));
          let original;
          if (messageId !== 'new') {
            original = await interaction.channel.messages.fetch(messageId);
            if (original.author.id !== interaction.user.id) return await interaction.editReply('To nie jest Twoja wiadomość.');
          }
          const channel = await ticket(interaction.user, undefined, reason);
          if (original) await forwardCustomer(original, channel);
          await interaction.message.edit({ content: say(interaction.user.id,`✅ Selected: **${reasonEnglish[reason.key]}**. ${original?'Your message has been forwarded.':'Tell us how we can help.'}`,`✅ Wybrano: **${reason.label}**.${original ? ' Twoja wiadomość została przekazana.' : ' Napisz, w czym możemy pomóc.'}`), embeds: [], components: [] });
          await interaction.editReply(say(interaction.user.id,`Selected: ${reasonEnglish[reason.key]}. Continue this conversation here. Type menu to start another request.`,`Wybrana sprawa: ${reason.label}. Dalszą rozmowę prowadzimy tutaj. Aby zmienić sprawę, napisz menu.`));
        });
      }
      if (interaction.customId === VERIFY_BUTTON_ID) {
        if (interaction.guildId !== GUILD_ID || interaction.channelId !== VERIFY_CHANNEL_ID
          || interaction.message.author.id !== client.user.id) return await interaction.editReply(say(interaction.user.id,'This button only works in the FivemShop verification channel.','Ten przycisk działa tylko na kanale weryfikacji FivemShop.'));
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (member.roles.cache.has(VERIFY_ROLE_ID)) return await interaction.editReply(say(interaction.user.id,'✅ You are already verified and have access to FivemShop.','✅ Masz już rangę weryfikacji i dostęp do FivemShop.'));
        try {
          const role = await verificationRole(interaction.guild);
          await member.roles.add(role, 'FivemShop — akceptacja regulaminu v1 i weryfikacja');
          await serial('verification', () => publishVerification(interaction.guild))
            .catch(error => console.error('Weryfikacja FivemShop — aktualizacja licznika:', error.message));
          return await interaction.editReply(say(interaction.user.id,'✅ Rules accepted. Verification complete — welcome to FivemShop!','✅ Regulamin zaakceptowany. Weryfikacja zakończona! Masz już dostęp do FivemShop.'));
        } catch (error) {
          console.error('Weryfikacja FivemShop — nadanie rangi:', error.message);
          return await interaction.editReply(say(interaction.user.id,'Verification failed. Please contact staff: the bot needs Manage Roles and a role above the verification role.','Nie udało się nadać rangi. Powiadom obsługę: bot musi mieć Zarządzanie rolami i swoją rangę nad rangą weryfikacji.'));
        }
      }
      if (interaction.customId.startsWith('route:')) {
        const [, channelId, messageId] = interaction.customId.split(':');
        return await serial('tickets', async () => {
          const { guild } = await guildAndChannels();
          const channel = await guild.channels.fetch(channelId);
          if (activeTicket(channel?.topic)?.[2] !== interaction.user.id) return await interaction.editReply(say(interaction.user.id,'This ticket is closed or belongs to another person.','Zgłoszenie jest zamknięte lub należy do innej osoby.'));
          const chooser = await interaction.channel.messages.fetch(interaction.message.id);
          if (!chooser.components.length) return await interaction.editReply(say(interaction.user.id,'This message has already been forwarded.','Ta wiadomość została już przekazana.'));
          const original = await interaction.channel.messages.fetch(messageId);
          if (original.author.id !== interaction.user.id) return await interaction.editReply('To nie jest Twoja wiadomość.');
          await forwardCustomer(original, channel);
          await interaction.message.edit({ content: `Wiadomość przekazana do: ${channel.name}`, components: [] });
          await interaction.editReply(say(interaction.user.id,'Your message was sent to the selected ticket.','Wysłano do wybranego zgłoszenia.'));
        });
      }
      if (interaction.customId === 'offer_contact' || interaction.customId.startsWith('offer_ref:') || interaction.customId.startsWith('offerlang:')) {
        if (interaction.guildId !== GUILD_ID) return await interaction.editReply('Oferta pochodzi z innego serwera.');
        let source = interaction.message;
        if (interaction.customId.startsWith('offer_ref:')||interaction.customId.startsWith('offerlang:')) {
          const parts=interaction.customId.split(':');const [channelId,messageId]=parts[0]==='offerlang'?parts.slice(2):parts.slice(1);
          const channel = await interaction.guild.channels.fetch(channelId);
          source = await channel.messages.fetch(messageId);
        }
        if(!interaction.customId.startsWith('offerlang:'))return interaction.editReply({content:'🌍 Choose your support language / Wybierz język obsługi:',components:[new ActionRowBuilder().addComponents(...['en','pl'].map(lang=>new ButtonBuilder().setCustomId(`offerlang:${lang}:${source.channelId}:${source.id}`).setLabel(lang==='en'?'🇬🇧 English':'🇵🇱 Polski').setStyle(ButtonStyle.Primary)))]});
        const selectedLanguage=interaction.customId.split(':')[1];if(!['en','pl'].includes(selectedLanguage))return interaction.editReply('Invalid language.');userLanguages.set(interaction.user.id,selectedLanguage);
        if (source.author.id !== client.user.id || !offerEmbeds(source)[0]?.title) return await interaction.editReply(say(interaction.user.id,'Offer not found.','Nie znaleziono oferty.'));
        if (managedCar(source)) {
          source = await source.channel.messages.fetch(source.id);
          if (offerEmbeds(source)[0].fields.some(f => f.name === 'Status' && ['Sprzedane','Wycofane'].includes(f.value))) return await interaction.editReply(say(interaction.user.id,'This car is no longer available. Please check the current car catalog.','Ta oferta samochodu nie jest już dostępna. Sprawdź aktualny katalog aut.'));
        }
        const title = offerEmbeds(source)[0].title;
        const price = offerEmbeds(source)[0].fields.find(f => f.name === '💰 Cena')?.value ?? 'Do ustalenia';
        try {
          await interaction.user.send({ content: say(interaction.user.id,`**FivemShop — ${title}**\nPrice: ${price}\n${source.url}\n\nYour request will reach our team. Reply here with your question or order details.`,`**${BRAND} — ${title}**\nCena: ${price}\n${source.url}\n\nTwoje zapytanie trafi do obsługi. Napisz tutaj, co chcesz zamówić lub o co zapytać.`), allowedMentions: { parse: [] } });
        } catch { return await interaction.editReply(say(interaction.user.id,'Enable DMs from server members and try again.','Włącz DM od członków serwera i kliknij ponownie.')); }
        await serial('tickets', async () => {
          const channel = await ticket(interaction.user, source.id, undefined, offerEmbeds(source)[0]?.footer?.text.includes('Auta FiveM'));
          await channel.send({ embeds: [new EmbedBuilder().setColor(0xa855f7).setTitle('📩 Zapytanie o ofertę')
            .setDescription(`Klient: ${interaction.user.username}\n**${title}**\nCena: ${price}\n${source.url}`)] });
        });
        return await interaction.editReply(say(interaction.user.id,'Ticket opened! Continue in your DM conversation with the bot.','Zgłoszenie otwarte! Dalszą rozmowę poprowadzisz na DM z botem.'));
      }
      if (interaction.customId === 'prices') {
        const fields = interaction.message.embeds[0]?.fields ?? [];
        const legacy = fields.find(item => item.name === '💰 Prices');
        const summary = fields.filter(item => item.value.includes('**Price:**')).map(item =>
          `**${item.name}**\n${item.value.slice(item.value.lastIndexOf('**Price:**'))}`).join('\n\n');
        return await interaction.editReply({ content: summary || legacy?.value || 'Wycena indywidualna — napisz do bota i opisz zamówienie.', allowedMentions: { parse: [] } });
      }
      if (!['order', 'question'].includes(interaction.customId)) return await interaction.editReply('Nieznany przycisk.');
      try {
        await interaction.user.send(languageMenu());
      } catch { return await interaction.editReply(say(interaction.user.id,'I could not send you a DM. Enable DMs from server members and message the bot directly.','Nie mogę wysłać Ci DM. Włącz prywatne wiadomości od członków serwera, a następnie napisz bezpośrednio do bota.')); }
      return await interaction.editReply(say(interaction.user.id,'I sent you a DM. Choose your language and support category to open a ticket.','Wysłałem Ci DM. Wybierz kategorię sprawy, aby otworzyć zgłoszenie.'));
    }
    if (interaction.guildId !== GUILD_ID) return await interaction.editReply('Ta komenda działa wyłącznie na serwerze P.Y.K.U CREATIVE.');
    if (interaction.commandName === 'bumpy') {
      await serial('bump', () => checkBumpReminder(interaction.guild));
      return await interaction.editReply({ embeds: [bumpStatsEmbed()], allowedMentions: { parse: [] } });
    }
    if (!await canOperate(interaction.user.id, interaction.guild)) return await interaction.editReply('Komendy są dostępne dla właściciela i rangi obsługi P.Y.K.U CREATIVE.');
    if (interaction.commandName === 'oferty' && interaction.user.id !== CAR_OWNER_ID) return await interaction.editReply('Komenda /oferty jest przypisana opiekunowi samochodów 317932984663539723.');
    if (interaction.commandName === 'oferta' && interaction.user.id === CAR_OWNER_ID) return await interaction.editReply('Do publikacji samochodów użyj /oferty.');
    if (interaction.user.id === CAR_OWNER_ID && ['panel', 'weryfikacja'].includes(interaction.commandName)) return await interaction.editReply('Twoja obsługa obejmuje oferty i tickety samochodów.');
    if (interaction.commandName === 'weryfikacja') {
      const panel = await serial('verification', () => publishVerification(interaction.guild));
      return await interaction.editReply(`Panel weryfikacji gotowy: ${panel.url}`);
    }
    if (['oferta', 'oferty'].includes(interaction.commandName)) {
      const destination = interaction.options.getChannel('kanal') ?? interaction.channel;
      if (destination.type !== ChannelType.GuildText) return await interaction.editReply('Wybierz zwykły kanał tekstowy w polu kanal.');
      if (!destination.permissionsFor(interaction.member)?.has([P.ViewChannel, P.SendMessages])) return await interaction.editReply('Nie masz uprawnień do publikacji na tym kanale.');
      const name = interaction.options.getString('nazwa').trim();
      const description = interaction.options.getString('opis').trim().replaceAll('\\n', '\n');
      const price = interaction.options.getString('cena').trim();
      const cars = interaction.commandName === 'oferty' || interaction.options.getString('dzial') === 'auta';
      if (interaction.user.id === CAR_OWNER_ID && !cars) return await interaction.editReply('Możesz publikować wyłącznie oferty samochodów. Wybierz dział auta.');
      if (!name || !description || !price) return await interaction.editReply('Nazwa, opis i cena nie mogą być puste.');
      let photos;
      try { photos = photosFrom(interaction); } catch (error) { return await interaction.editReply(error.message); }
      const card = new EmbedBuilder().setColor(0xa855f7).setAuthor({ name: BRAND })
        .setTitle(name).setDescription(description).addFields({ name: '💰 Cena', value: price },
          { name: '📩 Kontakt i zamówienia', value: 'Kliknij przycisk poniżej — porozmawiamy prywatnie przez bota.' })
        .setFooter({ text: `${BRAND} • ${cars ? 'Auta FiveM' : 'Oferta FiveM'}` });
      if (cars) {
        const category = CAR_GROUPS.find(([key]) => key === interaction.options.getString('kategoria'))
          ?? CAR_GROUPS.find(([, regex]) => regex.test(destination.name.toLowerCase()));
        if (category) card.addFields({ name: '📂 Kategoria', value: category[2] });
      }
      const sent = await destination.send(cars ? carListingPayload({ cars:true, name, description, price, categoryLabel: card.data.fields.find(f => f.name === '📂 Kategoria')?.value ?? 'Samochody', photos }) : { ...imagePayload(photos, card), components: [contactButton('offer_contact', false)] });
      webCatalog.expires = 0;
      return await interaction.editReply(`Oferta opublikowana: ${sent.url}\nID oferty do dodania kolejnych zdjęć: ${sent.id}`);
    }
    if (interaction.commandName === 'zdjecia') {
      const id = interaction.options.getString('oferta_id').trim();
      if (!/^\d+$/.test(id)) return await interaction.editReply('Podaj ID wiadomości oferty.');
      const source = await interaction.channel.messages.fetch(id);
      if (interaction.user.id === CAR_OWNER_ID && !offerEmbeds(source)[0]?.footer?.text.includes('Auta FiveM')) return await interaction.editReply('Możesz dodawać zdjęcia tylko do ofert samochodów.');
      if (managedCar(source)) {
        if (!canManageCars(interaction.user.id)) return await interaction.editReply('Galeria samochodów jest dostępna dla Ponczula420 i OFFWHITE.');
        return serial(`car-offer:${source.channelId}:${source.id}`, async () => {
          const fresh = await source.channel.messages.fetch(source.id);
          const draft = carDraftFromMessage(fresh);
          let photos;
          try { photos = photosFrom(interaction); } catch (error) { return await interaction.editReply(error.message); }
          if (draft.photos.length + photos.length > 10) return await interaction.editReply('Jedno ogłoszenie mieści maksymalnie 10 zdjęć. Zastąp galerię przez edycję w panelu.');
          draft.photos.push(...photos);
          await fresh.edit({ ...carListingPayload(draft), content: null, embeds: [], attachments: [] });
          webCatalog.expires = 0;
          return await interaction.editReply(`Zdjęcia dodane do tej samej oferty: ${fresh.url}`);
        });
      }
      if (source.author.id !== client.user.id || !source.components.some(row => row.components.some(c => c.customId === 'offer_contact'))) return await interaction.editReply('To nie jest oferta utworzona przez /oferta na tym kanale.');
      let photos;
      try { photos = photosFrom(interaction); } catch (error) { return await interaction.editReply(error.message); }
      const card = new EmbedBuilder().setColor(0xa855f7).setTitle(offerEmbeds(source)[0].title)
        .setDescription(`[Zobacz ofertę i cenę](${source.url})`).setFooter({ text: `${BRAND} • Galeria oferty` });
      await interaction.channel.send({ ...imagePayload(photos, card), components: [contactButton(`offer_ref:${source.channelId}:${source.id}`, offerEmbeds(source)[0].footer?.text.includes('Auta FiveM'))] });
      webCatalog.expires = 0;
      return await interaction.editReply('Dodatkowe zdjęcia opublikowane z przyciskiem kontaktu do tej oferty.');
    }
    if (interaction.commandName === 'panel') {
      const prices = Object.fromEntries(priceFields.map(([key]) => [key, interaction.options.getString(key)?.trim()]));
      const descriptions = Object.fromEntries(priceFields.map(([key]) => [key, interaction.options.getString(`opis_${key}`)?.trim()]));
      const destination = interaction.options.getChannel('kanal') ?? interaction.channel;
      if (!destination.permissionsFor(interaction.member).has(P.ViewChannel)) return await interaction.editReply('Nie masz dostępu do wybranego kanału.');
      await destination.send({ embeds: [offer(prices, descriptions)], components: [buttons()] });
      return await interaction.editReply('Oferta została opublikowana.');
    }
    await serial('tickets', async () => {
      const channel = await interaction.guild.channels.fetch(interaction.channelId);
      const match = activeTicket(channel?.topic);
      if (!match) return await interaction.editReply('Użyj tej komendy na kanale aktywnego zgłoszenia.');
      if (!await canHandleTicket(interaction.user.id, interaction.guild, channel.topic)) return await interaction.editReply('To zgłoszenie należy do drugiego opiekuna. Samochody obsługuje 317932984663539723, a pozostałe usługi 795755381744861184.');
      const user = await client.users.fetch(match[2]);
      if (interaction.commandName === 'odpowiedz') {
        const content = interaction.options.getString('tresc');
        const attachment = interaction.options.getAttachment('plik');
        if (!content && !attachment) return await interaction.editReply('Podaj treść lub plik.');
        await user.send({ content: `**FivemShop • ${publicTicketLabel(match,ticketLanguages.get(channel.id)??'en')}**\n${content ?? ''}`, files: attachment ? [attachment.url] : [] });
        await channel.send({ content: `**Obsługa (${interaction.user.username}) → klient:**\n${content ?? ''}${attachment ? `\n${attachment.url}` : ''}` });
        return await interaction.editReply('Odpowiedź wysłana na DM.');
      }
      if (interaction.commandName === 'zamknij') {
        const result=await closeTicket(channel,interaction.user.id,interaction.user.globalName??interaction.user.username);
        await interaction.editReply(`Zgłoszenie zamknięte.${result.notified ? '' : ' Nie udało się wysłać klientowi powiadomienia na DM.'}`);
      }
    });
  } catch (error) {
    console.error('Błąd operacji:', error.message);
    const content = 'Operacja nie została w pełni zakończona. Sprawdź historię kanału przed ponowieniem. Jeśli odpowiedź nie dotarła, klient może mieć wyłączone DM.';
    if (interaction.deferred || interaction.replied) await interaction.editReply(content).catch(() => {});
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});
client.on(Events.Error, error => console.error('Błąd Discord:', error.message));
async function startBot() {
  try {
    const application = await client.rest.setToken(DISCORD_TOKEN).get('/applications/@me');
    // Discord application flags 14/15 indicate permission to request GuildMembers.
    if (Number(application.flags) & ((1<<14)|(1<<15))) {
      client.options.intents = client.options.intents.add(GatewayIntentBits.GuildMembers);
      console.log('Powitania nowych członków: Server Members Intent włączony.');
    } else console.error('Powitania nowych członków: włącz SERVER MEMBERS INTENT w Discord Developer Portal i uruchom bota ponownie.');
  } catch(error) { console.error('Sprawdzenie Server Members Intent nie powiodło się:',error.message); }
  await client.login(DISCORD_TOKEN).catch(error => { console.error('Logowanie nieudane:', error.message); process.exitCode = 1; });
}
startBot();

