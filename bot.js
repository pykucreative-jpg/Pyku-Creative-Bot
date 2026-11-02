import {
  Client, Events, GatewayIntentBits, Partials, ChannelType, PermissionFlagsBits as P,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
  MessageFlags, ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle, FileUploadBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder,
} from 'discord.js';
import { createServer } from 'node:http';

const OWNER_ID = '795755381744861184';
const CAR_OWNER_ID = '317932984663539723';
const SUPPORT_ROLE_ID = '1562454115206955059';
const VERIFY_ROLE_ID = '1562457525868040192';
const VERIFY_CHANNEL_ID = '1562457528829214760';
const WELCOME_CHANNEL_ID = '1562442549099110560';
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
function startWebsiteCatalog(guild) {
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'OPTIONS') { response.writeHead(204); return response.end(); }
    if (request.method !== 'GET') { response.writeHead(405); return response.end(JSON.stringify({ error: 'Method not allowed' })); }
    const path = new URL(request.url, 'http://localhost').pathname;
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
function reasonMenu(messageId = 'new') {
  return {
    embeds: [new EmbedBuilder().setColor(0xf0ae42).setTitle('📩 FivemShop • W czym możemy pomóc?')
      .setDescription('Wybierz, w jakiej sprawie piszesz. Twoja wiadomość i załączniki trafią do odpowiedniego zgłoszenia.\n\nAby później wybrać inną sprawę, napisz **menu**.')],
    components: [0, 3].map(start => new ActionRowBuilder().addComponents(DM_REASONS.slice(start, start + 3).map(reason =>
      new ButtonBuilder().setCustomId(`reason:${reason.id}:${messageId}`).setLabel(reason.label).setEmoji(reason.emoji).setStyle(ButtonStyle.Secondary)))),
  };
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
  skiny: 'Skin ze zdjęciem lub wzorem — 10 zł\nSkin z zawieszką zwisającą po boku, w stylu CS — 15 zł',
  mody: 'Gotowy citizen + mody pod RP — 25 zł\nPojedynczy customowy mod — 10 zł\nCitizen pod FPS z ładnym wyglądem — 20 zł',
  ubrania: '25 zł',
  optymalizacja: '50 zł',
};
const offer = (prices = {}, descriptions = {}) => new EmbedBuilder().setColor(0xa855f7)
  .setAuthor({ name: BRAND }).setTitle('OFERTA • USŁUGI NA ZAMÓWIENIE')
  .setDescription('**Twój pomysł. Twój styl. Twoje wykonanie.**\nProjekty do FiveM i optymalizacja komputera dopasowane do Twoich wymagań.')
  .addFields(
    { name: '🔫 SKINY DO BRONI', value: `${descriptions.skiny || 'Customowy wygląd broni do FiveM według Twoich inspiracji.'}\n**Cena:**\n${prices.skiny || defaultPrices.skiny}` },
    { name: '🛠️ MODY I CITIZENY', value: `${descriptions.mody || 'Gotowe zestawy do RP, pojedyncze customowe mody i citizen pod FPS z dbałością o wygląd gry.'}\n**Cena:**\n${prices.mody || defaultPrices.mody}` },
    { name: '👕 UBRANIA DO FIVEM', value: `${descriptions.ubrania || 'Koszulki, bluzy, spodnie i inne ubrania dla postaci, ekip i organizacji.'}\n**Cena:**\n${prices.ubrania || defaultPrices.ubrania}` },
    { name: '🚀 OPTYMALIZACJA KOMPUTERA', value: `${descriptions.optymalizacja || 'Ustawienia pod FPS i płynność. Efekty zależą od sprzętu i konfiguracji.'}\n**Cena:**\n${prices.optymalizacja || defaultPrices.optymalizacja}` },
    { name: '📩 JAK ZAMÓWIĆ?', value: 'Kliknij **Zamów usługę** i odpowiedz botowi na DM.\nPrześlij opis, inspiracje i oczekiwany termin.\nCenę i zakres potwierdzamy przed rozpoczęciem pracy.' },
  ).setFooter({ text: 'P.Y.K.U CREATIVE • Indywidualne projekty • Kontakt przez DM' });
