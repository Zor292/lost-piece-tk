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
const { createTicket, closeTicket, openTickets, loadOpenTickets } = require('./ticketManager');
const { handleCommand } = require('./commands');
const { connectDB } = require('./database');

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
  client.user.setActivity('LostPiece | !help', { type: 3 });
  await connectDB();
  await loadOpenTickets();
});

// ─── AFK system ──────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // AFK: check if someone mentioned an AFK user
  if (message.mentions.users.size > 0 && message.guild._afkList) {
    for (const [, user] of message.mentions.users) {
      const afkData = message.guild._afkList.get(user.id);
      if (afkData) {
        await message.reply({
          embeds: [new EmbedBuilder()
            .setColor(config.EMBED_COLOR)
            .setDescription(`${user.username} غائب حالياً. السبب: ${afkData.reason}`)
            .setFooter({ text: 'Developed by firas' })]
        }).catch(() => {});
      }
    }
  }

  // AFK: remove if user sends a message
  if (message.guild._afkList && message.guild._afkList.has(message.author.id)) {
    message.guild._afkList.delete(message.author.id);
    const reply = await message.reply({
      embeds: [new EmbedBuilder()
        .setColor(config.EMBED_COLOR)
        .setDescription('تم ايقاف وضع الغياب.')
        .setFooter({ text: 'Developed by firas' })]
    }).catch(() => null);
    if (reply) setTimeout(() => reply.delete().catch(() => {}), 4000);
  }

  // Pass to prefix command handler
  await handleCommand(message, client).catch(console.error);
});

