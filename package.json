require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');
const config = require('./config');
const { createTicket, closeTicket, openTickets, loadOpenTickets, buildTicketButtons } = require('./ticketManager');
const { handleCommand } = require('./commands');
const { connectDB, addPoint, setUnclaimCooldown, checkUnclaimCooldown } = require('./database');

const callCooldowns = new Map();
const CALL_COOLDOWN_MS = 2 * 60 * 60 * 1000;

function checkCallCooldown(channelId, type) {
  const now = Date.now();
  const cd = callCooldowns.get(channelId) || {};
  if (cd[type] && now - cd[type] < CALL_COOLDOWN_MS) {
    return Math.ceil((CALL_COOLDOWN_MS - (now - cd[type])) / 60000);
  }
  cd[type] = now;
  callCooldowns.set(channelId, cd);
  return 0;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
  ],
});

client.once('ready', async () => {
  console.log(`[LostPiece] Bot is online: ${client.user.tag}`);
  await connectDB();
  await loadOpenTickets();
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  await handleCommand(message, client).catch(console.error);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'open_ticket_type') {
        const ticketType = interaction.values[0];
        await interaction.deferReply({ flags: 64 });
        await createTicket(interaction, ticketType);
        return;
      }

      if (interaction.customId.startsWith('ticket_manage_')) {
        const channelId = interaction.customId.replace('ticket_manage_', '');
        const action = interaction.values[0];
        const ticketData = openTickets.get(channelId);
        if (!ticketData) return interaction.reply({ content: 'لم يتم العثور على بيانات التكت.', flags: 64 });

        const typeConfig = config.TICKET_TYPES[ticketData.type];
        const isAdmin = interaction.member.roles.cache.has(typeConfig.adminRole) ||
          interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        if (!isAdmin) return interaction.reply({ content: 'ليس لديك صلاحية.', flags: 64 });

        if (ticketData.claimedBy && interaction.user.id !== ticketData.claimedBy) {
          return interaction.reply({ content: 'لا يمكنك التعديل لان التكت مستلم من شخص اخر.', flags: 64 });
        }

        if (action === 'call_owner') {
          await interaction.reply({ content: `<@${ticketData.ownerId}>` });
          try {
            const ownerUser = await interaction.client.users.fetch(ticketData.ownerId);
            await ownerUser.send({
              embeds: [new EmbedBuilder()
                .setTitle('استدعاء في تكتك')
                .setDescription(`تم استدعاؤك في التكت الخاص بك في **${interaction.guild.name}**\nالقناة: <#${channelId}>`)
                .setColor(config.EMBED_COLOR)
                .setFooter({ text: 'Developed by firas' })
                .setTimestamp()]
            });
          } catch {}

        } else if (action === 'rename') {
          const modal = new ModalBuilder().setCustomId(`modal_rename_${channelId}`).setTitle('تعديل اسم التذكرة');
          modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('new_name').setLabel('الاسم الجديد').setStyle(TextInputStyle.Short).setRequired(true)
          ));
          await interaction.showModal(modal);

        } else if (action === 'add_member') {
          const modal = new ModalBuilder().setCustomId(`modal_addmember_${channelId}`).setTitle('اضافة عضو للتذكرة');
          modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('user_id').setLabel('ادخل ID العضو').setStyle(TextInputStyle.Short).setRequired(true)
          ));
          await interaction.showModal(modal);

        } else if (action === 'remove_member') {
          const modal = new ModalBuilder().setCustomId(`modal_removemember_${channelId}`).setTitle('ازالة عضو من التذكرة');
          modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('user_id').setLabel('ادخل ID العضو').setStyle(TextInputStyle.Short).setRequired(true)
          ));
          await interaction.showModal(modal);
        }
      }

      if (interaction.customId.startsWith('rating_stars_')) {
        const parts = interaction.customId.replace('rating_stars_', '').split('_');
        const adminId = parts[0];
        const ticketNumber = parts[1];
        const answer = parts[2];
        const stars = parseInt(interaction.values[0]);

        const ratingChannel = interaction.client.guilds.cache
          .map(g => g.channels.cache.get(config.RATING_CHANNEL_ID))
          .find(c => c);

        if (ratingChannel) {
          const ratingEmbed = new EmbedBuilder()
            .setTitle('تقييم جديد')
            .addFields(
              { name: 'رقم التكت', value: `#${ticketNumber}`, inline: true },
              { name: 'الاداري', value: adminId !== 'none' ? `<@${adminId}>` : 'غير محدد', inline: true },
              { name: 'هل تم الحل', value: answer === 'yes' ? 'نعم' : 'لا', inline: true },
              { name: 'التقييم', value: '⭐'.repeat(stars) + ` (${stars}/5)`, inline: true },
              { name: 'المقيّم', value: `<@${interaction.user.id}>`, inline: true },
            )
            .setColor(config.EMBED_COLOR)
            .setFooter({ text: 'Developed by firas' })
            .setTimestamp();

          await ratingChannel.send({ embeds: [ratingEmbed] });
        }

        await interaction.update({ content: 'شكرا على تقييمك.', embeds: [], components: [] });
      }
    }

    if (interaction.isButton()) {
      const customId = interaction.customId;

      if (customId.startsWith('rating_yes_') || customId.startsWith('rating_no_')) {
        const isYes = customId.startsWith('rating_yes_');
        const rest = customId.replace(isYes ? 'rating_yes_' : 'rating_no_', '');
        const parts = rest.split('_');
        const adminId = parts[0];
        const ticketNumber = parts[1];
        const answer = isYes ? 'yes' : 'no';

        const starsMenu = new StringSelectMenuBuilder()
          .setCustomId(`rating_stars_${adminId}_${ticketNumber}_${answer}`)
          .setPlaceholder('قيّم الاداري من 1 الى 5 نجوم')
          .addOptions([
            { label: '1 نجمة', value: '1' },
            { label: '2 نجمة', value: '2' },
            { label: '3 نجوم', value: '3' },
            { label: '4 نجوم', value: '4' },
            { label: '5 نجوم', value: '5' },
          ]);

        const ratingRow = new ActionRowBuilder().addComponents(starsMenu);

        const ratingEmbed = new EmbedBuilder()
          .setDescription('قيّم الاداري الذي ساعدك')
          .setColor(config.EMBED_COLOR)
          .setFooter({ text: 'Developed by firas' });

        await interaction.update({ embeds: [ratingEmbed], components: [ratingRow] });
        return;
      }

      if (customId.startsWith('ticket_senior_')) {
        const channelId = customId.replace('ticket_senior_', '');
        const ticketData = openTickets.get(channelId);
        if (!ticketData) return interaction.reply({ content: 'تكت غير موجود.', flags: 64 });
        const typeConfig = config.TICKET_TYPES[ticketData.type];
        if (!interaction.member.roles.cache.has(typeConfig.adminRole) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator))
          return interaction.reply({ content: 'ليس لديك صلاحية.', flags: 64 });
        const remaining = checkCallCooldown(channelId, 'senior');
        if (remaining > 0) return interaction.reply({ content: `لا يمكن استدعاء العليا الآن، انتظر **${remaining} دقيقة**.`, flags: 64 });
        await interaction.reply({ content: `<@&${config.ROLES.SENIOR}>` });

      } else if (customId.startsWith('ticket_support_')) {
        const channelId = customId.replace('ticket_support_', '');
        const ticketData = openTickets.get(channelId);
        if (!ticketData) return interaction.reply({ content: 'تكت غير موجود.', flags: 64 });
        const typeConfig = config.TICKET_TYPES[ticketData.type];
        if (!interaction.member.roles.cache.has(typeConfig.adminRole) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator))
          return interaction.reply({ content: 'ليس لديك صلاحية.', flags: 64 });
        const remaining = checkCallCooldown(channelId, 'support');
        if (remaining > 0) return interaction.reply({ content: `لا يمكن استدعاء السبورت الآن، انتظر **${remaining} دقيقة**.`, flags: 64 });
        await interaction.reply({ content: `<@&${typeConfig.supportRole}>` });

      } else if (customId.startsWith('ticket_claim_')) {
        const channelId = customId.replace('ticket_claim_', '');
        const ticketData = openTickets.get(channelId);
        if (!ticketData) return interaction.reply({ content: 'تكت غير موجود.', flags: 64 });
        const typeConfig = config.TICKET_TYPES[ticketData.type];
        if (!interaction.member.roles.cache.has(typeConfig.adminRole) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator))
          return interaction.reply({ content: 'ليس لديك صلاحية.', flags: 64 });
        if (ticketData.claimedBy)
          return interaction.reply({ content: `التكت مستلم بالفعل من <@${ticketData.claimedBy}>.`, flags: 64 });

        const cdRemaining = checkUnclaimCooldown(interaction.user.id);
        if (cdRemaining > 0)
          return interaction.reply({ content: `لا يمكنك استلام تكت الان، انتظر **${cdRemaining} دقيقة**.`, flags: 64 });

        ticketData.claimedBy = interaction.user.id;
        openTickets.set(channelId, ticketData);
        addPoint(interaction.user.id);

        const allAdmins = Object.values(config.TICKET_TYPES).map(t => t.adminRole);
        const uniqueAdmins = [...new Set(allAdmins)];
        for (const roleId of uniqueAdmins) {
          await interaction.channel.permissionOverwrites.edit(roleId, { SendMessages: false }).catch(() => {});
        }
        const claimerMember = await interaction.guild.members.fetch(interaction.user.id);
        await interaction.channel.permissionOverwrites.edit(claimerMember, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          ManageMessages: true,
          AttachFiles: true,
        });

        const mainMsg = ticketData.mainMessageId
          ? await interaction.channel.messages.fetch(ticketData.mainMessageId).catch(() => null)
          : null;

        if (mainMsg) {
          const newComponents = buildTicketButtons(channelId, interaction.user.id);
          await mainMsg.edit({ components: newComponents });
        }

        await interaction.reply({
          embeds: [new EmbedBuilder()
            .setDescription(`تم استلام التكت بواسطة <@${interaction.user.id}>`)
            .setColor(config.EMBED_COLOR)
            .setFooter({ text: 'Developed by firas' })
            .setTimestamp()]
        });

      } else if (customId.startsWith('ticket_unclaim_')) {
        const channelId = customId.replace('ticket_unclaim_', '');
        const ticketData = openTickets.get(channelId);
        if (!ticketData) return interaction.reply({ content: 'تكت غير موجود.', flags: 64 });
        if (ticketData.claimedBy !== interaction.user.id)
          return interaction.reply({ content: 'فقط من استلم التكت يمكنه فك الاستلام.', flags: 64 });

        ticketData.claimedBy = null;
        openTickets.set(channelId, ticketData);
        setUnclaimCooldown(interaction.user.id);

        const allAdmins = Object.values(config.TICKET_TYPES).map(t => t.adminRole);
        const uniqueAdmins = [...new Set(allAdmins)];
        for (const roleId of uniqueAdmins) {
          await interaction.channel.permissionOverwrites.edit(roleId, { SendMessages: true }).catch(() => {});
        }

        const mainMsg = ticketData.mainMessageId
          ? await interaction.channel.messages.fetch(ticketData.mainMessageId).catch(() => null)
          : null;

        if (mainMsg) {
          const newComponents = buildTicketButtons(channelId, null);
          await mainMsg.edit({ components: newComponents });
        }

        await interaction.reply({
          embeds: [new EmbedBuilder()
            .setDescription(`تم فك استلام التكت بواسطة <@${interaction.user.id}>`)
            .setColor(config.EMBED_COLOR)
            .setFooter({ text: 'Developed by firas' })
            .setTimestamp()]
        });

      } else if (customId.startsWith('ticket_close_')) {
        const channelId = customId.replace('ticket_close_', '');
        const ticketData = openTickets.get(channelId);
        if (!ticketData) return interaction.reply({ content: 'تكت غير موجود.', flags: 64 });
        const typeConfig = config.TICKET_TYPES[ticketData.type];
        const canClose =
          interaction.member.roles.cache.has(typeConfig.adminRole) ||
          interaction.user.id === ticketData.ownerId ||
          interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        if (!canClose) return interaction.reply({ content: 'ليس لديك صلاحية اغلاق هذا التكت.', flags: 64 });

        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`ticket_confirm_close_${channelId}`).setLabel('نعم، اغلق التكت').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`ticket_cancel_close_${channelId}`).setLabel('إلغاء').setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({
          embeds: [new EmbedBuilder()
            .setTitle('تأكيد الإغلاق')
            .setDescription('هل أنت متأكد من إغلاق هذا التكت؟')
            .setColor(0xe74c3c)
            .setFooter({ text: 'Developed by firas' })
            .setTimestamp()],
          components: [confirmRow],
          flags: 64,
        });

      } else if (customId.startsWith('ticket_confirm_close_')) {
        const channelId = customId.replace('ticket_confirm_close_', '');
        const ticketData = openTickets.get(channelId);
        if (!ticketData) return interaction.reply({ content: 'تكت غير موجود.', flags: 64 });
        await interaction.update({ content: 'جاري الإغلاق...', embeds: [], components: [] });
        await closeTicket({ guild: interaction.guild, user: interaction.user, reply: (d) => interaction.channel.send(d), channel: interaction.channel, client }, channelId);

      } else if (customId.startsWith('ticket_cancel_close_')) {
        await interaction.update({ content: 'تم إلغاء الإغلاق.', embeds: [], components: [] });
      }
    }

    if (interaction.isModalSubmit()) {
      const customId = interaction.customId;

      if (customId.startsWith('modal_rename_')) {
        const channelId = customId.replace('modal_rename_', '');
        const channel = interaction.guild.channels.cache.get(channelId);
        const newName = interaction.fields.getTextInputValue('new_name').toLowerCase().replace(/\s+/g, '-').slice(0, 50);
        if (channel) await channel.setName(newName);
        await interaction.reply({ content: `تم تغيير الاسم الى: ${newName}`, flags: 64 });

      } else if (customId.startsWith('modal_addmember_')) {
        const channelId = customId.replace('modal_addmember_', '');
        const channel = interaction.guild.channels.cache.get(channelId);
        const userId = interaction.fields.getTextInputValue('user_id').trim().replace(/\D/g, '');
        if (!channel) return interaction.reply({ content: 'القناة غير موجودة.', flags: 64 });
        if (!userId) return interaction.reply({ content: 'الـ ID غير صالح.', flags: 64 });
        const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) return interaction.reply({ content: 'العضو غير موجود في السيرفر.', flags: 64 });
        await channel.permissionOverwrites.edit(targetMember, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
        await interaction.reply({ embeds: [new EmbedBuilder().setDescription(`تم اضافة ${targetMember} للتكت.`).setColor(config.EMBED_COLOR).setFooter({ text: 'Developed by firas' })], flags: 64 });

      } else if (customId.startsWith('modal_removemember_')) {
        const channelId = customId.replace('modal_removemember_', '');
        const channel = interaction.guild.channels.cache.get(channelId);
        const userId = interaction.fields.getTextInputValue('user_id').trim().replace(/\D/g, '');
        const ticketData = openTickets.get(channelId);
        if (!channel) return interaction.reply({ content: 'القناة غير موجودة.', flags: 64 });
        if (!userId) return interaction.reply({ content: 'الـ ID غير صالح.', flags: 64 });
        if (ticketData && userId === ticketData.ownerId) return interaction.reply({ content: 'لا يمكن ازالة صاحب التكت.', flags: 64 });
        const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) return interaction.reply({ content: 'العضو غير موجود في السيرفر.', flags: 64 });
        await channel.permissionOverwrites.delete(targetMember);
        await interaction.reply({ embeds: [new EmbedBuilder().setDescription(`تم ازالة ${targetMember} من التكت.`).setColor(config.EMBED_COLOR).setFooter({ text: 'Developed by firas' })], flags: 64 });
      }
    }

  } catch (err) {
    console.error('[Interaction Error]', err);
    try {
      const errMsg = { content: 'حدث خطأ اثناء تنفيذ الامر.', flags: 64 };
      if (interaction.replied || interaction.deferred) await interaction.followUp(errMsg);
      else await interaction.reply(errMsg);
    } catch {}
  }
});

client.login(process.env.DISCORD_TOKEN);