const buttons = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('order').setLabel('Zamów usługę').setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId('prices').setLabel('Cennik').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId('question').setLabel('Zadaj pytanie').setStyle(ButtonStyle.Secondary),
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
  new ButtonBuilder().setCustomId(reference).setLabel(cars ? 'Zapytaj o auto / zamów' : 'Zapytaj o ofertę / zamów').setEmoji('📩').setStyle(ButtonStyle.Primary),
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
function offerEmbeds(message) {
  if (message.embeds?.length) return message.embeds;
  const root = message.components?.map(c => c.toJSON?.() ?? c).find(c => c.type === 17 && c.id === 2001);
  if (!root) return [];
  const field = id => root.components.find(c => c.type === 10 && c.id === id)?.content;
  if (field(106) !== '-# FivemShop • Auta FiveM') return [];
  const name = field(101)?.replace(/^### /, '');
  const description = field(102) ?? '';
  const price = field(103)?.replace(/^\*\*Cena\*\*\n/, '');
  const category = field(104)?.replace(/^\*\*Kategoria\*\*\n/, '');
  const status = field(105)?.replace(/^\*\*Status\*\*\n/, '') ?? 'Dostępne';
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
    .addTextDisplayComponents(new TextDisplayBuilder().setId(101).setContent(`### ${draft.name}`));
  if (draft.description) box.addTextDisplayComponents(new TextDisplayBuilder().setId(102).setContent(draft.description));
  box.addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setId(103).setContent(`**Cena**\n${draft.price}`),new TextDisplayBuilder().setId(104).setContent(`**Kategoria**\n${draft.categoryLabel}`));
  if (!active) box.addTextDisplayComponents(new TextDisplayBuilder().setId(105).setContent(`**Status**\n${status}`));
  const photos = draft.photos.slice(0,10);
  const files = upload ? photos.map((p,i) => ({ attachment: p.url, name: `auto-${i}.${p.name.split('.').pop().toLowerCase()}` })) : [];
  if (photos.length) box.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(photos.map((p,i) => new MediaGalleryItemBuilder()
    .setURL(upload ? `attachment://${files[i].name}` : p.url).setDescription(`${draft.name} — zdjęcie ${i+1}`.slice(0,1024)))));
  if (active) box.addActionRowComponents(contactButton('offer_contact', true));
  box.addTextDisplayComponents(new TextDisplayBuilder().setId(106).setContent('-# FivemShop • Auta FiveM'));
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
        if (!message.embeds.length || !managedCar(message)) continue;
        const draft = carDraftFromMessage(message);
        await message.edit({ ...carListingPayload(draft), content: null, embeds: [], attachments: [] });
        updated++;
      }
    } catch (error) { console.error('Układ ogłoszeń aut:', id, error.message); }
  }
  console.log(`Układ ogłoszeń aut: odświeżono ${updated} ofert.`);
}