// ─── Interactions ─────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  try {
    // ══ Select Menu ══
    if (interaction.isStringSelectMenu()) {

      if (interaction.customId === 'open_ticket_type') {
        const ticketType = interaction.values[0];
        await interaction.deferReply({ ephemeral: true });
        await createTicket(interaction, ticketType);
        return;
      }

      if (interaction.customId.startsWith('ticket_manage_')) {
        const channelId = interaction.customId.replace('ticket_manage_', '');
        const action = interaction.values[0];
        const ticketData = openTickets.get(channelId);

        if (!ticketData) return interaction.reply({ content: 'لم يتم العثور على بيانات التكت.', ephemeral: true });

        const typeConfig = config.TICKET_TYPES[ticketData.type];
        const isAdmin = interaction.member.roles.cache.has(typeConfig.adminRole) ||
          interaction.member.permissions.has(PermissionFlagsBits.Administrator);

        if (!isAdmin) return interaction.reply({ content: 'ليس لديك صلاحية.', ephemeral: true });

        if (action === 'call_owner') {
          // Mention in channel + send DM
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
          const modal = new ModalBuilder()
            .setCustomId(`modal_rename_${channelId}`)
            .setTitle('تعديل اسم التذكرة');
          modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('new_name').setLabel('الاسم الجديد').setStyle(TextInputStyle.Short).setRequired(true)
          ));
          await interaction.showModal(modal);

        } else if (action === 'add_member') {
          const modal = new ModalBuilder()
            .setCustomId(`modal_addmember_${channelId}`)
            .setTitle('اضافة عضو للتذكرة');
          modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('user_id').setLabel('ادخل ID العضو').setStyle(TextInputStyle.Short).setRequired(true)
          ));
          await interaction.showModal(modal);

        } else if (action === 'remove_member') {
          const modal = new ModalBuilder()
            .setCustomId(`modal_removemember_${channelId}`)
            .setTitle('ازالة عضو من التذكرة');
          modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('user_id').setLabel('ادخل ID العضو').setStyle(TextInputStyle.Short).setRequired(true)
          ));
          await interaction.showModal(modal);
        }
      }
    }

    // ══ Buttons ══
    if (interaction.isButton()) {
      const customId = interaction.customId;

      if (customId.startsWith('ticket_senior_')) {
        const channelId = customId.replace('ticket_senior_', '');
        const ticketData = openTickets.get(channelId);
        if (!ticketData) return interaction.reply({ content: 'تكت غير موجود.', ephemeral: true });
        const typeConfig = config.TICKET_TYPES[ticketData.type];
        if (!interaction.member.roles.cache.has(typeConfig.adminRole) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator))
          return interaction.reply({ content: 'ليس لديك صلاحية.', ephemeral: true });
        await interaction.reply({ content: `<@&${config.ROLES.SENIOR}>` });

      } else if (customId.startsWith('ticket_support_')) {
        const channelId = customId.replace('ticket_support_', '');
        const ticketData = openTickets.get(channelId);
        if (!ticketData) return interaction.reply({ content: 'تكت غير موجود.', ephemeral: true });
        const typeConfig = config.TICKET_TYPES[ticketData.type];
        if (!interaction.member.roles.cache.has(typeConfig.adminRole) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator))
          return interaction.reply({ content: 'ليس لديك صلاحية.', ephemeral: true });
        await interaction.reply({ content: `<@&${typeConfig.supportRole}>` });

      } else if (customId.startsWith('ticket_claim_')) {
        const channelId = customId.replace('ticket_claim_', '');
        const ticketData = openTickets.get(channelId);
        if (!ticketData) return interaction.reply({ content: 'تكت غير موجود.', ephemeral: true });
        const typeConfig = config.TICKET_TYPES[ticketData.type];
        if (!interaction.member.roles.cache.has(typeConfig.adminRole) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator))
          return interaction.reply({ content: 'ليس لديك صلاحية.', ephemeral: true });
        if (ticketData.claimedBy)
          return interaction.reply({ content: `التكت تم استلامه بالفعل من <@${ticketData.claimedBy}>.`, ephemeral: true });
        ticketData.claimedBy = interaction.user.id;
        openTickets.set(channelId, ticketData);
        await interaction.reply({
          embeds: [new EmbedBuilder()
            .setDescription(`تم استلام التكت بواسطة <@${interaction.user.id}>`)
            .setColor(config.EMBED_COLOR)
            .setFooter({ text: 'Developed by firas' })
            .setTimestamp()]
        });

      } else if (customId.startsWith('ticket_close_')) {
        const channelId = customId.replace('ticket_close_', '');
        const ticketData = openTickets.get(channelId);
        if (!ticketData) return interaction.reply({ content: 'تكت غير موجود.', ephemeral: true });
        const typeConfig = config.TICKET_TYPES[ticketData.type];
        const canClose =
          interaction.member.roles.cache.has(typeConfig.adminRole) ||
          interaction.user.id === ticketData.ownerId ||
          interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        if (!canClose) return interaction.reply({ content: 'ليس لديك صلاحية اغلاق هذا التكت.', ephemeral: true });

        // Confirmation message
        const confirmEmbed = new EmbedBuilder()
          .setTitle('تأكيد الإغلاق')
          .setDescription('هل أنت متأكد من إغلاق هذا التكت؟\nسيتم حذف القناة وإرسال السجل للوق.')
          .setColor(0xe74c3c)
          .setFooter({ text: 'Developed by firas' })
          .setTimestamp();

        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`ticket_confirm_close_${channelId}`)
            .setLabel('نعم، اغلق التكت')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`ticket_cancel_close_${channelId}`)
            .setLabel('إلغاء')
            .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({ embeds: [confirmEmbed], components: [confirmRow], ephemeral: true });

      } else if (customId.startsWith('ticket_confirm_close_')) {
        const channelId = customId.replace('ticket_confirm_close_', '');
        const ticketData = openTickets.get(channelId);
        if (!ticketData) return interaction.reply({ content: 'تكت غير موجود.', ephemeral: true });
        await interaction.update({ content: 'جاري الإغلاق...', embeds: [], components: [] });
        await closeTicket({ guild: interaction.guild, user: interaction.user, reply: (d) => interaction.channel.send(d), channel: interaction.channel }, channelId);

      } else if (customId.startsWith('ticket_cancel_close_')) {
        await interaction.update({ content: 'تم إلغاء الإغلاق.', embeds: [], components: [] });
      }
    }

    // ══ Modals ══
    if (interaction.isModalSubmit()) {
      const customId = interaction.customId;

      if (customId.startsWith('modal_rename_')) {
        const channelId = customId.replace('modal_rename_', '');
        const channel = interaction.guild.channels.cache.get(channelId);
        const newName = interaction.fields.getTextInputValue('new_name').toLowerCase().replace(/\s+/g, '-').slice(0, 50);
        if (channel) await channel.setName(newName);
        await interaction.reply({ content: `تم تغيير الاسم الى: ${newName}`, ephemeral: true });

      } else if (customId.startsWith('modal_addmember_')) {
        const channelId = customId.replace('modal_addmember_', '');
        const channel = interaction.guild.channels.cache.get(channelId);
        const userId = interaction.fields.getTextInputValue('user_id').trim().replace(/\D/g, '');
        if (!channel) return interaction.reply({ content: 'القناة غير موجودة.', ephemeral: true });
        if (!userId) return interaction.reply({ content: 'الـ ID غير صالح.', ephemeral: true });
        try {
          // Fetch member first to ensure they exist in guild
          const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
          if (!targetMember) return interaction.reply({ content: 'العضو غير موجود في السيرفر.', ephemeral: true });
          await channel.permissionOverwrites.edit(targetMember, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
          });
          await interaction.reply({
            embeds: [new EmbedBuilder()
              .setDescription(`تم اضافة ${targetMember} للتكت.`)
              .setColor(config.EMBED_COLOR)
              .setFooter({ text: 'Developed by firas' })],
            ephemeral: false
          });
        } catch (e) {
          console.error('[AddMember Error]', e);
          await interaction.reply({ content: 'حدث خطأ أثناء اضافة العضو.', ephemeral: true });
        }

      } else if (customId.startsWith('modal_removemember_')) {
        const channelId = customId.replace('modal_removemember_', '');
        const channel = interaction.guild.channels.cache.get(channelId);
        const userId = interaction.fields.getTextInputValue('user_id').trim().replace(/\D/g, '');
        const ticketData = openTickets.get(channelId);
        if (!channel) return interaction.reply({ content: 'القناة غير موجودة.', ephemeral: true });
        if (!userId) return interaction.reply({ content: 'الـ ID غير صالح.', ephemeral: true });
        if (ticketData && userId === ticketData.ownerId)
          return interaction.reply({ content: 'لا يمكن ازالة صاحب التكت.', ephemeral: true });
        try {
          const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
          if (!targetMember) return interaction.reply({ content: 'العضو غير موجود في السيرفر.', ephemeral: true });
          await channel.permissionOverwrites.delete(targetMember);
          await interaction.reply({
            embeds: [new EmbedBuilder()
              .setDescription(`تم ازالة ${targetMember} من التكت.`)
              .setColor(config.EMBED_COLOR)
              .setFooter({ text: 'Developed by firas' })],
            ephemeral: false
          });
        } catch (e) {
          console.error('[RemoveMember Error]', e);
          await interaction.reply({ content: 'حدث خطأ أثناء ازالة العضو.', ephemeral: true });
        }
      }
    }

  } catch (err) {
    console.error('[Interaction Error]', err);
    try {
      const errMsg = { content: 'حدث خطأ اثناء تنفيذ الامر.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errMsg);
      } else {
        await interaction.reply(errMsg);
      }
    } catch {}
  }
});

client.login(process.env.DISCORD_TOKEN);
