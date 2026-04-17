require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  Events,
  PermissionFlagsBits,
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = process.env.BOT_PREFIX || '!';
const PANEL_COMMAND = process.env.PANEL_COMMAND || 'taxi';
const ADMIN_PANEL_COMMAND = process.env.ADMIN_PANEL_COMMAND || 'taxiadmin';
const DATA_FILE = path.join(__dirname, 'fares.json');

if (!TOKEN) {
  console.error('Hiányzó DISCORD_TOKEN a .env fájlban.');
  process.exit(1);
}

const zones = [
  'Tierra Robada',
  'San Fierro',
  'Angel Pine',
  'Flint County',
  'Red County',
  'Los Santos',
];

const defaultFares = {
  'Tierra Robada': {
    'Tierra Robada': 0,
    'San Fierro': 1800,
    'Angel Pine': 4200,
    'Flint County': 3600,
    'Red County': 3000,
    'Los Santos': 7600,
  },
  'San Fierro': {
    'Tierra Robada': 1800,
    'San Fierro': 0,
    'Angel Pine': 3000,
    'Flint County': 2800,
    'Red County': 2200,
    'Los Santos': 6400,
  },
  'Angel Pine': {
    'Tierra Robada': 4200,
    'San Fierro': 3000,
    'Angel Pine': 0,
    'Flint County': 1600,
    'Red County': 3400,
    'Los Santos': 4200,
  },
  'Flint County': {
    'Tierra Robada': 3600,
    'San Fierro': 2800,
    'Angel Pine': 1600,
    'Flint County': 0,
    'Red County': 2000,
    'Los Santos': 2600,
  },
  'Red County': {
    'Tierra Robada': 3000,
    'San Fierro': 2200,
    'Angel Pine': 3400,
    'Flint County': 2000,
    'Red County': 0,
    'Los Santos': 3200,
  },
  'Los Santos': {
    'Tierra Robada': 7600,
    'San Fierro': 6400,
    'Angel Pine': 4200,
    'Flint County': 2600,
    'Red County': 3200,
    'Los Santos': 0,
  },
};

function buildEmptyFareTable() {
  const table = {};
  for (const from of zones) {
    table[from] = {};
    for (const to of zones) {
      table[from][to] = 0;
    }
  }
  return table;
}

function normalizeFareTable(source) {
  const table = buildEmptyFareTable();
  for (const from of zones) {
    for (const to of zones) {
      if (from === to) {
        const sameZoneValue = Number(source?.[from]?.[to]);
        table[from][to] = Number.isFinite(sameZoneValue) ? sameZoneValue : 0;
        continue;
      }
      const a = Number(source?.[from]?.[to]);
      const b = Number(source?.[to]?.[from]);
      const value = Number.isFinite(a) ? a : Number.isFinite(b) ? b : 0;
      table[from][to] = value;
      table[to][from] = value;
    }
  }
  return table;
}

function loadFares() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const normalizedDefault = normalizeFareTable(defaultFares);
      fs.writeFileSync(DATA_FILE, JSON.stringify(normalizedDefault, null, 2), 'utf8');
      return normalizedDefault;
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return normalizeFareTable(JSON.parse(raw));
  } catch (error) {
    console.error('Nem sikerült betölteni a fares.json fájlt, alapértékek használata.', error);
    return normalizeFareTable(defaultFares);
  }
}

function saveFares(fares) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(normalizeFareTable(fares), null, 2), 'utf8');
}

let fares = loadFares();
const sessions = new Map();

function formatMoney(value) {
  return `${value.toLocaleString('hu-HU')} $`;
}

