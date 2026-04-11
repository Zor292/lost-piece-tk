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

// In-memory cache (loaded from DB on startup)
const openTickets = new Map(); // channelId -> { type, ownerId, claimedBy, openedAt, number }

// Load open tickets from DB into memory cache
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
    console.log(`[DB] Loaded ${tickets.length} open tickets into cache`);
  } catch (err) {
    console.error('[DB] Failed to load tickets:', err.message);
  }
}

async function createTicket(interaction, ticketType) {
  const guild = interaction.guild;
  const user = interaction.user;
  const typeConfig = config.TICKET_TYPES[ticketType];
  if (!typeConfig) return;

  // Check existing open ticket of same type
  const existing = [...openTickets.values()].find(
    (t) => t.ownerId === user.id && t.type === ticketType
  );
  if (existing) {
    await interaction.reply({ content: 'لديك تكت مفتوح من هذا النوع بالفعل.', ephemeral: true });
    return;
  }

  // Get next number from DB (starts from 1, incrementing)
  const ticketNum = await db.getNextTicketNumber();

  // Format: ticket-1-username, ticket-2-username ...
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

  // Save to DB
  await db.saveTicket({
    channelId: channel.id,
    guildId: guild.id,
    type: ticketType,
    ownerId: user.id,
    number: ticketNum,
  });

  // Save to memory cache
  openTickets.set(channel.id, {
    type: ticketType,
    ownerId: user.id,
    claimedBy: null,
    openedAt: new Date(),
    number: ticketNum,
  });

  const embed = new EmbedBuilder()
    .setTitle(typeConfig.title)
    .setDescription(config.RULES_DESCRIPTION)
    .setImage(config.IMAGE_URL)
    .setColor(config.EMBED_COLOR)
    .setFooter({ text: 'Developed by firas' })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket_senior_${channel.id}`).setLabel('استدعاء عليا').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ticket_support_${channel.id}`).setLabel('استدعاء سبورت').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket_claim_${channel.id}`).setLabel('استلام تكت').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ticket_close_${channel.id}`).setLabel('اغلاق').setStyle(ButtonStyle.Danger)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ticket_manage_${channel.id}`)
      .setPlaceholder('تعديل التذكرة')
      .addOptions([
        { label: 'استدعاء صاحب التذكرة', value: 'call_owner', emoji: '📣' },
        { label: 'تعديل اسم التذكرة', value: 'rename', emoji: '✏️' },
        { label: 'اضافة عضو للتذكرة', value: 'add_member', emoji: '➕' },
        { label: 'ازالة عضو من التذكرة', value: 'remove_member', emoji: '➖' },
      ])
  );

  await channel.send({
    content: `<@${user.id}> <@&${typeConfig.adminRole}>`,
    embeds: [embed],
    components: [row1, row2],
  });

  await interaction.editReply({ content: `تم فتح التكت: ${channel}` });
}

async function closeTicket(interaction, channelId) {
  const channel = interaction.guild.channels.cache.get(channelId);
  if (!channel) return;
  const ticketData = openTickets.get(channelId);
  if (!ticketData) return;

  // Fetch messages for transcript
  const messages = await channel.messages.fetch({ limit: 100 });
  const sorted = [...messages.values()].reverse();
  const htmlContent = generateTranscriptHTML(sorted, ticketData, channel.name);

  // Update DB
  await db.closeTicketDB(channelId, interaction.user.id);

  // Send to log channel
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
        { name: 'اسم القناة', value: channel.name, inline: true },
        { name: 'وقت الفتح', value: ticketData.openedAt.toLocaleString('ar-SA'), inline: true },
      )
      .setColor(0xe74c3c)
      .setFooter({ text: 'Developed by firas' })
      .setTimestamp();

    const buf = Buffer.from(htmlContent, 'utf-8');
    const attachment = new AttachmentBuilder(buf, { name: `transcript-${channel.name}.html` });
    await logChannel.send({ embeds: [logEmbed], files: [attachment] });
  }

  openTickets.delete(channelId);
  await interaction.channel.send({
    embeds: [new EmbedBuilder()
      .setDescription('جاري اغلاق التكت...')
      .setColor(0xe74c3c)
      .setFooter({ text: 'Developed by firas' })]
  });
  setTimeout(() => channel.delete().catch(() => {}), 3000);
}

function generateTranscriptHTML(messages, ticketData, channelName, guild) {
  const typeConfig = config.TICKET_TYPES[ticketData.type];

  // Generate a consistent color for a user based on their ID
  function getUserColor(userId) {
    const colors = ['#7289da','#43b581','#faa61a','#f04747','#b9bbbe','#99aab5','#5865f2','#eb459e','#3ba55c','#ed4245'];
    let hash = 0;
    for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  function getAvatar(msg) {
    try {
      if (msg.author.displayAvatarURL) {
        const url = msg.author.displayAvatarURL({ extension: 'png', size: 64 });
        return url;
      }
    } catch {}
    // fallback default discord avatar
    const disc = parseInt(msg.author.discriminator || '0') % 5;
    return `https://cdn.discordapp.com/embed/avatars/${disc}.png`;
  }

  function formatTime(date) {
    return date.toLocaleString('en-US', {
      month: 'numeric', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    });
  }

  function renderEmbeds(embeds) {
    if (!embeds || embeds.length === 0) return '';
    return embeds.map(embed => {
      const color = embed.color ? `#${embed.color.toString(16).padStart(6,'0')}` : '#4f545c';
      const title = embed.title ? `<div class="embed-title">${escapeHtml(embed.title)}</div>` : '';
      const desc = embed.description ? `<div class="embed-desc">${escapeHtml(embed.description)}</div>` : '';
      const img = embed.image?.url ? `<img class="embed-img" src="${escapeHtml(embed.image.url)}" alt="embed image"/>` : '';
      const thumb = embed.thumbnail?.url ? `<img class="embed-thumb" src="${escapeHtml(embed.thumbnail.url)}" alt="thumbnail"/>` : '';
      const footer = embed.footer?.text ? `<div class="embed-footer">${escapeHtml(embed.footer.text)}</div>` : '';
      const fields = embed.fields && embed.fields.length > 0
        ? `<div class="embed-fields">${embed.fields.map(f =>
            `<div class="embed-field${f.inline ? ' inline' : ''}">
              <div class="field-name">${escapeHtml(f.name)}</div>
              <div class="field-value">${escapeHtml(f.value)}</div>
            </div>`).join('')}</div>`
        : '';
      return `<div class="embed" style="border-left-color:${color}">
        <div class="embed-body">
          ${thumb ? `<div class="embed-side">${thumb}</div>` : ''}
          <div class="embed-content">
            ${title}${desc}${fields}${footer}
          </div>
        </div>
        ${img}
      </div>`;
    }).join('');
  }

  function renderAttachments(attachments) {
    if (!attachments || attachments.size === 0) return '';
    return [...attachments.values()].map(a => {
      const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(a.name);
      if (isImage) return `<img class="msg-img" src="${escapeHtml(a.url)}" alt="${escapeHtml(a.name)}"/>`;
      return `<a class="msg-file" href="${escapeHtml(a.url)}" target="_blank">📎 ${escapeHtml(a.name)}</a>`;
    }).join('');
  }

  function renderContent(content) {
    if (!content) return '';
    // Render mentions nicely
    let html = escapeHtml(content);
    html = html.replace(/&lt;@!?(\d+)&gt;/g, '<span class="mention">@$1</span>');
    html = html.replace(/&lt;@&amp;(\d+)&gt;/g, '<span class="mention role-mention">@role</span>');
    html = html.replace(/&lt;#(\d+)&gt;/g, '<span class="mention">#channel</span>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    return html;
  }

  // Group consecutive messages from the same author (within 7 minutes)
  const groupedMessages = [];
  let lastAuthorId = null;
  let lastTime = null;

  for (const msg of messages) {
    const timeDiff = lastTime ? (msg.createdAt - lastTime) / 1000 / 60 : 999;
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
    const isBot = author.bot;

    const msgLines = group.msgs.map(msg => {
      const content = renderContent(msg.content);
      const embeds = renderEmbeds(msg.embeds);
      const attachments = renderAttachments(msg.attachments);
      const edited = msg.editedAt ? '<span class="edited">(edited)</span>' : '';
      return `<div class="msg-line">
        ${content ? `<div class="msg-text">${content} ${edited}</div>` : ''}
        ${embeds}
        ${attachments}
      </div>`;
    }).join('');

    return `
    <div class="message-group">
      <img class="avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(author.username)}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'"/>
      <div class="msg-right">
        <div class="msg-header">
          <span class="username" style="color:${color}">${escapeHtml(author.username)}${isBot ? '<span class="bot-tag">BOT</span>' : ''}</span>
          <span class="timestamp">${formatTime(firstMsg.createdAt)}</span>
        </div>
        ${msgLines}
      </div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="ar">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Transcript — ${escapeHtml(channelName)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'gg sans','Noto Sans','Helvetica Neue',Helvetica,Arial,sans-serif;background:#313338;color:#dcddde;font-size:16px;line-height:1.375}
  /* Header */
  .header{background:#2b2d31;padding:12px 16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #1e1f22;position:sticky;top:0;z-index:10}
  .header-icon{color:#80848e;font-size:20px}
  .header-channel{font-weight:700;color:#f2f3f5;font-size:16px}
  .header-topic{color:#b5bac1;font-size:13px;margin-left:8px;border-left:1px solid #4e5058;padding-left:8px}
  /* Info bar */
  .info-bar{background:#2b2d31;padding:8px 16px;display:flex;gap:20px;flex-wrap:wrap;border-bottom:1px solid #1e1f22;font-size:12px;color:#b5bac1}
  .info-bar strong{color:#e3e5e8}
  /* Messages area */
  .messages-wrap{padding:16px 0;max-width:100%}
  .message-group{display:flex;gap:16px;padding:2px 16px 2px 16px;min-height:44px;position:relative}
  .message-group:hover{background:rgba(0,0,0,.06)}
  .avatar{width:40px;height:40px;border-radius:50%;object-fit:cover;margin-top:2px;flex-shrink:0;cursor:pointer}
  .msg-right{flex:1;min-width:0}
  .msg-header{display:flex;align-items:baseline;gap:8px;margin-bottom:2px}
  .username{font-weight:500;font-size:1rem;cursor:pointer}
  .username:hover{text-decoration:underline}
  .bot-tag{background:#5865f2;color:#fff;font-size:10px;font-weight:700;padding:1px 4px;border-radius:3px;margin-left:4px;vertical-align:middle;text-transform:uppercase;letter-spacing:.5px}
  .timestamp{color:#a3a6aa;font-size:.75rem;font-weight:400}
  .msg-line{margin-bottom:2px}
  .msg-text{color:#dcddde;font-size:1rem;line-height:1.375;word-break:break-word;white-space:pre-wrap}
  .msg-text strong{font-weight:700}
  .msg-text em{font-style:italic}
  .msg-text code{background:#2e3035;border-radius:3px;padding:0 4px;font-family:Consolas,Andale Mono,monospace;font-size:.875rem;color:#e3e5e8}
  .edited{color:#a3a6aa;font-size:.625rem;margin-left:4px}
  .mention{color:#c9cdfb;background:rgba(88,101,242,.3);border-radius:3px;padding:0 2px;cursor:pointer}
  .mention:hover{background:#5865f2;color:#fff}
  .role-mention{color:#e9c46a;background:rgba(233,196,106,.1)}
  /* Embeds */
  .embed{background:#2b2d31;border-radius:4px;border-left:4px solid #4f545c;margin-top:4px;max-width:520px;overflow:hidden}
  .embed-body{display:flex;padding:8px 10px 8px 12px;gap:12px}
  .embed-content{flex:1;min-width:0}
  .embed-side{flex-shrink:0}
  .embed-thumb{width:80px;height:80px;border-radius:3px;object-fit:cover}
  .embed-title{color:#fff;font-weight:600;font-size:.9375rem;margin-bottom:4px}
  .embed-desc{color:#dcddde;font-size:.875rem;line-height:1.3;white-space:pre-wrap;margin-bottom:4px}
  .embed-img{width:100%;max-width:400px;border-radius:0 0 4px 4px;display:block}
  .embed-footer{color:#a3a6aa;font-size:.75rem;margin-top:6px;padding-bottom:2px}
  .embed-fields{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
  .embed-field{min-width:calc(33% - 8px);flex:1}
  .embed-field.inline{flex:0 0 calc(33% - 8px)}
  .field-name{color:#fff;font-size:.875rem;font-weight:600;margin-bottom:2px}
  .field-value{color:#dcddde;font-size:.875rem}
  /* Images & files */
  .msg-img{max-width:400px;max-height:300px;border-radius:3px;margin-top:4px;display:block}
  .msg-file{display:inline-flex;align-items:center;gap:6px;background:#2b2d31;border:1px solid #1e1f22;border-radius:3px;padding:6px 10px;margin-top:4px;color:#00b0f4;font-size:.875rem;text-decoration:none}
  .msg-file:hover{text-decoration:underline}
  /* Date divider */
  .date-divider{display:flex;align-items:center;margin:16px 16px;gap:8px}
  .date-divider span{color:#a3a6aa;font-size:.75rem;font-weight:600;white-space:nowrap;padding:0 4px}
  .date-divider::before,.date-divider::after{content:'';flex:1;height:1px;background:#3f4147}
  /* Footer */
  .footer{text-align:center;padding:16px;color:#a3a6aa;font-size:.75rem;border-top:1px solid #3f4147;margin-top:8px}
  .footer a{color:#00b0f4;text-decoration:none}
  .footer a:hover{text-decoration:underline}
  /* Scrollbar */
  ::-webkit-scrollbar{width:8px}
  ::-webkit-scrollbar-track{background:#2b2d31}
  ::-webkit-scrollbar-thumb{background:#1a1b1e;border-radius:4px}
</style>
</head>
<body>
<div class="header">
  <span class="header-icon">#</span>
  <span class="header-channel">${escapeHtml(channelName)}</span>
  <span class="header-topic">LostPiece Ticket Transcript</span>
</div>
<div class="info-bar">
  <span>رقم التكت: <strong>#${ticketData.number}</strong></span>
  <span>صاحب التكت: <strong>${ticketData.ownerId}</strong></span>
  <span>نوع التكت: <strong>${typeConfig?.label || ticketData.type}</strong></span>
  <span>عدد الرسائل: <strong>${messages.length}</strong></span>
  <span>تاريخ الفتح: <strong>${ticketData.openedAt.toLocaleDateString('ar-SA')}</strong></span>
</div>
<div class="messages-wrap">
  ${rows}
</div>
<div class="footer">
  تم تصدير ${messages.length} رسالة &nbsp;•&nbsp; LostPiece Ticket System &nbsp;•&nbsp; Developed by firas
</div>
</body>
</html>`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { createTicket, closeTicket, openTickets, loadOpenTickets };
