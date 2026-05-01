const {
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const config = require('./config');
const { openTickets } = require('./ticketManager');
const db = require('./database');

function isAdmin(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild);
}

function isMod(member) {
  return isAdmin(member) || member.permissions.has(PermissionFlagsBits.ModerateMembers);
}

function embed(description, fields = []) {
  const e = new EmbedBuilder().setColor(config.EMBED_COLOR).setFooter({ text: 'Developed by firas' }).setTimestamp();
  if (description) e.setDescription(description);
  if (fields.length) e.addFields(fields);
  return e;
}

async function handleCommand(message, client) {
  if (!message.content.startsWith(config.PREFIX) || message.author.bot) return;

  const args = message.content.slice(config.PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const guild = message.guild;
  const member = message.member;

  if (command === 'tickets') {
    if (!isAdmin(member)) return message.reply({ embeds: [embed('ليس لديك صلاحية.')] });

    const { StringSelectMenuBuilder } = require('discord.js');
    const ticketEmbed = new EmbedBuilder()
      .setTitle('نظام التذاكر - LostPiece')
      .setDescription('اختر نوع التذكرة من القائمة ادناه لفتح تكت جديد.')
      .setImage(config.IMAGE_URL)
      .setColor(config.EMBED_COLOR)
      .setFooter({ text: 'Developed by firas' })
      .setTimestamp();

    const dropdown = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('open_ticket_type')
        .setPlaceholder('اختر نوع التذكرة')
        .addOptions(
          Object.entries(config.TICKET_TYPES).map(([key, val]) => ({
            label: val.label,
            value: key,
            emoji: val.emoji,
          }))
        )
    );

    await message.channel.send({ embeds: [ticketEmbed], components: [dropdown] });
    await message.delete().catch(() => {});
    return;
  }

  if (command === 'close') {
    const ticketData = openTickets.get(message.channel.id);
    if (!ticketData) return message.reply({ embeds: [embed('هذه القناة ليست تكتاً.')] });
    const typeConfig = config.TICKET_TYPES[ticketData.type];
    const canClose = member.roles.cache.has(typeConfig.adminRole) || member.id === ticketData.ownerId || isAdmin(member);
    if (!canClose) return message.reply({ embeds: [embed('ليس لديك صلاحية اغلاق هذا التكت.')] });
    const { closeTicket } = require('./ticketManager');
    await closeTicket({ guild, user: message.author, reply: (d) => message.channel.send(d), channel: message.channel, client }, message.channel.id);
    return;
  }

  if (command === 'ticketpoints') {
    const allPoints = db.getAllPoints();
    const sorted = Object.entries(allPoints).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) return message.reply({ embeds: [embed('لا توجد نقاط بعد.')] });
    const list = sorted.slice(0, 15).map(([id, pts], i) => `${i + 1}. <@${id}> - **${pts}** نقطة`).join('\n');
    return message.reply({ embeds: [new EmbedBuilder().setTitle('نقاط استلام التذاكر').setDescription(list).setColor(config.EMBED_COLOR).setFooter({ text: 'Developed by firas' }).setTimestamp()] });
  }

  if (command === 'add') {
    const ticketData = openTickets.get(message.channel.id);
    if (!ticketData) return message.reply({ embeds: [embed('هذه القناة ليست تكتاً.')] });
    if (!isMod(member)) return message.reply({ embeds: [embed('ليس لديك صلاحية.')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [embed('الرجاء منشنة العضو الذي تريد اضافته.')] });
    await message.channel.permissionOverwrites.edit(target.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    return message.reply({ embeds: [embed(`تم اضافة ${target} للتكت.`)] });
  }

  if (command === 'remove') {
    const ticketData = openTickets.get(message.channel.id);
    if (!ticketData) return message.reply({ embeds: [embed('هذه القناة ليست تكتاً.')] });
    if (!isMod(member)) return message.reply({ embeds: [embed('ليس لديك صلاحية.')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [embed('الرجاء منشنة العضو الذي تريد ازالته.')] });
    if (target.id === ticketData.ownerId) return message.reply({ embeds: [embed('لا يمكن ازالة صاحب التكت.')] });
    await message.channel.permissionOverwrites.delete(target.id);
    return message.reply({ embeds: [embed(`تم ازالة ${target} من التكت.`)] });
  }

  if (command === 'rename') {
    const ticketData = openTickets.get(message.channel.id);
    if (!ticketData) return message.reply({ embeds: [embed('هذه القناة ليست تكتاً.')] });
    if (!isMod(member)) return message.reply({ embeds: [embed('ليس لديك صلاحية.')] });
    const newName = args.join('-').toLowerCase().slice(0, 50);
    if (!newName) return message.reply({ embeds: [embed('الرجاء ادخال الاسم الجديد.')] });
    await message.channel.setName(newName);
    return message.reply({ embeds: [embed(`تم تغيير اسم القناة الى: **${newName}**`)] });
  }

  if (command === 'tickets-list') {
    if (!isAdmin(member)) return message.reply({ embeds: [embed('ليس لديك صلاحية.')] });
    const tickets = await db.getAllOpenTickets(guild.id);
    if (tickets.length === 0) return message.reply({ embeds: [new EmbedBuilder().setTitle('التذاكر المفتوحة').setDescription('لا توجد تذاكر مفتوحة حالياً.').setColor(config.EMBED_COLOR).setFooter({ text: 'Developed by firas' }).setTimestamp()] });
    const list = tickets.map(t => {
      const typeConfig = config.TICKET_TYPES[t.type];
      return `**#${t.number}** | <#${t.channelId}> | <@${t.ownerId}> | ${typeConfig?.label || t.type}`;
    }).join('\n');
    return message.reply({ embeds: [new EmbedBuilder().setTitle(`التذاكر المفتوحة (${tickets.length})`).setDescription(list).setColor(config.EMBED_COLOR).setFooter({ text: 'Developed by firas' }).setTimestamp()] });
  }
}

module.exports = { handleCommand };