const CAR_CHANNELS = Object.freeze({ sportowe: '1562442778795970682', sedan: '1562442783371825202', offroad: '1562442788107194489', 'bogate-tune': '1562442792771264532', motocykle: '1562488312424304721', pakiety: '1562442797615939594', suv: '1562995799628058624', coupe: '1562995805369925712', muscle: '1562995843680964698', supersamochody: '1562995855466823730' });
const canManageCars = userId => [OWNER_ID, CAR_OWNER_ID].includes(userId);
const carChannelMenu = customId => new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder('Wybierz katalog samochodów')
  .addOptions(CAR_GROUPS.map(([key, , label]) => ({ label, value: CAR_CHANNELS[key] }))));
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
  if (action === 'manage') return interaction.reply({ content: '**Oferty samochodów**\nWybierz katalog, a następnie ofertę. Obaj możecie zarządzać samochodami.', components: [carChannelMenu('offerpanel:carlist')], flags: MessageFlags.Ephemeral });
  if (action === 'carlist' || action === 'carmore') {
    await interaction.deferUpdate();
    const target = action === 'carlist' ? interaction.values[0] : channelId;
    if (!Object.values(CAR_CHANNELS).includes(target)) throw new Error('Nieprawidłowy katalog.');
    const channel = await offerDestination(interaction, target);
    const page = await channel.messages.fetch({ limit: 25, ...(messageId ? { before: messageId } : {}) });
    const found = [...page.values()].filter(managedCar);
    const rows = [carChannelMenu('offerpanel:carlist')];
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
        .addOptions((cars ? CAR_GROUPS.filter(([key]) => !draft?.source || key === draft.category).map(([value, , label]) => ({ label, value, ...(draft?.category === value ? { default: true } : {}) })) : serviceGroups.map(([value, label]) => ({ label, value }))))),
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
    if (previous?.source && category !== previous.category) throw new Error('W edytowanej ofercie nie można zmieniać katalogu.');
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
        return message.edit({ ...carListingPayload(draft), content: null, embeds: [], attachments: [] });
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
function verificationPanel(count) {
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
  const marker = 'FivemShop • Powitanie';
  const payload = { embeds: [new EmbedBuilder().setColor(0xf0ae42).setTitle('👋 Witaj w FivemShop!')
    .setDescription([
      '**Wszystko, czego potrzebujesz, by nadać swojemu FiveM własny styl.**',
      '',
      '🚗 **Samochody** — sportowe, luksusowe, terenowe i tuningowane.',
      '🔫 **Skiny do broni** — własne zdjęcia, wzory i zawieszki.',
      '🛠️ **Mody i citizeny** — pod RP, FPS oraz wygląd gry.',
      '👕 **Ubrania** — dla Twojej postaci, ekipy, organizacji lub firmy.',
      '🚀 **Optymalizacja PC** — pod lepszą płynność rozgrywki.',
      '',
      '**📩 Pytania i zamówienia**',
      'Kliknij przycisk pod wybraną ofertą lub napisz do bota na DM. Wybierz kategorię, a zgłoszenie trafi do odpowiedniej osoby.',
      '',
      '💰 Cenę, zakres i termin realizacji ustalisz z obsługą przed zamówieniem.',
      '',
      '**Rozgość się i znajdź coś dla siebie! 🖤**',
    ].join('\n')).setFooter({ text: marker })] };
  let before;
  while (true) {
    const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    const existing = page.find(message => message.author.id === client.user.id
      && message.embeds.some(embed => embed.footer?.text === marker));
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
  await channel.send(`Nowe zgłoszenie: ${user.username} (${user.id}).${reason ? `\nSprawa: **${reason.label}**` : ''}\nOpiekun: ${cars ? CAR_OWNER_ID : OWNER_ID}\nWiadomości i załączniki obsługi na tym kanale automatycznie trafiają klientowi na DM.\n/zamknij kończy rozmowę i zachowuje archiwum.`);
  return channel;
}
async function forwardCustomer(message, channel) {
  const text = message.content || '(załącznik / wiadomość bez tekstu)';
  const prefix = '**Klient:**\n';
  for (let offset = 0; offset < text.length; offset += 2000 - prefix.length) {
    await channel.send({ content: prefix + text.slice(offset, offset + 2000 - prefix.length) });
  }
  for (const attachment of message.attachments.values()) await channel.send({ content: attachment.url });
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
      }
    }
    await guild.commands.set(commands);
    startWebsiteCatalog(guild);
    await refreshCarListingLayout(guild);
    try { await publishOfferPanel(guild); } catch (error) { console.error("Stały panel ofert:", error.message); }
    console.log(`${BRAND}: bot działa jako ${client.user.tag}`);
    try { await serial('bump', () => checkBumpReminder(guild)); }
    catch (error) { console.error('Bump FivemShop:', error.message); }
    setInterval(() => serial('bump', () => checkBumpReminder(guild))
      .catch(error => console.error('Bump FivemShop:', error.message)), 60_000).unref();
    try { await publishWelcome(guild); }
    catch (error) { console.error('Powitanie FivemShop:', error.message); }
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
      const prefix = `**FivemShop • ${ticketLabel(match)}**\n`;
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
      await message.reply(reasonMenu(isMenu ? 'new' : message.id));
      return;
    }
    if (active.length > 1) {
      const rows = [];
      for (let i = 0; i < active.length; i += 5) rows.push(new ActionRowBuilder().addComponents(active.slice(i, i + 5).map(channel =>
        new ButtonBuilder().setCustomId(`route:${channel.id}:${message.id}`).setLabel(channel.name.slice(0, 80)).setStyle(ButtonStyle.Secondary))));
      if (rows.length > 5) return await message.reply('Masz zbyt wiele aktywnych rozmów. Poproś obsługę o zamknięcie zakończonych zgłoszeń.');
      await message.reply({ content: 'Do której rozmowy przekazać tę wiadomość? Wybierz zgłoszenie. Aby zacząć nową sprawę, napisz **menu**.', components: rows });
      return;
    }
    const channel = active[0] ?? await ticket(message.author);
    await forwardCustomer(message, channel);
    await message.reply('Wiadomość przekazana do P.Y.K.U CREATIVE. Odpowiedź otrzymasz tutaj.');
  }).catch(async error => {
    console.error('Błąd odbioru zgłoszenia:', error.message);
    await message.reply('Nie udało się przekazać wiadomości. Spróbuj później lub skontaktuj się z administracją serwera.').catch(() => {});
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
      if (interaction.customId === 'fivemshop_verify') return await interaction.editReply('Panel został zaktualizowany. Przeczytaj regulamin w aktualnym panelu i kliknij „Akceptuję regulamin i weryfikuję się”.');
      if (interaction.customId.startsWith('reason:')) {
        if (interaction.guildId || interaction.message.author.id !== client.user.id) return await interaction.editReply('Wybierz sprawę w prywatnej rozmowie z botem.');
        const [, reasonId, messageId] = interaction.customId.split(':');
        const reason = DM_REASONS.find(item => item.id === reasonId);
        if (!reason || (messageId !== 'new' && !/^\d+$/.test(messageId))) return await interaction.editReply('Nieprawidłowy wybór sprawy. Napisz menu.');
        return await serial('tickets', async () => {
          const chooser = await interaction.channel.messages.fetch(interaction.message.id);
          if (!chooser.components.length) return await interaction.editReply('Sprawa jest już wybrana. Napisz menu, aby wybrać kolejną.');
          let original;
          if (messageId !== 'new') {
            original = await interaction.channel.messages.fetch(messageId);
            if (original.author.id !== interaction.user.id) return await interaction.editReply('To nie jest Twoja wiadomość.');
          }
          const channel = await ticket(interaction.user, undefined, reason);
          if (original) await forwardCustomer(original, channel);
          await interaction.message.edit({ content: `✅ Wybrano: **${reason.label}**.${original ? ' Twoja wiadomość została przekazana.' : ' Napisz, w czym możemy pomóc.'}`, embeds: [], components: [] });
          await interaction.editReply(`Wybrana sprawa: ${reason.label}. Dalszą rozmowę prowadzimy tutaj. Aby zmienić sprawę, napisz menu.`);
        });
      }
      if (interaction.customId === VERIFY_BUTTON_ID) {
        if (interaction.guildId !== GUILD_ID || interaction.channelId !== VERIFY_CHANNEL_ID
          || interaction.message.author.id !== client.user.id) return await interaction.editReply('Ten przycisk działa tylko na kanale weryfikacji FivemShop.');
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (member.roles.cache.has(VERIFY_ROLE_ID)) return await interaction.editReply('✅ Masz już rangę weryfikacji i dostęp do FivemShop.');
        try {
          const role = await verificationRole(interaction.guild);
          await member.roles.add(role, 'FivemShop — akceptacja regulaminu v1 i weryfikacja');
          await serial('verification', () => publishVerification(interaction.guild))
            .catch(error => console.error('Weryfikacja FivemShop — aktualizacja licznika:', error.message));
          return await interaction.editReply('✅ Regulamin zaakceptowany. Weryfikacja zakończona! Masz już dostęp do FivemShop.');
        } catch (error) {
          console.error('Weryfikacja FivemShop — nadanie rangi:', error.message);
          return await interaction.editReply('Nie udało się nadać rangi. Powiadom obsługę: bot musi mieć Zarządzanie rolami i swoją rangę nad rangą weryfikacji.');
        }
      }
      if (interaction.customId.startsWith('route:')) {
        const [, channelId, messageId] = interaction.customId.split(':');
        return await serial('tickets', async () => {
          const { guild } = await guildAndChannels();
          const channel = await guild.channels.fetch(channelId);
          if (activeTicket(channel?.topic)?.[2] !== interaction.user.id) return await interaction.editReply('Zgłoszenie jest zamknięte lub należy do innej osoby.');
          const chooser = await interaction.channel.messages.fetch(interaction.message.id);
          if (!chooser.components.length) return await interaction.editReply('Ta wiadomość została już przekazana.');
          const original = await interaction.channel.messages.fetch(messageId);
          if (original.author.id !== interaction.user.id) return await interaction.editReply('To nie jest Twoja wiadomość.');
          await forwardCustomer(original, channel);
          await interaction.message.edit({ content: `Wiadomość przekazana do: ${channel.name}`, components: [] });
          await interaction.editReply('Wysłano do wybranego zgłoszenia.');
        });
      }
      if (interaction.customId === 'offer_contact' || interaction.customId.startsWith('offer_ref:')) {
        if (interaction.guildId !== GUILD_ID) return await interaction.editReply('Oferta pochodzi z innego serwera.');
        let source = interaction.message;
        if (interaction.customId.startsWith('offer_ref:')) {
          const [, channelId, messageId] = interaction.customId.split(':');
          const channel = await interaction.guild.channels.fetch(channelId);
          source = await channel.messages.fetch(messageId);
        }
        if (source.author.id !== client.user.id || !offerEmbeds(source)[0]?.title) return await interaction.editReply('Nie znaleziono oferty.');
        if (managedCar(source)) {
          source = await source.channel.messages.fetch(source.id);
          if (offerEmbeds(source)[0].fields.some(f => f.name === 'Status' && ['Sprzedane','Wycofane'].includes(f.value))) return await interaction.editReply('Ta oferta samochodu nie jest już dostępna. Sprawdź aktualny katalog aut.');
        }
        const title = offerEmbeds(source)[0].title;
        const price = offerEmbeds(source)[0].fields.find(f => f.name === '💰 Cena')?.value ?? 'Do ustalenia';
        try {
          await interaction.user.send({ content: `**${BRAND} — ${title}**\nCena: ${price}\n${source.url}\n\nTwoje zapytanie trafi do obsługi. Napisz tutaj, co chcesz zamówić lub o co zapytać.`, allowedMentions: { parse: [] } });
        } catch { return await interaction.editReply('Włącz DM od członków serwera i kliknij ponownie.'); }
        await serial('tickets', async () => {
          const channel = await ticket(interaction.user, source.id, undefined, offerEmbeds(source)[0]?.footer?.text.includes('Auta FiveM'));
          await channel.send({ embeds: [new EmbedBuilder().setColor(0xa855f7).setTitle('📩 Zapytanie o ofertę')
            .setDescription(`Klient: ${interaction.user.username}\n**${title}**\nCena: ${price}\n${source.url}`)] });
        });
        return await interaction.editReply('Zgłoszenie otwarte! Dalszą rozmowę poprowadzisz na DM z botem.');
      }
      if (interaction.customId === 'prices') {
        const fields = interaction.message.embeds[0]?.fields ?? [];
        const legacy = fields.find(item => item.name === '💰 Cennik');
        const summary = fields.filter(item => item.value.includes('**Cena:**')).map(item =>
          `**${item.name}**\n${item.value.slice(item.value.lastIndexOf('**Cena:**'))}`).join('\n\n');
        return await interaction.editReply({ content: summary || legacy?.value || 'Wycena indywidualna — napisz do bota i opisz zamówienie.', allowedMentions: { parse: [] } });
      }
      if (!['order', 'question'].includes(interaction.customId)) return await interaction.editReply('Nieznany przycisk.');
      try {
        await interaction.user.send(reasonMenu());
      } catch { return await interaction.editReply('Nie mogę wysłać Ci DM. Włącz prywatne wiadomości od członków serwera, a następnie napisz bezpośrednio do bota.'); }
      return await interaction.editReply('Wysłałem Ci DM. Wybierz kategorię sprawy, aby otworzyć zgłoszenie.');
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
        await user.send({ content: `**FivemShop • ${ticketLabel(match)}**\n${content ?? ''}`, files: attachment ? [attachment.url] : [] });
        await channel.send({ content: `**Obsługa (${interaction.user.username}) → klient:**\n${content ?? ''}${attachment ? `\n${attachment.url}` : ''}` });
        return await interaction.editReply('Odpowiedź wysłana na DM.');
      }
      if (interaction.commandName === 'zamknij') {
        await channel.setTopic(channel.topic.replace(/^pyku:(open|offer):/, `pyku:${match[1] === 'offer' ? 'closedoffer' : 'closed'}:`));
        await channel.setName(`zamkniety-${channel.id}`);
        const delivered = await user.send(`${BRAND}: zamknięto zgłoszenie ${channel.name}. Aby wrócić do oferty, kliknij ponownie jej przycisk. W sprawie usług napisz na DM lub skorzystaj z panelu.`).then(() => true, () => false);
        await channel.send(`Zgłoszenie zamknął ${interaction.user.username}. Kanał zachowano jako archiwum.`);
        await interaction.editReply(`Zgłoszenie zamknięte.${delivered ? '' : ' Nie udało się wysłać klientowi powiadomienia na DM.'}`);
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
client.login(DISCORD_TOKEN).catch(error => { console.error('Logowanie nieudane:', error.message); process.exitCode = 1; });

