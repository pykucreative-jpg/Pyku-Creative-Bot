import {
  Client, Events, GatewayIntentBits, Partials, ChannelType, PermissionFlagsBits as P,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder,
  MessageFlags,
} from 'discord.js';

const OWNER_ID = '795755381744861184';
const SUPPORT_ROLE_ID = '1562454115206955059';
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
const CATEGORY = 'PYKU • ZGŁOSZENIA';
const OFFER_CATEGORY = 'PYKU • TICKETY Z OFERT';
const activeTopic = (id, offerId) => offerId ? `pyku:offer:${id}:${offerId}` : `pyku:open:${id}`;
const activeTicket = topic => /^pyku:(open|offer):(\d+)(?::(\d+))?$/.exec(topic ?? '');
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
  if (userId === OWNER_ID) return true;
  const member = await guild.members.fetch(userId);
  return member.roles.cache.has(SUPPORT_ROLE_ID);
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
const commands = [
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
function privateOverwrites(guild) {
  return [
    { id: guild.id, deny: [P.ViewChannel] },
    { id: OWNER_ID, type: 1, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.UseApplicationCommands] },
    { id: SUPPORT_ROLE_ID, type: 0, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.UseApplicationCommands] },
    { id: client.user.id, type: 1, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels, P.AttachFiles, P.EmbedLinks] },
  ];
}
async function ticket(user, offerId) {
  const { guild, channels } = await guildAndChannels();
  const existing = channels.find(c => c?.type === ChannelType.GuildText && c.topic === activeTopic(user.id, offerId));
  if (existing) return existing;
  const overwrites = privateOverwrites(guild);
  const categoryName = offerId ? OFFER_CATEGORY : CATEGORY;
  let category = channels.find(c => c?.type === ChannelType.GuildCategory && c.name === categoryName);
  if (!category) category = await guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory, permissionOverwrites: overwrites });
  const channel = await guild.channels.create({
    name: `${offerId ? 'oferta' : 'uslugi'}-${user.id}${offerId ? `-${offerId.slice(-6)}` : ''}`, type: ChannelType.GuildText, parent: category.id,
    topic: activeTopic(user.id, offerId), permissionOverwrites: overwrites,
  });
  await channel.send(`Nowe zgłoszenie: ${user.username} (${user.id}).\nWiadomości i załączniki obsługi na tym kanale automatycznie trafiają klientowi na DM.\n/zamknij kończy rozmowę i zachowuje archiwum.`);
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
      if (channel && ((channel.type === ChannelType.GuildCategory && [CATEGORY, OFFER_CATEGORY].includes(channel.name))
        || (channel.type === ChannelType.GuildText && /^pyku:(open|offer|closed|closedoffer):\d+(?::\d+)?$/.test(channel.topic ?? '')))) {
        await channel.permissionOverwrites.set(privateOverwrites(guild));
      }
    }
    await guild.commands.set(commands);
    console.log(`${BRAND}: bot działa jako ${client.user.tag}`);
  } catch (error) { console.error('Nie udało się uruchomić konfiguracji:', error.message); client.destroy(); process.exitCode = 1; }
});

