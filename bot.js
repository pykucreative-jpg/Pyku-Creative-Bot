import {
  Client, Events, GatewayIntentBits, Partials, ChannelType, PermissionFlagsBits as P,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder,
  MessageFlags,
} from 'discord.js';

const OWNER_ID = '795755381744861184';
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
const activeTopic = id => `pyku:open:${id}`;
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
const commands = [
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
    { id: client.user.id, type: 1, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels, P.AttachFiles, P.EmbedLinks] },
  ];
}
async function ticket(user) {
  const { guild, channels } = await guildAndChannels();
  const existing = channels.find(c => c?.type === ChannelType.GuildText && c.topic === activeTopic(user.id));
  if (existing) return existing;
  const overwrites = privateOverwrites(guild);
  let category = channels.find(c => c?.type === ChannelType.GuildCategory && c.name === CATEGORY);
  if (!category) category = await guild.channels.create({ name: CATEGORY, type: ChannelType.GuildCategory, permissionOverwrites: overwrites });
  const channel = await guild.channels.create({
    name: `ticket-${user.id}`, type: ChannelType.GuildText, parent: category.id,
    topic: activeTopic(user.id), permissionOverwrites: overwrites,
  });
  await channel.send(`Nowe zgłoszenie: ${user.username} (${user.id}).\nWiadomości i załączniki obsługi na tym kanale automatycznie trafiają klientowi na DM.\n/zamknij kończy rozmowę i zachowuje archiwum.`);
  return channel;
}

client.once(Events.ClientReady, async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.members.fetch(OWNER_ID);
    const channels = await guild.channels.fetch();
    for (const channel of channels.values()) {
      if (channel && ((channel.type === ChannelType.GuildCategory && channel.name === CATEGORY)
        || (channel.type === ChannelType.GuildText && /^pyku:(open|closed):\d+$/.test(channel.topic ?? '')))) {
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
    if (message.author.id !== OWNER_ID || message.guildId !== GUILD_ID || !/^pyku:open:\d+$/.test(message.channel.topic ?? '')) return;
    serial('tickets', async () => {
      const channel = await message.guild.channels.fetch(message.channelId);
      const match = /^pyku:open:(\d+)$/.exec(channel?.topic ?? '');
      if (!match) return;
      if (!message.content && !message.attachments.size) return;
      const user = await client.users.fetch(match[1]);
      const prefix = `**${BRAND}**\n`;
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
    const channel = await ticket(message.author);
    const text = message.content || '(załącznik / wiadomość bez tekstu)';
    const links = [...message.attachments.values()].map(a => a.url);
    await channel.send({ content: `**Klient:**\n${text}`.slice(0, 2000) });
    for (const url of links) await channel.send({ content: url });
    await message.reply('Wiadomość trafiła do P.Y.K.U CREATIVE. Odpowiedź otrzymasz tutaj. Opisz usługę, wymagania i dołącz inspiracje. Cena i termin zostaną ustalone indywidualnie.');
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
      if (interaction.customId === 'prices') {
        const fields = interaction.message.embeds[0]?.fields ?? [];
        const legacy = fields.find(item => item.name === '💰 Cennik');
        const summary = fields.filter(item => item.value.includes('**Cena:**')).map(item =>
          `**${item.name}**\n${item.value.slice(item.value.lastIndexOf('**Cena:**'))}`).join('\n\n');
        return await interaction.editReply({ content: summary || legacy?.value || 'Wycena indywidualna — napisz do bota i opisz zamówienie.', allowedMentions: { parse: [] } });
      }
      if (!['order', 'question'].includes(interaction.customId)) return await interaction.editReply('Nieznany przycisk.');
      try {
        await interaction.user.send(`Witaj w ${BRAND}! Napisz, czego potrzebujesz: skiny do broni, mody/citizen, ubrania do FiveM lub optymalizacja komputera.\nPodaj wymagania i inspiracje. Twoja wiadomość otworzy prywatne zgłoszenie widoczne dla obsługi serwera. Odpowiedzi otrzymasz tutaj.`);
        return await interaction.editReply('Wysłałem Ci DM. Odpowiedz na niego, aby otworzyć zgłoszenie.');
      } catch { return await interaction.editReply('Nie mogę wysłać Ci DM. Włącz prywatne wiadomości od członków serwera, a następnie napisz bezpośrednio do bota.'); }
    }
    if (interaction.guildId !== GUILD_ID) return await interaction.editReply('Ta komenda działa wyłącznie na serwerze P.Y.K.U CREATIVE.');
    if (interaction.user.id !== OWNER_ID) return await interaction.editReply('Tylko właściciel P.Y.K.U CREATIVE może używać komend obsługi.');
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
      const match = /^pyku:open:(\d+)$/.exec(channel?.topic ?? '');
      if (!match) return await interaction.editReply('Użyj tej komendy na kanale aktywnego zgłoszenia.');
      const user = await client.users.fetch(match[1]);
      if (interaction.commandName === 'odpowiedz') {
        const content = interaction.options.getString('tresc');
        const attachment = interaction.options.getAttachment('plik');
        if (!content && !attachment) return await interaction.editReply('Podaj treść lub plik.');
        await user.send({ content: `**${BRAND}**\n${content ?? ''}`, files: attachment ? [attachment.url] : [] });
        await channel.send({ content: `**Obsługa (${interaction.user.username}) → klient:**\n${content ?? ''}${attachment ? `\n${attachment.url}` : ''}` });
        return await interaction.editReply('Odpowiedź wysłana na DM.');
      }
      if (interaction.commandName === 'zamknij') {
        await channel.setTopic(`pyku:closed:${user.id}`);
        await channel.setName(`zamkniety-${channel.id}`);
        const delivered = await user.send(`${BRAND}: zgłoszenie zostało zamknięte. Nowa wiadomość do bota otworzy kolejne.`).then(() => true, () => false);
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
