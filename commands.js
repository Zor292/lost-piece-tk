const {
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  AttachmentBuilder,
} = require('discord.js');
const config = require('./config');
const db = require('./database');

const openTickets = new Map();

async function loadOpenTickets() {
  try {
    const tickets = await db.getAllOpenTickets(process.env.GUILD_ID);
    for (const t of tickets) {
      openTickets.set(t.channelId, {
        type: t.type,
        ownerId: t.ownerId,
        claimedBy: t.claimedBy,
        openedAt: t.openedAt,
        number: t.number,
      });
    }
    console.log(`[DB] Loaded ${tickets.length} open tickets`);
  } catch (err) {
    console.error('[DB] Failed to load tickets:', err.message);
  }
}

function buildTicketButtons(channelId, claimedBy) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket_senior_${channelId}`).setLabel('استدعاء عليا').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ticket_support_${channelId}`).setLabel('استدعاء سبورت').setStyle(ButtonStyle.Secondary),
    claimedBy
      ? new ButtonBuilder().setCustomId(`ticket_unclaim_${channelId}`).setLabel('فك الاستلام').setStyle(ButtonStyle.Danger)
      : new ButtonBuilder().setCustomId(`ticket_claim_${channelId}`).setLabel('استلام تكت').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ticket_close_${channelId}`).setLabel('اغلاق').setStyle(ButtonStyle.Danger)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ticket_manage_${channelId}`)
      .setPlaceholder('تعديل التذكرة')
      .addOptions([
        { label: 'استدعاء صاحب التذكرة', value: 'call_owner' },
        { label: 'تعديل اسم التذكرة', value: 'rename' },
        { label: 'اضافة عضو للتذكرة', value: 'add_member' },
        { label: 'ازالة عضو من التذكرة', value: 'remove_member' },
      ])
  );

  return [row1, row2];
}

async function createTicket(interaction, ticketType) {
  const guild = interaction.guild;
  const user = interaction.user;
  const typeConfig = config.TICKET_TYPES[ticketType];
  if (!typeConfig) return;

  const existing = [...openTickets.values()].find(t => t.ownerId === user.id && t.type === ticketType);
  if (existing) {
    await interaction.editReply({ content: 'لديك تكت مفتوح من هذا النوع بالفعل.' });
    return;
  }

  const ticketNum = await db.getNextTicketNumber();
  const cleanUsername = user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';
  const channelName = `ticket-${ticketNum}-${cleanUsername}`;

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: config.TICKET_CATEGORY_ID,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
        ],
      },
      {
        id: typeConfig.adminRole,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.AttachFiles,
        ],
      },
    ],
  });

  await db.saveTicket({
    channelId: channel.id,
    guildId: guild.id,
    type: ticketType,
    ownerId: user.id,
    number: ticketNum,
  });

  openTickets.set(channel.id, {
    type: ticketType,
    ownerId: user.id,
    claimedBy: null,
    openedAt: new Date(),
    number: ticketNum,
    mainMessageId: null,
  });

  const embed = new EmbedBuilder()
    .setTitle(typeConfig.title)
    .setDescription(config.RULES_DESCRIPTION)
    .setImage(config.IMAGE_URL)
    .setColor(config.EMBED_COLOR)
    .setFooter({ text: 'Developed by firas' })
    .setTimestamp();

  const components = buildTicketButtons(channel.id, null);

  const mainMsg = await channel.send({
    content: `<@${user.id}> <@&${typeConfig.adminRole}>`,
    embeds: [embed],
    components,
  });

  const ticketData = openTickets.get(channel.id);
  ticketData.mainMessageId = mainMsg.id;
  openTickets.set(channel.id, ticketData);

  await interaction.editReply({ content: `تم فتح التكت: ${channel}` });
}

