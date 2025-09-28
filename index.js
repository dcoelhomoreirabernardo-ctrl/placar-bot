import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder
} from 'discord.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Keepalive (útil pra host tipo Glitch/Replit)
const app = express();
app.get('/', (_, res) => res.send('Placar bot ON'));
app.listen(3000, () => console.log('Keepalive em http://localhost:3000'));

// Persistência simples em arquivo
const DB_FILE = path.join(__dirname, 'state.json');
function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return {}; }
}
function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
const db = readDB(); // { "<guildId>": { "<channelId>": { messageId, state } } }

function defaultState() {
  return {
    home: { name: 'Time Casa', emoji: '🦈', goals: 0 },
    away: { name: 'Time Fora', emoji: '🦅', goals: 0 },
    period: 1,
    clock: '00:00',
    status: 'Aguardando início'
  };
}
function getState(gid, cid) {
  db[gid] ??= {};
  db[gid][cid] ??= { messageId: null, state: defaultState() };
  return db[gid][cid];
}
function saveState() { writeDB(db); }

function renderEmbed(st) {
  const desc =
`${st.home.emoji} **${st.home.name}** — Gols: ${st.home.goals}
⚡ vs
${st.away.emoji} **${st.away.name}** — Gols: ${st.away.goals}

🕒 Tempo: ${st.period}º • ${st.clock}
${st.status ? `**Status:** ${st.status}` : ''}`.trim();

  return new EmbedBuilder()
    .setTitle('Placar Oficial')
    .setDescription(desc)
    .setColor(0x5865F2)
    .setTimestamp(Date.now());
}

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Testa o bot'),
  new SlashCommandBuilder()
    .setName('placar')
    .setDescription('Placar fixo que o bot edita')
    .addSubcommand(sc => sc.setName('show').setDescription('Cria/mostra o placar neste canal'))
    .addSubcommand(sc => sc
      .setName('set').setDescription('Define/atualiza dados do placar')
      .addStringOption(o => o.setName('home_name').setDescription('Nome casa'))
      .addStringOption(o => o.setName('home_emoji').setDescription('Emoji casa'))
      .addIntegerOption(o => o.setName('home_goals').setDescription('Gols casa'))
      .addStringOption(o => o.setName('away_name').setDescription('Nome fora'))
      .addStringOption(o => o.setName('away_emoji').setDescription('Emoji fora'))
      .addIntegerOption(o => o.setName('away_goals').setDescription('Gols fora'))
      .addIntegerOption(o => o.setName('period').setDescription('Período (nº)'))
      .addStringOption(o => o.setName('clock').setDescription('Relógio MM:SS'))
      .addStringOption(o => o.setName('status').setDescription('Status livre')))
    .addSubcommand(sc => sc
      .setName('goal').setDescription('Incrementa/Decrementa gols')
      .addStringOption(o => o.setName('side').setDescription('home/away').setRequired(true)
        .addChoices({name:'home', value:'home'}, {name:'away', value:'away'}))
      .addIntegerOption(o => o.setName('delta').setDescription('+1, -1, +2...')))
    .addSubcommand(sc => sc
      .setName('time').setDescription('Ajusta período/relógio/status')
      .addIntegerOption(o => o.setName('period').setDescription('Período (nº)'))
      .addStringOption(o => o.setName('clock').setDescription('Relógio MM:SS'))
      .addStringOption(o => o.setName('status').setDescription('Status livre')))
    .addSubcommand(sc => sc.setName('reset').setDescription('Zera tudo'))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
