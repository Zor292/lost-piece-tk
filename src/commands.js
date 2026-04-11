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

// Helper: check admin permission
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

  // ══════════════════════════════════════════
  //  MODERATION COMMANDS
  // ══════════════════════════════════════════

  if (command === 'ban') {
    if (!member.permissions.has(PermissionFlagsBits.BanMembers)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [embed(null, 'الرجاء منشنة العضو.')] });
    const reason = args.slice(1).join(' ') || 'لم يتم ذكر سبب';
    await target.ban({ reason });
    return message.reply({ embeds: [embed('تم حظر العضو', `تم حظر ${target.user.username}\n**السبب:** ${reason}`)] });
  }

  if (command === 'unban') {
    if (!member.permissions.has(PermissionFlagsBits.BanMembers)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const userId = args[0];
    if (!userId) return message.reply({ embeds: [embed(null, 'الرجاء ادخال ID العضو.')] });
    await guild.bans.remove(userId).catch(() => {});
    return message.reply({ embeds: [embed('تم رفع الحظر', `تم رفع الحظر عن العضو: \`${userId}\``)] });
  }

  if (command === 'kick') {
    if (!member.permissions.has(PermissionFlagsBits.KickMembers)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [embed(null, 'الرجاء منشنة العضو.')] });
    const reason = args.slice(1).join(' ') || 'لم يتم ذكر سبب';
    await target.kick(reason);
    return message.reply({ embeds: [embed('تم طرد العضو', `تم طرد ${target.user.username}\n**السبب:** ${reason}`)] });
  }

  if (command === 'mute') {
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [embed(null, 'الرجاء منشنة العضو.')] });
    const minutes = parseInt(args[1]) || 10;
    await target.timeout(minutes * 60 * 1000, args.slice(2).join(' ') || 'لم يذكر سبب');
    return message.reply({ embeds: [embed('تم كتم العضو', `تم كتم ${target.user.username} لمدة ${minutes} دقيقة.`)] });
  }

  if (command === 'unmute') {
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [embed(null, 'الرجاء منشنة العضو.')] });
    await target.timeout(null);
    return message.reply({ embeds: [embed('تم رفع الكتم', `تم رفع الكتم عن ${target.user.username}.`)] });
  }

  if (command === 'warn') {
    if (!isMod(member)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const target = message.mentions.users.first();
    if (!target) return message.reply({ embeds: [embed(null, 'الرجاء منشنة العضو.')] });
    const reason = args.slice(1).join(' ') || 'لم يذكر سبب';
    const result = await db.addWarning(guild.id, target.id, reason, message.author.id);
    const warnCount = result.warns.length;
    try {
      await target.send({ embeds: [embed('تحذير', `لقد تلقيت تحذيراً في **${guild.name}**\n**السبب:** ${reason}\n**عدد تحذيراتك:** ${warnCount}`)] });
    } catch {}
    return message.reply({ embeds: [embed('تم تحذير العضو', `تم تحذير ${target.username}\n**السبب:** ${reason}\n**مجموع التحذيرات:** ${warnCount}`)] });
  }

  if (command === 'clear' || command === 'purge') {
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const amount = parseInt(args[0]);
    if (!amount || amount < 1 || amount > 100) return message.reply({ embeds: [embed(null, 'الرجاء ادخال عدد من 1 الى 100.')] });
    const deleted = await message.channel.bulkDelete(amount + 1, true);
    const reply = await message.channel.send({ embeds: [embed(null, `تم حذف ${deleted.size - 1} رسالة.`)] });
    setTimeout(() => reply.delete().catch(() => {}), 3000);
    return;
  }

  if (command === 'slowmode') {
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const seconds = parseInt(args[0]) || 0;
    await message.channel.setRateLimitPerUser(seconds);
    return message.reply({ embeds: [embed(null, seconds === 0 ? 'تم ايقاف السلو مود.' : `تم تفعيل السلو مود: ${seconds} ثانية.`)] });
  }

  if (command === 'lock') {
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    await message.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
    return message.reply({ embeds: [embed('القناة مقفلة', 'تم قفل هذه القناة.')] });
  }

  if (command === 'unlock') {
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    await message.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
    return message.reply({ embeds: [embed('القناة مفتوحة', 'تم فتح هذه القناة.')] });
  }

  if (command === 'lockdown') {
    if (!isAdmin(member)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const channels = guild.channels.cache.filter(c => c.type === 0);
    let count = 0;
    for (const [, ch] of channels) {
      await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }).catch(() => {});
      count++;
    }
    return message.reply({ embeds: [embed('Lockdown مفعّل', `تم قفل ${count} قناة نصية.`)] });
  }

  if (command === 'unlockdown') {
    if (!isAdmin(member)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const channels = guild.channels.cache.filter(c => c.type === 0);
    for (const [, ch] of channels) {
      await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null }).catch(() => {});
    }
    return message.reply({ embeds: [embed('Lockdown مرفوع', 'تم فتح جميع القنوات.')] });
  }

  if (command === 'nick') {
    if (!member.permissions.has(PermissionFlagsBits.ManageNicknames)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [embed(null, 'الرجاء منشنة العضو.')] });
    const newNick = args.slice(1).join(' ') || null;
    await target.setNickname(newNick);
    return message.reply({ embeds: [embed(null, newNick ? `تم تغيير لقب ${target.user.username} الى: ${newNick}` : `تم ازالة لقب ${target.user.username}.`)] });
  }

  if (command === 'role-add') {
    if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const target = message.mentions.members.first();
    const role = message.mentions.roles.first();
    if (!target || !role) return message.reply({ embeds: [embed(null, 'الرجاء منشنة العضو والرتبة.')] });
    await target.roles.add(role);
    return message.reply({ embeds: [embed(null, `تم اضافة رتبة ${role.name} الى ${target.user.username}.`)] });
  }

  if (command === 'role-remove') {
    if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const target = message.mentions.members.first();
    const role = message.mentions.roles.first();
    if (!target || !role) return message.reply({ embeds: [embed(null, 'الرجاء منشنة العضو والرتبة.')] });
    await target.roles.remove(role);
    return message.reply({ embeds: [embed(null, `تم ازالة رتبة ${role.name} من ${target.user.username}.`)] });
  }

  // ══════════════════════════════════════════
  //  INFO COMMANDS
  // ══════════════════════════════════════════

  if (command === 'userinfo') {
    const target = message.mentions.members.first() || member;
    const u = target.user;
    return message.reply({
      embeds: [new EmbedBuilder()
        .setTitle(`معلومات ${u.username}`)
        .setThumbnail(u.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: 'الاسم', value: u.username, inline: true },
          { name: 'الـ ID', value: u.id, inline: true },
          { name: 'تاريخ الانضمام', value: target.joinedAt.toLocaleDateString('ar-SA'), inline: true },
          { name: 'تاريخ انشاء الحساب', value: u.createdAt.toLocaleDateString('ar-SA'), inline: true },
          { name: 'الرتب', value: target.roles.cache.filter(r => r.id !== guild.id).map(r => r.toString()).join(' ') || 'لا توجد رتب', inline: false },
        )
        .setColor(config.EMBED_COLOR)
        .setFooter({ text: 'Developed by firas' })
        .setTimestamp()]
    });
  }

  if (command === 'serverinfo') {
    const g = guild;
    return message.reply({
      embeds: [new EmbedBuilder()
        .setTitle(g.name)
        .setThumbnail(g.iconURL({ dynamic: true }))
        .addFields(
          { name: 'الـ ID', value: g.id, inline: true },
          { name: 'المالك', value: `<@${g.ownerId}>`, inline: true },
          { name: 'عدد الاعضاء', value: g.memberCount.toString(), inline: true },
          { name: 'عدد القنوات', value: g.channels.cache.size.toString(), inline: true },
          { name: 'عدد الرتب', value: g.roles.cache.size.toString(), inline: true },
          { name: 'تاريخ الانشاء', value: g.createdAt.toLocaleDateString('ar-SA'), inline: true },
        )
        .setColor(config.EMBED_COLOR)
        .setFooter({ text: 'Developed by firas' })
        .setTimestamp()]
    });
  }

  if (command === 'roleinfo') {
    const role = message.mentions.roles.first();
    if (!role) return message.reply({ embeds: [embed(null, 'الرجاء منشنة الرتبة.')] });
    return message.reply({
      embeds: [embed(`معلومات رتبة ${role.name}`, null, [
        { name: 'الـ ID', value: role.id, inline: true },
        { name: 'اللون', value: role.hexColor, inline: true },
        { name: 'عدد الاعضاء', value: role.members.size.toString(), inline: true },
        { name: 'قابلة للمنشن', value: role.mentionable ? 'نعم' : 'لا', inline: true },
        { name: 'تاريخ الانشاء', value: role.createdAt.toLocaleDateString('ar-SA'), inline: true },
      ])]
    });
  }

  if (command === 'avatar') {
    const target = message.mentions.users.first() || message.author;
    return message.reply({
      embeds: [new EmbedBuilder()
        .setTitle(`صورة ${target.username}`)
        .setImage(target.displayAvatarURL({ dynamic: true, size: 1024 }))
        .setColor(config.EMBED_COLOR)
        .setFooter({ text: 'Developed by firas' })]
    });
  }

  if (command === 'ping') {
    return message.reply({ embeds: [embed('Ping', `البينج الحالي: **${client.ws.ping}ms**`)] });
  }

  if (command === 'botinfo') {
    return message.reply({
      embeds: [embed('معلومات البوت', null, [
        { name: 'الاسم', value: client.user.username, inline: true },
        { name: 'الـ ID', value: client.user.id, inline: true },
        { name: 'عدد السيرفرات', value: client.guilds.cache.size.toString(), inline: true },
        { name: 'البينج', value: `${client.ws.ping}ms`, inline: true },
        { name: 'المطور', value: 'firas', inline: true },
      ])]
    });
  }

  if (command === 'members') {
    return message.reply({
      embeds: [embed('اعضاء السيرفر', null, [
        { name: 'الكل', value: guild.memberCount.toString(), inline: true },
        { name: 'البشر', value: guild.members.cache.filter(m => !m.user.bot).size.toString(), inline: true },
        { name: 'البوتات', value: guild.members.cache.filter(m => m.user.bot).size.toString(), inline: true },
      ])]
    });
  }

  if (command === 'channels') {
    return message.reply({
      embeds: [embed('قنوات السيرفر', null, [
        { name: 'الكل', value: guild.channels.cache.size.toString(), inline: true },
        { name: 'النصية', value: guild.channels.cache.filter(c => c.type === 0).size.toString(), inline: true },
        { name: 'الصوتية', value: guild.channels.cache.filter(c => c.type === 2).size.toString(), inline: true },
        { name: 'الكاتيغوري', value: guild.channels.cache.filter(c => c.type === 4).size.toString(), inline: true },
      ])]
    });
  }

  if (command === 'roles') {
    const roles = guild.roles.cache.sort((a, b) => b.position - a.position).filter(r => r.id !== guild.id).map(r => r.toString()).join(' ');
    return message.reply({ embeds: [embed('رتب السيرفر', roles || 'لا توجد رتب.')] });
  }

  if (command === 'id') {
    const target = message.mentions.users.first() || message.author;
    return message.reply({ embeds: [embed(null, `الـ ID الخاص بـ ${target.username}: \`${target.id}\``)] });
  }

  if (command === 'emojis') {
    const emojis = guild.emojis.cache.map(e => e.toString()).join(' ');
    return message.reply({ embeds: [embed('ايموجيات السيرفر', emojis || 'لا توجد ايموجيات.')] });
  }

  if (command === 'boosts') {
    return message.reply({
      embeds: [embed('بوستات السيرفر', null, [
        { name: 'عدد البوستات', value: guild.premiumSubscriptionCount.toString(), inline: true },
        { name: 'مستوى البوست', value: guild.premiumTier.toString(), inline: true },
      ])]
    });
  }

  // ══════════════════════════════════════════
  //  CHANNEL MANAGEMENT
  // ══════════════════════════════════════════

  if (command === 'topic') {
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const topic = args.join(' ');
    if (!topic) return message.reply({ embeds: [embed(null, 'الرجاء ادخال الموضوع.')] });
    await message.channel.setTopic(topic);
    return message.reply({ embeds: [embed(null, `تم تغيير موضوع القناة.`)] });
  }

  if (command === 'nuke') {
    if (!isAdmin(member)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const ch = message.channel;
    const position = ch.position;
    const newCh = await ch.clone();
    await ch.delete();
    await newCh.setPosition(position).catch(() => {});
    return newCh.send({ embeds: [embed('تم نيوك القناة', 'تم مسح وانشاء القناة من جديد.')] });
  }

  if (command === 'create-channel') {
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const name = args[0];
    if (!name) return message.reply({ embeds: [embed(null, 'الرجاء ادخال اسم القناة.')] });
    const newCh = await guild.channels.create({ name, type: 0 });
    return message.reply({ embeds: [embed(null, `تم انشاء القناة ${newCh}.`)] });
  }

  if (command === 'delete-channel') {
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const ch = message.mentions.channels.first() || message.channel;
    await ch.delete().catch(() => {});
    if (ch.id !== message.channel.id) return message.reply({ embeds: [embed(null, `تم حذف القناة.`)] });
    return;
  }

  if (command === 'create-role') {
    if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const name = args.join(' ');
    if (!name) return message.reply({ embeds: [embed(null, 'الرجاء ادخال اسم الرتبة.')] });
    const role = await guild.roles.create({ name });
    return message.reply({ embeds: [embed(null, `تم انشاء رتبة ${role}.`)] });
  }

  if (command === 'delete-role') {
    if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const role = message.mentions.roles.first();
    if (!role) return message.reply({ embeds: [embed(null, 'الرجاء منشنة الرتبة.')] });
    await role.delete();
    return message.reply({ embeds: [embed(null, `تم حذف رتبة **${role.name}**.`)] });
  }

  // ══════════════════════════════════════════
  //  ANNOUNCEMENT & MESSAGE TOOLS
  // ══════════════════════════════════════════

  if (command === 'say') {
    if (!isMod(member)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const text = args.join(' ');
    if (!text) return message.reply({ embeds: [embed(null, 'الرجاء ادخال النص.')] });
    await message.delete().catch(() => {});
    return message.channel.send(text);
  }

  if (command === 'announce') {
    if (!isAdmin(member)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const ch = message.mentions.channels.first();
    const text = args.slice(1).join(' ');
    if (!ch || !text) return message.reply({ embeds: [embed(null, 'الاستخدام: !announce #قناة النص')] });
    await message.delete().catch(() => {});
    return ch.send({ embeds: [embed('اعلان', text)] });
  }

  if (command === 'embed') {
    if (!isMod(member)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const text = args.join(' ');
    if (!text) return message.reply({ embeds: [embed(null, 'الرجاء ادخال النص.')] });
    await message.delete().catch(() => {});
    return message.channel.send({ embeds: [embed(null, text)] });
  }

  if (command === 'dm') {
    if (!isMod(member)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const target = message.mentions.users.first();
    const text = args.slice(1).join(' ');
    if (!target || !text) return message.reply({ embeds: [embed(null, 'الاستخدام: !dm @عضو النص')] });
    try {
      await target.send({ embeds: [embed('رسالة من الادارة', text)] });
      return message.reply({ embeds: [embed(null, `تم ارسال الرسالة الى ${target.username}.`)] });
    } catch {
      return message.reply({ embeds: [embed(null, 'تعذر ارسال الرسالة الخاصة.')] });
    }
  }

  if (command === 'poll') {
    if (!isMod(member)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const question = args.join(' ');
    if (!question) return message.reply({ embeds: [embed(null, 'الرجاء ادخال السؤال.')] });
    await message.delete().catch(() => {});
    const poll = await message.channel.send({ embeds: [embed('تصويت', question)] });
    await poll.react('✅');
    await poll.react('❌');
    return;
  }

  if (command === 'pin') {
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const msgId = args[0];
    if (!msgId) return message.reply({ embeds: [embed(null, 'الرجاء ادخال ID الرسالة.')] });
    const msg = await message.channel.messages.fetch(msgId).catch(() => null);
    if (!msg) return message.reply({ embeds: [embed(null, 'لم يتم العثور على الرسالة.')] });
    await msg.pin();
    return message.reply({ embeds: [embed(null, 'تم تثبيت الرسالة.')] });
  }

  if (command === 'unpin') {
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const msgId = args[0];
    if (!msgId) return message.reply({ embeds: [embed(null, 'الرجاء ادخال ID الرسالة.')] });
    const msg = await message.channel.messages.fetch(msgId).catch(() => null);
    if (!msg) return message.reply({ embeds: [embed(null, 'لم يتم العثور على الرسالة.')] });
    await msg.unpin();
    return message.reply({ embeds: [embed(null, 'تم ازالة تثبيت الرسالة.')] });
  }

  // ══════════════════════════════════════════
  //  FUN / MISC COMMANDS
  // ══════════════════════════════════════════

  if (command === 'help') {
    return message.reply({
      embeds: [new EmbedBuilder()
        .setTitle('قائمة الاوامر')
        .setColor(config.EMBED_COLOR)
        .setFooter({ text: 'Developed by firas' })
        .setTimestamp()
        .addFields(
          {
            name: 'نظام التذاكر',
            value: `\`!tickets\` \`!close\` \`!add\` \`!remove\` \`!rename\` \`!claim\` \`!ticketinfo\` \`!tickets-list\``,
          },
          {
            name: 'الادارة',
            value: `\`!ban\` \`!unban\` \`!kick\` \`!mute\` \`!unmute\` \`!warn\` \`!warns\` \`!clearwarns\` \`!clear\` \`!slowmode\` \`!lock\` \`!unlock\` \`!lockdown\` \`!unlockdown\` \`!nick\` \`!role-add\` \`!role-remove\``,
          },
          {
            name: 'المعلومات',
            value: `\`!userinfo\` \`!serverinfo\` \`!roleinfo\` \`!avatar\` \`!ping\` \`!botinfo\` \`!members\` \`!channels\` \`!roles\` \`!id\` \`!emojis\` \`!boosts\``,
          },
          {
            name: 'ادارة القنوات والرتب',
            value: `\`!topic\` \`!nuke\` \`!create-channel\` \`!delete-channel\` \`!create-role\` \`!delete-role\``,
          },
          {
            name: 'الرسائل والاعلانات',
            value: `\`!say\` \`!announce\` \`!embed\` \`!dm\` \`!poll\` \`!pin\` \`!unpin\``,
          },
          {
            name: 'متنوع',
            value: `\`!8ball\` \`!coin\` \`!dice\` \`!choose\` \`!afk\` \`!unafk\` \`!whois\` \`!invites\` \`!joinpos\` \`!uptime\` \`!calc\` \`!encode\` \`!decode\` \`!repeat\``,
          },
        )]
    });
  }

  if (command === '8ball') {
    const question = args.join(' ');
    if (!question) return message.reply({ embeds: [embed(null, 'الرجاء ادخال سؤالك.')] });
    const answers = ['نعم', 'لا', 'ربما', 'بالتأكيد', 'لا أعتقد', 'الأمور غير واضحة', 'اسأل مرة أخرى', 'لا تعتمد عليه', 'بالتأكيد لا'];
    const answer = answers[Math.floor(Math.random() * answers.length)];
    return message.reply({ embeds: [embed('كرة السحر 🎱', `**السؤال:** ${question}\n**الجواب:** ${answer}`)] });
  }

  if (command === 'coin') {
    const result = Math.random() < 0.5 ? 'وجه' : 'كتابة';
    return message.reply({ embeds: [embed('رمي العملة', `النتيجة: **${result}**`)] });
  }

  if (command === 'dice') {
    const sides = parseInt(args[0]) || 6;
    const result = Math.floor(Math.random() * sides) + 1;
    return message.reply({ embeds: [embed('رمي الزهر', `النتيجة: **${result}** (من ${sides})`)] });
  }

  if (command === 'choose') {
    const options = args.join(' ').split(',').map(s => s.trim()).filter(Boolean);
    if (options.length < 2) return message.reply({ embeds: [embed(null, 'الرجاء ادخال خيارين على الاقل مفصولين بفاصلة.')] });
    const pick = options[Math.floor(Math.random() * options.length)];
    return message.reply({ embeds: [embed('الاختيار العشوائي', `اخترت: **${pick}**`)] });
  }

  if (command === 'afk') {
    if (!guild._afkList) guild._afkList = new Map();
    const reason = args.join(' ') || 'غائب';
    guild._afkList.set(message.author.id, { reason, time: Date.now() });
    return message.reply({ embeds: [embed(null, `تم تفعيل وضع الغياب. السبب: ${reason}`)] });
  }

  if (command === 'unafk') {
    if (!guild._afkList) guild._afkList = new Map();
    guild._afkList.delete(message.author.id);
    return message.reply({ embeds: [embed(null, 'تم ايقاف وضع الغياب.')] });
  }

  if (command === 'whois') {
    const target = message.mentions.members.first() || member;
    const u = target.user;
    const isOwner = guild.ownerId === u.id;
    const perms = [];
    if (target.permissions.has(PermissionFlagsBits.Administrator)) perms.push('ادمن');
    if (target.permissions.has(PermissionFlagsBits.ManageGuild)) perms.push('ادارة السيرفر');
    if (target.permissions.has(PermissionFlagsBits.BanMembers)) perms.push('حظر');
    if (target.permissions.has(PermissionFlagsBits.KickMembers)) perms.push('طرد');
    if (target.permissions.has(PermissionFlagsBits.ModerateMembers)) perms.push('كتم');
    return message.reply({
      embeds: [embed(`من هو ${u.username}`, null, [
        { name: 'الاسم', value: u.username, inline: true },
        { name: 'المالك', value: isOwner ? 'نعم' : 'لا', inline: true },
        { name: 'بوت', value: u.bot ? 'نعم' : 'لا', inline: true },
        { name: 'الصلاحيات', value: perms.length ? perms.join(', ') : 'لا شيء مميز', inline: false },
        { name: 'الرتبة الاعلى', value: target.roles.highest.toString(), inline: true },
      ])]
    });
  }

  if (command === 'invites') {
    if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) return message.reply({ embeds: [embed(null, 'تعذر جلب الدعوات.')] });
    const top = invites.sort((a, b) => b.uses - a.uses).first(10);
    const list = top.map(i => `\`${i.code}\` - ${i.inviter?.username || 'مجهول'} - ${i.uses} استخدام`).join('\n');
    return message.reply({ embeds: [embed('اهم الدعوات', list || 'لا توجد دعوات.')] });
  }

  if (command === 'joinpos') {
    const target = message.mentions.members.first() || member;
    const sorted = guild.members.cache.sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);
    const pos = sorted.map(m => m.id).indexOf(target.id) + 1;
    return message.reply({ embeds: [embed(null, `${target.user.username} هو العضو رقم **${pos}** في الانضمام للسيرفر.`)] });
  }

  if (command === 'uptime') {
    const ms = client.uptime;
    const sec = Math.floor((ms / 1000) % 60);
    const min = Math.floor((ms / 60000) % 60);
    const hr = Math.floor(ms / 3600000);
    return message.reply({ embeds: [embed('وقت التشغيل', `**${hr}** ساعة, **${min}** دقيقة, **${sec}** ثانية`)] });
  }

  if (command === 'calc') {
    const expr = args.join(' ');
    if (!expr) return message.reply({ embeds: [embed(null, 'الرجاء ادخال العملية الحسابية.')] });
    try {
      // Safe eval: only allow numbers and basic operators
      if (!/^[0-9+\-*\/\.\s\(\)]+$/.test(expr)) throw new Error('invalid');
      const result = Function('"use strict"; return (' + expr + ')')();
      return message.reply({ embeds: [embed('الحاسبة', `${expr} = **${result}**`)] });
    } catch {
      return message.reply({ embeds: [embed(null, 'خطأ في العملية الحسابية.')] });
    }
  }

  if (command === 'encode') {
    const text = args.join(' ');
    if (!text) return message.reply({ embeds: [embed(null, 'الرجاء ادخال النص.')] });
    return message.reply({ embeds: [embed('تشفير Base64', `\`${Buffer.from(text).toString('base64')}\``)] });
  }

  if (command === 'decode') {
    const text = args.join(' ');
    if (!text) return message.reply({ embeds: [embed(null, 'الرجاء ادخال النص.')] });
    try {
      return message.reply({ embeds: [embed('فك تشفير Base64', Buffer.from(text, 'base64').toString('utf-8'))] });
    } catch {
      return message.reply({ embeds: [embed(null, 'تعذر فك التشفير.')] });
    }
  }

  if (command === 'repeat') {
    if (!isMod(member)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const times = parseInt(args[0]) || 1;
    const text = args.slice(1).join(' ');
    if (!text) return message.reply({ embeds: [embed(null, 'الرجاء ادخال النص.')] });
    for (let i = 0; i < Math.min(times, 5); i++) {
      await message.channel.send(text);
    }
    return;
  }

  if (command === 'massrole') {
    if (!isAdmin(member)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const role = message.mentions.roles.first();
    if (!role) return message.reply({ embeds: [embed(null, 'الرجاء منشنة الرتبة.')] });
    await guild.members.fetch();
    const humans = guild.members.cache.filter(m => !m.user.bot);
    let count = 0;
    for (const [, m] of humans) {
      await m.roles.add(role).catch(() => {});
      count++;
    }
    return message.reply({ embeds: [embed(null, `تم اضافة رتبة ${role.name} لـ ${count} عضو.`)] });
  }

  if (command === 'removeallrole') {
    if (!isAdmin(member)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const role = message.mentions.roles.first();
    if (!role) return message.reply({ embeds: [embed(null, 'الرجاء منشنة الرتبة.')] });
    await guild.members.fetch();
    const withRole = guild.members.cache.filter(m => m.roles.cache.has(role.id));
    let count = 0;
    for (const [, m] of withRole) {
      await m.roles.remove(role).catch(() => {});
      count++;
    }
    return message.reply({ embeds: [embed(null, `تم ازالة رتبة ${role.name} من ${count} عضو.`)] });
  }

  if (command === 'move') {
    if (!member.permissions.has(PermissionFlagsBits.MoveMembers)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const target = message.mentions.members.first();
    const voiceChannel = member.voice.channel;
    if (!target) return message.reply({ embeds: [embed(null, 'الرجاء منشنة العضو.')] });
    if (!voiceChannel) return message.reply({ embeds: [embed(null, 'يجب ان تكون في قناة صوتية.')] });
    await target.voice.setChannel(voiceChannel).catch(() => {});
    return message.reply({ embeds: [embed(null, `تم نقل ${target.user.username} الى ${voiceChannel.name}.`)] });
  }

  if (command === 'deafen') {
    if (!member.permissions.has(PermissionFlagsBits.DeafenMembers)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [embed(null, 'الرجاء منشنة العضو.')] });
    await target.voice.setDeaf(true).catch(() => {});
    return message.reply({ embeds: [embed(null, `تم صم ${target.user.username}.`)] });
  }

  if (command === 'undeafen') {
    if (!member.permissions.has(PermissionFlagsBits.DeafenMembers)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [embed(null, 'الرجاء منشنة العضو.')] });
    await target.voice.setDeaf(false).catch(() => {});
    return message.reply({ embeds: [embed(null, `تم رفع صم ${target.user.username}.`)] });
  }

  if (command === 'voicemute') {
    if (!member.permissions.has(PermissionFlagsBits.MuteMembers)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [embed(null, 'الرجاء منشنة العضو.')] });
    await target.voice.setMute(true).catch(() => {});
    return message.reply({ embeds: [embed(null, `تم كتم ${target.user.username} في الصوت.`)] });
  }

  if (command === 'voiceunmute') {
    if (!member.permissions.has(PermissionFlagsBits.MuteMembers)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [embed(null, 'الرجاء منشنة العضو.')] });
    await target.voice.setMute(false).catch(() => {});
    return message.reply({ embeds: [embed(null, `تم رفع كتم ${target.user.username} في الصوت.`)] });
  }

  if (command === 'setnick') {
    if (!member.permissions.has(PermissionFlagsBits.ManageNicknames)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [embed(null, 'الرجاء منشنة العضو.')] });
    const nick = args.slice(1).join(' ') || null;
    await target.setNickname(nick);
    return message.reply({ embeds: [embed(null, nick ? `تم تغيير اللقب.` : 'تم ازالة اللقب.')] });
  }

  if (command === 'clearwarns') {
    if (!isMod(member)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const target = message.mentions.users.first();
    if (!target) return message.reply({ embeds: [embed(null, 'الرجاء منشنة العضو.')] });
    await db.clearWarnings(guild.id, target.id);
    return message.reply({ embeds: [embed(null, `تم مسح تحذيرات ${target.username}.`)] });
  }

  if (command === 'warns') {
    const target = message.mentions.users.first() || message.author;
    const data = await db.getWarnings(guild.id, target.id);
    const warns = data?.warns || [];
    if (warns.length === 0) return message.reply({ embeds: [embed(null, `${target.username} ليس لديه تحذيرات.`)] });
    const list = warns.map((w, i) => `**${i + 1}.** ${w.reason} - <@${w.moderator}>`).join('\n');
    return message.reply({ embeds: [embed(`تحذيرات ${target.username} (${warns.length})`, list)] });
  }

  if (command === 'banlist') {
    if (!member.permissions.has(PermissionFlagsBits.BanMembers)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const bans = await guild.bans.fetch();
    const list = bans.map(b => `\`${b.user.username}\` (${b.user.id})`).slice(0, 20).join('\n');
    return message.reply({ embeds: [embed('قائمة المحظورين', list || 'لا يوجد محظورين.')] });
  }

  if (command === 'inviteinfo') {
    if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const code = args[0];
    if (!code) return message.reply({ embeds: [embed(null, 'الرجاء ادخال كود الدعوة.')] });
    const inv = await client.fetchInvite(code).catch(() => null);
    if (!inv) return message.reply({ embeds: [embed(null, 'دعوة غير صالحة.')] });
    return message.reply({
      embeds: [embed(`معلومات الدعوة: ${code}`, null, [
        { name: 'السيرفر', value: inv.guild?.name || 'مجهول', inline: true },
        { name: 'المنشئ', value: inv.inviter?.username || 'مجهول', inline: true },
        { name: 'الاستخدامات', value: `${inv.uses}/${inv.maxUses || '∞'}`, inline: true },
      ])]
    });
  }

  if (command === 'setcolor') {
    if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const role = message.mentions.roles.first();
    const color = args[1];
    if (!role || !color) return message.reply({ embeds: [embed(null, 'الاستخدام: !setcolor @رتبة #لون')] });
    await role.setColor(color).catch(() => {});
    return message.reply({ embeds: [embed(null, `تم تغيير لون رتبة ${role.name} الى ${color}.`)] });
  }

  if (command === 'sethoist') {
    if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const role = message.mentions.roles.first();
    if (!role) return message.reply({ embeds: [embed(null, 'الرجاء منشنة الرتبة.')] });
    await role.setHoist(!role.hoist);
    return message.reply({ embeds: [embed(null, `تم ${role.hoist ? 'تفعيل' : 'ايقاف'} عرض الرتبة منفصلة.`)] });
  }

  if (command === 'setmentionable') {
    if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply({ embeds: [embed(null, 'ليس لديك صلاحية.')] });
    const role = message.mentions.roles.first();
    if (!role) return message.reply({ embeds: [embed(null, 'الرجاء منشنة الرتبة.')] });
    await role.setMentionable(!role.mentionable);
    return message.reply({ embeds: [embed(null, `تم ${role.mentionable ? 'تفعيل' : 'ايقاف'} منشن الرتبة.`)] });
  }

  if (command === 'stats') {
    const ms = client.uptime;
    const hr = Math.floor(ms / 3600000);
    const min = Math.floor((ms / 60000) % 60);
    const totalTickets = await db.Ticket.countDocuments({ guildId: guild.id });
    const openCount = await db.Ticket.countDocuments({ guildId: guild.id, status: 'open' });
    return message.reply({
      embeds: [embed('احصائيات البوت', null, [
        { name: 'وقت التشغيل', value: `${hr}س ${min}د`, inline: true },
        { name: 'عدد السيرفرات', value: client.guilds.cache.size.toString(), inline: true },
        { name: 'البينج', value: `${client.ws.ping}ms`, inline: true },
        { name: 'التذاكر المفتوحة', value: openCount.toString(), inline: true },
        { name: 'اجمالي التذاكر', value: totalTickets.toString(), inline: true },
      ])]
    });
  }
}

module.exports = { handleCommand };
