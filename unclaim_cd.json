const fs = require('fs');
const path = require('path');

const TICKETS_PATH = path.join(__dirname, 'data', 'tickets.json');
const COUNTER_PATH = path.join(__dirname, 'data', 'counter.json');
const POINTS_PATH = path.join(__dirname, 'data', 'points.json');
const UNCLAIM_CD_PATH = path.join(__dirname, 'data', 'unclaim_cd.json');

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

async function connectDB() {
  console.log('[DB] Using JSON file storage.');
}

async function getNextTicketNumber() {
  const counter = readJSON(COUNTER_PATH);
  counter.count = (counter.count || 0) + 1;
  writeJSON(COUNTER_PATH, counter);
  return counter.count;
}

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
  tickets[channelId].status = 'closed';
  tickets[channelId].closedAt = new Date().toISOString();
  tickets[channelId].closedBy = closedBy;
  writeJSON(TICKETS_PATH, tickets);
  return tickets[channelId];
}

async function getAllOpenTickets(guildId) {
  const tickets = readJSON(TICKETS_PATH);
  return Object.values(tickets)
    .filter(t => t.guildId === guildId && t.status === 'open')
    .map(t => ({ ...t, openedAt: new Date(t.openedAt) }));
}

function addPoint(userId) {
  const points = readJSON(POINTS_PATH);
  if (!points[userId]) points[userId] = 0;
  points[userId]++;
  writeJSON(POINTS_PATH, points);
  return points[userId];
}

function getPoints(userId) {
  const points = readJSON(POINTS_PATH);
  return points[userId] || 0;
}

function getAllPoints() {
  return readJSON(POINTS_PATH);
}

function setUnclaimCooldown(userId) {
  const cd = readJSON(UNCLAIM_CD_PATH);
  cd[userId] = Date.now();
  writeJSON(UNCLAIM_CD_PATH, cd);
}

function checkUnclaimCooldown(userId) {
  const cd = readJSON(UNCLAIM_CD_PATH);
  if (!cd[userId]) return 0;
  const elapsed = Date.now() - cd[userId];
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  if (elapsed < TWO_HOURS) {
    return Math.ceil((TWO_HOURS - elapsed) / 60000);
  }
  return 0;
}

module.exports = {
  connectDB,
  getNextTicketNumber,
  saveTicket,
  getTicket,
  closeTicketDB,
  getAllOpenTickets,
  addPoint,
  getPoints,
  getAllPoints,
  setUnclaimCooldown,
  checkUnclaimCooldown,
};