async function closeTicket(interaction, channelId) {
  const channel = interaction.guild.channels.cache.get(channelId);
  if (!channel) return;
  const ticketData = openTickets.get(channelId);
  if (!ticketData) return;

  const messages = await channel.messages.fetch({ limit: 100 });
  const sorted = [...messages.values()].reverse();
  const htmlContent = generateTranscriptHTML(sorted, ticketData, channel.name);

  await db.closeTicketDB(channelId, interaction.user.id);

  const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNEL_ID);
  if (logChannel) {
    const typeConfig = config.TICKET_TYPES[ticketData.type];
    const logEmbed = new EmbedBuilder()
      .setTitle('تم اغلاق تكت')
      .addFields(
        { name: 'رقم التكت', value: `#${ticketData.number}`, inline: true },
        { name: 'صاحب التكت', value: `<@${ticketData.ownerId}>`, inline: true },
        { name: 'النوع', value: typeConfig?.label || ticketData.type, inline: true },
        { name: 'اغلق بواسطة', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'مستلم التكت', value: ticketData.claimedBy ? `<@${ticketData.claimedBy}>` : 'لم يستلم', inline: true },
        { name: 'اسم القناة', value: channel.name, inline: true },
      )
      .setColor(0xe74c3c)
      .setFooter({ text: 'Developed by firas' })
      .setTimestamp();

    const buf = Buffer.from(htmlContent, 'utf-8');
    const attachment = new AttachmentBuilder(buf, { name: `transcript-${channel.name}.html` });
    await logChannel.send({ embeds: [logEmbed], files: [attachment] });
  }

  try {
    const ownerUser = await interaction.client.users.fetch(ticketData.ownerId);
    const dmEmbed = new EmbedBuilder()
      .setTitle('تم اغلاق تكتك')
      .setDescription('هل تم حل مشكلتك؟')
      .setColor(config.EMBED_COLOR)
      .setFooter({ text: 'Developed by firas' })
      .setTimestamp();

    const dmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rating_yes_${ticketData.claimedBy || 'none'}_${ticketData.number}`)
        .setLabel('نعم')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`rating_no_${ticketData.claimedBy || 'none'}_${ticketData.number}`)
        .setLabel('لا')
        .setStyle(ButtonStyle.Danger)
    );

    await ownerUser.send({ embeds: [dmEmbed], components: [dmRow] });
  } catch {}

  openTickets.delete(channelId);

  await interaction.channel.send({
    embeds: [new EmbedBuilder()
      .setDescription('جاري اغلاق التكت...')
      .setColor(0xe74c3c)
      .setFooter({ text: 'Developed by firas' })]
  });

  setTimeout(() => channel.delete().catch(() => {}), 3000);
}

function generateTranscriptHTML(messages, ticketData, channelName) {
  const typeConfig = config.TICKET_TYPES[ticketData.type];

  function getUserColor(userId) {
    const colors = ['#7289da', '#43b581', '#faa61a', '#f04747', '#b9bbbe', '#99aab5', '#5865f2', '#eb459e', '#3ba55c', '#ed4245'];
    let hash = 0;
    for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  function getAvatar(msg) {
    try {
      if (msg.author.displayAvatarURL) return msg.author.displayAvatarURL({ extension: 'png', size: 64 });
    } catch {}
    return `https://cdn.discordapp.com/embed/avatars/0.png`;
  }

  function formatTime(date) {
    return date.toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  }

  function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderContent(content) {
    if (!content) return '';
    let html = escapeHtml(content);
    html = html.replace(/&lt;@!?(\d+)&gt;/g, '<span class="mention">@$1</span>');
    html = html.replace(/&lt;@&amp;(\d+)&gt;/g, '<span class="mention role-mention">@role</span>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    return html;
  }

  const groupedMessages = [];
  let lastAuthorId = null;
  let lastTime = null;
  for (const msg of messages) {
    const timeDiff = lastTime ? (msg.createdAt - lastTime) / 60000 : 999;
    if (msg.author.id === lastAuthorId && timeDiff < 7) {
      groupedMessages[groupedMessages.length - 1].msgs.push(msg);
    } else {
      groupedMessages.push({ author: msg.author, msgs: [msg] });
      lastAuthorId = msg.author.id;
    }
    lastTime = msg.createdAt;
  }

  const rows = groupedMessages.map(group => {
    const author = group.author;
    const firstMsg = group.msgs[0];
    const color = getUserColor(author.id);
    const avatar = getAvatar(firstMsg);

    const msgLines = group.msgs.map(msg => {
      const content = renderContent(msg.content);
      return `<div class="msg-line">${content ? `<div class="msg-text">${content}</div>` : ''}</div>`;
    }).join('');

    return `<div class="message-group">
      <img class="avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(author.username)}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'"/>
      <div class="msg-right">
        <div class="msg-header">
          <span class="username" style="color:${color}">${escapeHtml(author.username)}${author.bot ? '<span class="bot-tag">BOT</span>' : ''}</span>
          <span class="timestamp">${formatTime(firstMsg.createdAt)}</span>
        </div>
        ${msgLines}
      </div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="ar"><head><meta charset="UTF-8"/><title>Transcript - ${escapeHtml(channelName)}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;background:#313338;color:#dcddde;font-size:16px}
.header{background:#2b2d31;padding:12px 16px;border-bottom:1px solid #1e1f22}.header-channel{font-weight:700;color:#f2f3f5}
.info-bar{background:#2b2d31;padding:8px 16px;border-bottom:1px solid #1e1f22;font-size:12px;color:#b5bac1;display:flex;gap:20px;flex-wrap:wrap}
.info-bar strong{color:#e3e5e8}.messages-wrap{padding:16px}
.message-group{display:flex;gap:16px;padding:4px 0}.avatar{width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0}
.msg-right{flex:1}.msg-header{display:flex;align-items:baseline;gap:8px;margin-bottom:2px}
.username{font-weight:500}.bot-tag{background:#5865f2;color:#fff;font-size:10px;padding:1px 4px;border-radius:3px;margin-left:4px}
.timestamp{color:#a3a6aa;font-size:.75rem}.msg-text{color:#dcddde;word-break:break-word;white-space:pre-wrap}
.msg-text strong{font-weight:700}.msg-text code{background:#2e3035;border-radius:3px;padding:0 4px;font-family:monospace}
.mention{color:#c9cdfb;background:rgba(88,101,242,.3);border-radius:3px;padding:0 2px}
.footer{text-align:center;padding:16px;color:#a3a6aa;font-size:.75rem;border-top:1px solid #3f4147;margin-top:8px}
</style></head><body>
<div class="header"><span class="header-channel"># ${escapeHtml(channelName)}</span></div>
<div class="info-bar">
<span>رقم التكت: <strong>#${ticketData.number}</strong></span>
<span>صاحب التكت: <strong>${ticketData.ownerId}</strong></span>
<span>نوع التكت: <strong>${typeConfig?.label || ticketData.type}</strong></span>
<span>مستلم التكت: <strong>${ticketData.claimedBy || 'لم يستلم'}</strong></span>
</div>
<div class="messages-wrap">${rows}</div>
<div class="footer">LostPiece Ticket System - Developed by firas</div>
</body></html>`;
}

module.exports = { createTicket, closeTicket, openTickets, loadOpenTickets, buildTicketButtons };
