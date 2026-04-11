const fs = require('fs');
const path = require('path');

const TICKETS_PATH  = path.join(__dirname, 'data', 'tickets.json');
const WARNINGS_PATH = path.join(__dirname, 'data', 'warnings.json');
const COUNTER_PATH  = path.join(__dirname, 'data', 'counter.json');

// ── Helpers ───────────────────────────────────────────────────────
function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ── No-op connect (kept for compatibility) ────────────────────────
async function connectDB() {
  console.log('[DB] Using JSON file storage.');
}

// ── Counter ───────────────────────────────────────────────────────
async function getNextTicketNumber() {
  const counter = readJSON(COUNTER_PATH);
  counter.count = (counter.count || 0) + 1;
  writeJSON(COUNTER_PATH, counter);
  return counter.count;
}

// ── Tickets ───────────────────────────────────────────────────────
async function saveTicket(data) {
  const tickets = readJSON(TICKETS_PATH);
  tickets[data.channelId] = {
    ...data,
    claimedBy: null,
    status: 'open',
    openedAt: new Date().toISOString(),
    closedAt: null,
    closedBy: null,
  };
  writeJSON(TICKETS_PATH, tickets);
}

async function getTicket(channelId) {
  const tickets = readJSON(TICKETS_PATH);
  return tickets[channelId] || null;
}

async function closeTicketDB(channelId, closedBy) {
  const tickets = readJSON(TICKETS_PATH);
  if (!tickets[channelId]) return null;
  tickets[channelId].status   = 'closed';
  tickets[channelId].closedAt = new Date().toISOString();
  tickets[channelId].closedBy = closedBy;
  writeJSON(TICKETS_PATH, tickets);
  return tickets[channelId];
}

async function getAllOpenTickets(guildId) {
  const tickets = readJSON(TICKETS_PATH);
  return Object.values(tickets).filter(
    (t) => t.guildId === guildId && t.status === 'open'
  ).map(t => ({ ...t, openedAt: new Date(t.openedAt) }));
}

// ── Warnings ──────────────────────────────────────────────────────
async function addWarning(guildId, userId, reason, moderatorId) {
  const warnings = readJSON(WARNINGS_PATH);
  const key = `${guildId}_${userId}`;
  if (!warnings[key]) warnings[key] = { guildId, userId, warns: [] };
  warnings[key].warns.push({ reason, moderator: moderatorId, date: new Date().toISOString() });
  writeJSON(WARNINGS_PATH, warnings);
  return warnings[key];
}

async function getWarnings(guildId, userId) {
  const warnings = readJSON(WARNINGS_PATH);
  return warnings[`${guildId}_${userId}`] || { warns: [] };
}

async function clearWarnings(guildId, userId) {
  const warnings = readJSON(WARNINGS_PATH);
  const key = `${guildId}_${userId}`;
  if (warnings[key]) warnings[key].warns = [];
  writeJSON(WARNINGS_PATH, warnings);
  return warnings[key] || { warns: [] };
}

// ── Ticket count for stats ────────────────────────────────────────
const Ticket = {
  countDocuments: async (filter) => {
    const tickets = readJSON(TICKETS_PATH);
    return Object.values(tickets).filter(t => {
      if (filter.guildId && t.guildId !== filter.guildId) return false;
      if (filter.status  && t.status  !== filter.status)  return false;
      return true;
    }).length;
  }
};

module.exports = {
  connectDB,
  getNextTicketNumber,
  saveTicket,
  getTicket,
  closeTicketDB,
  getAllOpenTickets,
  addWarning,
  getWarnings,
  clearWarnings,
  Ticket,
};