async function registerCommands() {
  const clientId = process.env.CLIENT_ID;
  const guildId  = process.env.GUILD_ID;
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log('✅ Comandos registrados na guild (instantâneo)');
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log('✅ Comandos globais registrados (propagam em alguns minutos)');
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
client.once('ready', () => console.log(`🤖 Logado como ${client.user.tag}`));

client.on('interactionCreate', async (intr) => {
  try {
    if (!intr.isChatInputCommand()) return;
    const gid = intr.guildId;
    const cid = intr.channelId;
    const entry = getState(gid, cid);

    if (intr.commandName === 'ping') {
      return intr.reply({ content: '🏓 Pong!', ephemeral: true });
    }
    if (intr.commandName !== 'placar') return;

    const sub = intr.options.getSubcommand();

    if (sub === 'show') {
      const embed = renderEmbed(entry.state);
      if (!entry.messageId) {
        const msg = await intr.channel.send({ embeds: [embed] });
        entry.messageId = msg.id;
        saveState();
      } else {
        try {
          const msg = await intr.channel.messages.fetch(entry.messageId);
          await msg.edit({ embeds: [embed] });
        } catch {
          const msg = await intr.channel.send({ embeds: [embed] });
          entry.messageId = msg.id;
          saveState();
        }
      }
      return intr.reply({ content: '📣 Placar pronto/atualizado!', ephemeral: true });
    }

    if (sub === 'set') {
      const st = entry.state;
      const v = (name) => intr.options.getString(name) ?? undefined;
      const n = (name) => intr.options.getInteger(name) ?? undefined;

      st.home.name  = v('home_name')  ?? st.home.name;
      st.home.emoji = v('home_emoji') ?? st.home.emoji;
      st.home.goals = n('home_goals') ?? st.home.goals;

      st.away.name  = v('away_name')  ?? st.away.name;
      st.away.emoji = v('away_emoji') ?? st.away.emoji;
      st.away.goals = n('away_goals') ?? st.away.goals;

      st.period     = n('period')     ?? st.period;
      st.clock      = v('clock')      ?? st.clock;
      st.status     = v('status')     ?? st.status;

      saveState();
      const embed = renderEmbed(st);
      await ensureMessageEdited(intr, entry, embed);
      return intr.reply({ content: '✅ Placar atualizado!', ephemeral: true });
    }

    if (sub === 'goal') {
      const side  = intr.options.getString('side', true);
      const delta = intr.options.getInteger('delta') ?? 1;
      const st = entry.state;
      if (side === 'home') st.home.goals = Math.max(0, st.home.goals + delta);
      else st.away.goals = Math.max(0, st.away.goals + delta);
      saveState();
      const embed = renderEmbed(st);
      await ensureMessageEdited(intr, entry, embed);
      return intr.reply({ content: '⚽ Atualizado!', ephemeral: true });
    }

    if (sub === 'time') {
      const st = entry.state;
      const p  = intr.options.getInteger('period');
      const cl = intr.options.getString('clock');
      const stt= intr.options.getString('status');
      if (p  !== null) st.period = p;
      if (cl !== null) st.clock  = cl;
      if (stt!== null) st.status = stt;
      saveState();
      const embed = renderEmbed(st);
      await ensureMessageEdited(intr, entry, embed);
      return intr.reply({ content: '⏱️ Tempo ajustado!', ephemeral: true });
    }

    if (sub === 'reset') {
      entry.state = defaultState();
      saveState();
      const embed = renderEmbed(entry.state);
      await ensureMessageEdited(intr, entry, embed);
      return intr.reply({ content: '♻️ Resetado!', ephemeral: true });
    }
  } catch (err) {
    console.error(err);
    try {
      if (intr.deferred || intr.replied) {
        await intr.followUp({ content: `❌ Erro: ${String(err).slice(0, 1900)}`, ephemeral: true });
      } else {
        await intr.reply({ content: `❌ Erro: ${String(err).slice(0, 1900)}`, ephemeral: true });
      }
    } catch {}
  }
});

async function ensureMessageEdited(intr, entry, embed) {
  if (!entry.messageId) {
    const msg = await intr.channel.send({ embeds: [embed] });
    entry.messageId = msg.id;
    saveState();
  } else {
    try {
      const msg = await intr.channel.messages.fetch(entry.messageId);
      await msg.edit({ embeds: [embed] });
    } catch {
      const msg = await intr.channel.send({ embeds: [embed] });
      entry.messageId = msg.id;
      saveState();
    }
  }
}

await registerCommands();
client.login(process.env.TOKEN);