client.on(Events.MessageCreate, message => {
  if (message.author.bot || message.webhookId) return;
  if (message.guildId) {
    if (message.guildId !== GUILD_ID || !activeTicket(message.channel.topic)) return;
    serial('tickets', async () => {
      if (!await canOperate(message.author.id, message.guild)) return;
      const channel = await message.guild.channels.fetch(message.channelId);
      const match = activeTicket(channel?.topic);
      if (!match) return;
      if (!message.content && !message.attachments.size) return;
      const user = await client.users.fetch(match[2]);
      const prefix = `**${BRAND} • ${match[1] === 'offer' ? `Oferta ${match[3].slice(-6)}` : 'Usługi'}**\n`;
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
    if (active.length > 1) {
      const rows = [];
      for (let i = 0; i < active.length; i += 5) rows.push(new ActionRowBuilder().addComponents(active.slice(i, i + 5).map(channel =>
        new ButtonBuilder().setCustomId(`route:${channel.id}:${message.id}`).setLabel(channel.name.slice(0, 80)).setStyle(ButtonStyle.Secondary))));
      if (rows.length > 5) return await message.reply('Masz zbyt wiele aktywnych rozmów. Poproś obsługę o zamknięcie zakończonych zgłoszeń.');
      await message.reply({ content: 'Do której rozmowy przekazać tę wiadomość? Wybierz zgłoszenie:', components: rows });
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

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton() && !interaction.isChatInputCommand()) return;
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (interaction.isButton()) {
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
        if (source.author.id !== client.user.id || !source.embeds[0]?.title) return await interaction.editReply('Nie znaleziono oferty.');
        const title = source.embeds[0].title;
        const price = source.embeds[0].fields.find(f => f.name === '💰 Cena')?.value ?? 'Do ustalenia';
        try {
          await interaction.user.send({ content: `**${BRAND} — ${title}**\nCena: ${price}\n${source.url}\n\nTwoje zapytanie trafi do obsługi. Napisz tutaj, co chcesz zamówić lub o co zapytać.`, allowedMentions: { parse: [] } });
        } catch { return await interaction.editReply('Włącz DM od członków serwera i kliknij ponownie.'); }
        await serial('tickets', async () => {
          const channel = await ticket(interaction.user, source.id);
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
        await interaction.user.send(`Witaj w ${BRAND}! Napisz, czego potrzebujesz: skiny do broni, mody/citizen, ubrania do FiveM lub optymalizacja komputera.\nPodaj wymagania i inspiracje. Otwieramy dla Ciebie osobne zgłoszenie dotyczące usług. Jeśli masz kilka rozmów, po wysłaniu wiadomości wybierz właściwe zgłoszenie.`);
      } catch { return await interaction.editReply('Nie mogę wysłać Ci DM. Włącz prywatne wiadomości od członków serwera, a następnie napisz bezpośrednio do bota.'); }
      await serial('tickets', () => ticket(interaction.user));
      return await interaction.editReply('Otwarto zgłoszenie dotyczące usług. Napisz do bota na DM.');
    }
    if (interaction.guildId !== GUILD_ID) return await interaction.editReply('Ta komenda działa wyłącznie na serwerze P.Y.K.U CREATIVE.');
    if (!await canOperate(interaction.user.id, interaction.guild)) return await interaction.editReply('Komendy są dostępne dla właściciela i rangi obsługi P.Y.K.U CREATIVE.');
    if (interaction.commandName === 'oferta') {
      const destination = interaction.options.getChannel('kanal') ?? interaction.channel;
      if (destination.type !== ChannelType.GuildText) return await interaction.editReply('Wybierz zwykły kanał tekstowy w polu kanal.');
      if (!destination.permissionsFor(interaction.member)?.has([P.ViewChannel, P.SendMessages])) return await interaction.editReply('Nie masz uprawnień do publikacji na tym kanale.');
      const name = interaction.options.getString('nazwa').trim();
      const description = interaction.options.getString('opis').trim().replaceAll('\\n', '\n');
      const price = interaction.options.getString('cena').trim();
      const cars = interaction.options.getString('dzial') === 'auta';
      if (!name || !description || !price) return await interaction.editReply('Nazwa, opis i cena nie mogą być puste.');
      let photos;
      try { photos = photosFrom(interaction); } catch (error) { return await interaction.editReply(error.message); }
      const card = new EmbedBuilder().setColor(0xa855f7).setAuthor({ name: BRAND })
        .setTitle(name).setDescription(description).addFields({ name: '💰 Cena', value: price },
          { name: '📩 Kontakt i zamówienia', value: 'Kliknij przycisk poniżej — porozmawiamy prywatnie przez bota.' })
        .setFooter({ text: `${BRAND} • ${cars ? 'Auta FiveM' : 'Oferta FiveM'}` });
      const sent = await destination.send({ ...imagePayload(photos, card), components: [contactButton('offer_contact', cars)] });
      return await interaction.editReply(`Oferta opublikowana: ${sent.url}\nID oferty do dodania kolejnych zdjęć: ${sent.id}`);
    }
    if (interaction.commandName === 'zdjecia') {
      const id = interaction.options.getString('oferta_id').trim();
      if (!/^\d+$/.test(id)) return await interaction.editReply('Podaj ID wiadomości oferty.');
      const source = await interaction.channel.messages.fetch(id);
      if (source.author.id !== client.user.id || !source.components.some(row => row.components.some(c => c.customId === 'offer_contact'))) return await interaction.editReply('To nie jest oferta utworzona przez /oferta na tym kanale.');
      let photos;
      try { photos = photosFrom(interaction); } catch (error) { return await interaction.editReply(error.message); }
      const card = new EmbedBuilder().setColor(0xa855f7).setTitle(source.embeds[0].title)
        .setDescription(`[Zobacz ofertę i cenę](${source.url})`).setFooter({ text: `${BRAND} • Galeria oferty` });
      await interaction.channel.send({ ...imagePayload(photos, card), components: [contactButton(`offer_ref:${source.channelId}:${source.id}`, source.embeds[0].footer?.text.includes('Auta FiveM'))] });
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
      const user = await client.users.fetch(match[2]);
      if (interaction.commandName === 'odpowiedz') {
        const content = interaction.options.getString('tresc');
        const attachment = interaction.options.getAttachment('plik');
        if (!content && !attachment) return await interaction.editReply('Podaj treść lub plik.');
        await user.send({ content: `**${BRAND} • ${match[1] === 'offer' ? `Oferta ${match[3].slice(-6)}` : 'Usługi'}**\n${content ?? ''}`, files: attachment ? [attachment.url] : [] });
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
