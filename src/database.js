const mongoose = require('mongoose');

// ── Connection ────────────────────────────────────────────────────
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('[DB] Connected to MongoDB');
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    process.exit(1);
  }
}

// ── Ticket Counter Schema ─────────────────────────────────────────
const counterSchema = new mongoose.Schema({
  _id: { type: String, default: 'ticket_counter' },
  count: { type: Number, default: 0 },
});
const Counter = mongoose.model('Counter', counterSchema);

async function getNextTicketNumber() {
  const doc = await Counter.findByIdAndUpdate(
    'ticket_counter',
    { $inc: { count: 1 } },
    { new: true, upsert: true }
  );
  return doc.count;
}

// ── Ticket Schema ─────────────────────────────────────────────────
const ticketSchema = new mongoose.Schema({
  channelId:  { type: String, required: true, unique: true },
  guildId:    { type: String, required: true },
  type:       { type: String, required: true },
  ownerId:    { type: String, required: true },
  number:     { type: Number, required: true },
  claimedBy:  { type: String, default: null },
  status:     { type: String, default: 'open' }, // open | closed
  openedAt:   { type: Date, default: Date.now },
  closedAt:   { type: Date, default: null },
  closedBy:   { type: String, default: null },
});
const Ticket = mongoose.model('Ticket', ticketSchema);

// ── Warning Schema ────────────────────────────────────────────────
const warnSchema = new mongoose.Schema({
  guildId:  { type: String, required: true },
  userId:   { type: String, required: true },
  warns: [
    {
      reason:    { type: String },
      moderator: { type: String },
      date:      { type: Date, default: Date.now },
    }
  ],
});
const Warning = mongoose.model('Warning', warnSchema);

// ── Helpers ───────────────────────────────────────────────────────
async function saveTicket(data) {
  await Ticket.create(data);
}

async function getTicket(channelId) {
  return await Ticket.findOne({ channelId });
}

async function updateTicket(channelId, updates) {
  return await Ticket.findOneAndUpdate({ channelId }, updates, { new: true });
}

async function closeTicketDB(channelId, closedBy) {
  return await Ticket.findOneAndUpdate(
    { channelId },
    { status: 'closed', closedAt: new Date(), closedBy },
    { new: true }
  );
}

async function getAllOpenTickets(guildId) {
  return await Ticket.find({ guildId, status: 'open' });
}

async function addWarning(guildId, userId, reason, moderatorId) {
  return await Warning.findOneAndUpdate(
    { guildId, userId },
    { $push: { warns: { reason, moderator: moderatorId } } },
    { new: true, upsert: true }
  );
}

async function getWarnings(guildId, userId) {
  return await Warning.findOne({ guildId, userId });
}

async function clearWarnings(guildId, userId) {
  return await Warning.findOneAndUpdate(
    { guildId, userId },
    { $set: { warns: [] } },
    { new: true }
  );
}

module.exports = {
  connectDB,
  getNextTicketNumber,
  saveTicket,
  getTicket,
  updateTicket,
  closeTicketDB,
  getAllOpenTickets,
  addWarning,
  getWarnings,
  clearWarnings,
  Ticket,
  Warning,
};