function hasAdminPermission(member) {
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

function createSession(messageId, ownerId, type) {
  sessions.set(messageId, {
    ownerId,
    type,
    from: null,
    to: null,
  });
}

function getSession(messageId) {
  return sessions.get(messageId);
}

function buildUserEmbed(state) {
  const from = state.from || '—';
  const to = state.to || '—';
  const hasBoth = Boolean(state.from && state.to);
  const price = hasBoth ? fares?.[state.from]?.[state.to] : null;

  return new EmbedBuilder()
    .setTitle('🚕 SeeMTA Taxi díjkalkulátor')
    .setDescription(
      [
        `**Indulási zóna:** ${from}`,
        `**Érkezési zóna:** ${to}`,
        '',
        hasBoth && typeof price === 'number'
          ? `**Fix fuvardíj:** ${formatMoney(price)}`
          : 'Válaszd ki a zónákat a lenti menükből, majd kattints a lekérdezés gombra.',
      ].join('\n')
    )
    .setFooter({ text: 'Fix zónás díjazás • Nincs felár • Nincs várakozási díj' })
    .setTimestamp();
}

function buildAdminEmbed(state) {
  const from = state.from || '—';
  const to = state.to || '—';
  const hasBoth = Boolean(state.from && state.to);
  const currentPrice = hasBoth ? fares?.[state.from]?.[state.to] : null;

  return new EmbedBuilder()
    .setTitle('🛠️ Taxi admin panel')
    .setDescription(
      [
        `**Szerkesztett indulási zóna:** ${from}`,
        `**Szerkesztett érkezési zóna:** ${to}`,
        '',
        hasBoth && typeof currentPrice === 'number'
          ? `**Jelenlegi ár:** ${formatMoney(currentPrice)}`
          : 'Válassz ki két zónát, majd a gombbal állíts be új árat.',
      ].join('\n')
    )
    .addFields({
      name: 'Működés',
      value: 'Az új ár oda-vissza irányban is elmentődik.',
    })
    .setFooter({ text: 'Csak adminok használhatják' })
    .setTimestamp();
}

function buildZoneMenus(userId, mode, state) {
  const fromMenu = new StringSelectMenuBuilder()
    .setCustomId(`taxi_${mode}_from_${userId}`)
    .setPlaceholder(state.from ? `Indulás: ${state.from}` : 'Válaszd ki az indulási zónát')
    .addOptions(
      zones.map((zone) => ({
        label: zone,
        value: zone,
        default: state.from === zone,
      }))
    );

  const toMenu = new StringSelectMenuBuilder()
    .setCustomId(`taxi_${mode}_to_${userId}`)
    .setPlaceholder(state.to ? `Érkezés: ${state.to}` : 'Válaszd ki az érkezési zónát')
    .addOptions(
      zones.map((zone) => ({
        label: zone,
        value: zone,
        default: state.to === zone,
      }))
    );

  return [
    new ActionRowBuilder().addComponents(fromMenu),
    new ActionRowBuilder().addComponents(toMenu),
  ];
}

function buildUserComponents(userId, state) {
  const rows = buildZoneMenus(userId, 'user', state);
  const quoteButton = new ButtonBuilder()
    .setCustomId(`taxi_user_quote_${userId}`)
    .setLabel('Fuvardíj lekérdezése')
    .setStyle(ButtonStyle.Success)
    .setDisabled(!(state.from && state.to));

  const resetButton = new ButtonBuilder()
    .setCustomId(`taxi_user_reset_${userId}`)
    .setLabel('Nullázás')
    .setStyle(ButtonStyle.Secondary);

  rows.push(new ActionRowBuilder().addComponents(quoteButton, resetButton));
  return rows;
}

function buildAdminComponents(userId, state) {
  const rows = buildZoneMenus(userId, 'admin', state);

  const editButton = new ButtonBuilder()
    .setCustomId(`taxi_admin_edit_${userId}`)
    .setLabel('Ár beállítása')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(!(state.from && state.to));

  const resetButton = new ButtonBuilder()
    .setCustomId(`taxi_admin_reset_${userId}`)
    .setLabel('Nullázás')
    .setStyle(ButtonStyle.Secondary);

  rows.push(new ActionRowBuilder().addComponents(editButton, resetButton));
  return rows;
}

async function sendUserPanel(message) {
  const initialState = { from: null, to: null };
  const sent = await message.channel.send({
    embeds: [buildUserEmbed(initialState)],
    components: buildUserComponents(message.author.id, initialState),
  });
  createSession(sent.id, message.author.id, 'user');
}

async function sendAdminPanel(message) {
  const initialState = { from: null, to: null };
  const sent = await message.channel.send({
    embeds: [buildAdminEmbed(initialState)],
    components: buildAdminComponents(message.author.id, initialState),
  });
  createSession(sent.id, message.author.id, 'admin');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, () => {
  console.log(`${client.user.tag} elindult.`);
  console.log(`Utas panel: ${PREFIX}${PANEL_COMMAND}`);
  console.log(`Admin panel: ${PREFIX}${ADMIN_PANEL_COMMAND}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim().toLowerCase();

  if (content === `${PREFIX}${PANEL_COMMAND}` || content === `${PREFIX}fuvardij`) {
    await sendUserPanel(message);
    return;
  }

  if (content === `${PREFIX}${ADMIN_PANEL_COMMAND}`) {
    if (!hasAdminPermission(message.member)) {
      await message.reply('Ehhez nincs jogosultságod.');
      return;
    }
    await sendAdminPanel(message);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isStringSelectMenu()) {
    const parts = interaction.customId.split('_');
    if (parts[0] !== 'taxi') return;

    const mode = parts[1];
    const action = parts[2];
    const ownerId = parts[3];
    const state = getSession(interaction.message.id);

    if (!state) {
      await interaction.reply({
        content: 'Ez a panel már lejárt vagy a bot újraindult. Nyiss újat.',
        ephemeral: true,
      });
      return;
    }

    if (interaction.user.id !== ownerId || interaction.user.id !== state.ownerId) {
      await interaction.reply({
        content: 'Ezt a panelt csak az használhatja, aki megnyitotta.',
        ephemeral: true,
      });
      return;
    }

    const value = interaction.values[0];
    if (action === 'from') state.from = value;
    if (action === 'to') state.to = value;

    await interaction.update({
      embeds: [mode === 'admin' ? buildAdminEmbed(state) : buildUserEmbed(state)],
      components: mode === 'admin' ? buildAdminComponents(ownerId, state) : buildUserComponents(ownerId, state),
    });
    return;
  }

  if (interaction.isButton()) {
    const parts = interaction.customId.split('_');
    if (parts[0] !== 'taxi') return;

    const mode = parts[1];
    const action = parts[2];
    const ownerId = parts[3];
    const state = getSession(interaction.message.id);

    if (!state) {
      await interaction.reply({
        content: 'Ez a panel már lejárt vagy a bot újraindult. Nyiss újat.',
        ephemeral: true,
      });
      return;
    }

    if (interaction.user.id !== ownerId || interaction.user.id !== state.ownerId) {
      await interaction.reply({
        content: 'Ezt a panelt csak az használhatja, aki megnyitotta.',
        ephemeral: true,
      });
      return;
    }

    if (mode === 'admin' && !hasAdminPermission(interaction.member)) {
      await interaction.reply({
        content: 'Ehhez nincs jogosultságod.',
        ephemeral: true,
      });
      return;
    }

    if (action === 'reset') {
      state.from = null;
      state.to = null;
      await interaction.update({
        embeds: [mode === 'admin' ? buildAdminEmbed(state) : buildUserEmbed(state)],
        components: mode === 'admin' ? buildAdminComponents(ownerId, state) : buildUserComponents(ownerId, state),
      });
      return;
    }

    if (mode === 'user' && action === 'quote') {
      if (!(state.from && state.to)) {
        await interaction.reply({
          content: 'Előbb válassz két zónát.',
          ephemeral: true,
        });
        return;
      }

      const price = fares?.[state.from]?.[state.to];
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('✅ Lekért fuvardíj')
            .setDescription(
              `**Honnan:** ${state.from}\n**Hová:** ${state.to}\n**Ár:** ${formatMoney(price)}`
            )
            .setFooter({ text: 'SeeMTA v4 • Zónás fix díjazás' })
            .setTimestamp(),
        ],
        ephemeral: true,
      });
      return;
    }

    if (mode === 'admin' && action === 'edit') {
      if (!(state.from && state.to)) {
        await interaction.reply({
          content: 'Előbb válassz két zónát.',
          ephemeral: true,
        });
        return;
      }

      const currentPrice = fares?.[state.from]?.[state.to] ?? 0;
      const modal = new ModalBuilder()
        .setCustomId(`taxi_modal_price_${interaction.message.id}`)
        .setTitle('Fuvardíj módosítása');

      const priceInput = new TextInputBuilder()
        .setCustomId('price')
        .setLabel(`${state.from} ↔ ${state.to} új ára`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Példa: 6500')
        .setRequired(true)
        .setValue(String(currentPrice));

      modal.addComponents(new ActionRowBuilder().addComponents(priceInput));
      await interaction.showModal(modal);
      return;
    }
  }

  if (interaction.isModalSubmit()) {
    const parts = interaction.customId.split('_');
    if (parts[0] !== 'taxi' || parts[1] !== 'modal') return;

    const messageId = parts[3];
    const state = getSession(messageId);

    if (!state) {
      await interaction.reply({
        content: 'Ez a szerkesztő panel már lejárt.',
        ephemeral: true,
      });
      return;
    }

    if (interaction.user.id !== state.ownerId) {
      await interaction.reply({
        content: 'Ezt a szerkesztő panelt csak a létrehozó használhatja.',
        ephemeral: true,
      });
      return;
    }

    if (!hasAdminPermission(interaction.member)) {
      await interaction.reply({
        content: 'Ehhez nincs jogosultságod.',
        ephemeral: true,
      });
      return;
    }

    const raw = interaction.fields.getTextInputValue('price').trim().replace(/\s+/g, '').replace(',', '.');
    const price = Number(raw);

    if (!Number.isFinite(price) || price < 0) {
      await interaction.reply({
        content: 'Az ár csak 0 vagy pozitív szám lehet.',
        ephemeral: true,
      });
      return;
    }

    fares[state.from][state.to] = price;
    fares[state.to][state.from] = price;
    saveFares(fares);

    try {
      const originalMessage = await interaction.channel.messages.fetch(messageId);
      await originalMessage.edit({
        embeds: [buildAdminEmbed(state)],
        components: buildAdminComponents(state.ownerId, state),
      });
    } catch (error) {
      console.error('Nem sikerült frissíteni az admin panel üzenetét:', error);
    }

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('✅ Fuvardíj frissítve')
          .setDescription(`**Útvonal:** ${state.from} ↔ ${state.to}\n**Új ár:** ${formatMoney(price)}`)
          .setFooter({ text: 'A módosítás mentve lett a fares.json fájlba.' })
          .setTimestamp(),
      ],
      ephemeral: true,
    });
  }
});

client.login(TOKEN).catch((error) => {
  console.error('Indítási hiba:', error);
  process.exit(1);
});
