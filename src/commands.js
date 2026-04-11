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

function embed(title, description, fields = []) {
  const e = new EmbedBuilder()
    .setColor(config.EMBED_COLOR)
    .setFooter({ text: 'Developed by firas' })
    .setTimestamp();
  if (title) e.setTitle(title);
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

  // ══════════════════════════════════════════
  //  TICKET COMMANDS
  // ══════════════════════════════════════════

  if (command === 'tickets') {
    if (!isAdmin(member)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });

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
    if (!ticketData) return message.reply({ embeds: [embed(null, 'هذه القناة ليست تكتاً.')] });
    const typeConfig = config.TICKET_TYPES[ticketData.type];
    const canClose = member.roles.cache.has(typeConfig.adminRole) || member.id === ticketData.ownerId || isAdmin(member);
    if (!canClose) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية اغلاق هذا التكت.')] });
    const { closeTicket } = require('./ticketManager');
    await closeTicket({ guild, user: message.author, reply: (d) => message.channel.send(d), channel: message.channel }, message.channel.id);
    return;
  }

  if (command === 'add') {
    const ticketData = openTickets.get(message.channel.id);
    if (!ticketData) return message.reply({ embeds: [embed(null, 'هذه القناة ليست تكتاً.')] });
    if (!isMod(member)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [embed(null, 'الرجاء منشنة العضو الذي تريد اضافته.')] });
    await message.channel.permissionOverwrites.create(target.id, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
    });
    return message.reply({ embeds: [embed(null, `تم اضافة ${target} للتكت.`)] });
  }

  if (command === 'remove') {
    const ticketData = openTickets.get(message.channel.id);
    if (!ticketData) return message.reply({ embeds: [embed(null, 'هذه القناة ليست تكتاً.')] });
    if (!isMod(member)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [embed(null, 'الرجاء منشنة العضو الذي تريد ازالته.')] });
    if (target.id === ticketData.ownerId) return message.reply({ embeds: [embed(null, 'لا يمكن ازالة صاحب التكت.')] });
    await message.channel.permissionOverwrites.delete(target.id);
    return message.reply({ embeds: [embed(null, `تم ازالة ${target} من التكت.`)] });
  }

  if (command === 'rename') {
    const ticketData = openTickets.get(message.channel.id);
    if (!ticketData) return message.reply({ embeds: [embed(null, 'هذه القناة ليست تكتاً.')] });
    if (!isMod(member)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const newName = args.join('-').toLowerCase().slice(0, 50);
    if (!newName) return message.reply({ embeds: [embed(null, 'الرجاء ادخال الاسم الجديد.')] });
    await message.channel.setName(newName);
    return message.reply({ embeds: [embed(null, `تم تغيير اسم القناة الى: **${newName}**`)] });
  }

  if (command === 'claim') {
    const ticketData = openTickets.get(message.channel.id);
    if (!ticketData) return message.reply({ embeds: [embed(null, 'هذه القناة ليست تكتاً.')] });
    const typeConfig = config.TICKET_TYPES[ticketData.type];
    if (!member.roles.cache.has(typeConfig.adminRole) && !isAdmin(member)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    if (ticketData.claimedBy) return message.reply({ embeds: [embed(null, `التكت تم استلامه بالفعل من <@${ticketData.claimedBy}>.`)] });
    ticketData.claimedBy = message.author.id;
    openTickets.set(message.channel.id, ticketData);
    return message.reply({ embeds: [embed(null, `تم استلام التكت بواسطة ${message.author}.`)] });
  }

  if (command === 'ticketinfo') {
    const ticketData = openTickets.get(message.channel.id);
    if (!ticketData) return message.reply({ embeds: [embed(null, 'هذه القناة ليست تكتاً.')] });
    const typeConfig = config.TICKET_TYPES[ticketData.type];
    return message.reply({
      embeds: [embed('معلومات التكت', null, [
        { name: 'صاحب التكت', value: `<@${ticketData.ownerId}>`, inline: true },
        { name: 'النوع', value: typeConfig?.label || ticketData.type, inline: true },
        { name: 'المستلم', value: ticketData.claimedBy ? `<@${ticketData.claimedBy}>` : 'لم يستلم بعد', inline: true },
        { name: 'وقت الفتح', value: ticketData.openedAt.toLocaleString('ar-SA'), inline: true },
      ])]
    });
  }

  if (command === 'tickets-list') {
    if (!isAdmin(member)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const tickets = await db.getAllOpenTickets(guild.id);
    if (tickets.length === 0) return message.reply({ embeds: [embed('التذاكر المفتوحة', 'لا توجد تذاكر مفتوحة حالياً.')] });
    const list = tickets.map((t) => {
      const typeConfig = config.TICKET_TYPES[t.type];
      return `**#${t.number}** | <#${t.channelId}> | <@${t.ownerId}> | ${typeConfig?.label || t.type}`;
    }).join('\n');
    return message.reply({ embeds: [embed(`التذاكر المفتوحة (${tickets.length})`, list)] });
  }
}

module.exports = { handleCommand };
