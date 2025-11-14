const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Simple in-memory user tracking by room
const rooms = {}; // rooms[room] = { socketId: username }
const roomsMeta = {}; // roomsMeta[room] = { admin: socketId }

// Message persistence: file-based simple store
const DATA_DIR = path.join(__dirname, 'data');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
let messagesStore = {};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, JSON.stringify({}), 'utf8');
}

function loadMessages() {
  try {
    ensureDataDir();
    const raw = fs.readFileSync(MESSAGES_FILE, 'utf8');
    messagesStore = JSON.parse(raw || '{}');
  } catch (err) {
    console.error('Failed to load messages store:', err);
    messagesStore = {};
  }
}

function persistMessages() {
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messagesStore, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist messages store:', err);
  }
}

function appendMessage(room, message) {
  messagesStore[room] = messagesStore[room] || [];
  messagesStore[room].push(message);
  // keep last 200 messages per room
  if (messagesStore[room].length > 200) messagesStore[room].shift();
  persistMessages();
}

loadMessages();

io.on('connection', (socket) => {
  console.log('socket connected:', socket.id);

  socket.on('join', ({ username, room, email }) => {
    username = String(username || 'Anonymous');
    room = String(room || 'general');
    socket.join(room);
    socket.data.username = username;
    socket.data.email = email || '';
    socket.data.room = room;

    rooms[room] = rooms[room] || {};
    rooms[room][socket.id] = username;
    // set admin if none
    roomsMeta[room] = roomsMeta[room] || {};
    if (!roomsMeta[room].admin) {
      roomsMeta[room].admin = socket.id;
    }

    // send recent history to this socket
    const history = messagesStore[room] || [];
    socket.emit('history', history);

    // notify room and send room data
    io.to(room).emit('system', { message: `${username} joined ${room}`, room, users: Object.values(rooms[room]) });
    io.to(room).emit('roomData', { users: Object.values(rooms[room]), admin: roomsMeta[room].admin ? rooms[room][roomsMeta[room].admin] : null });
  });

  socket.on('message', (payload) => {
    const room = socket.data.room || 'general';
    const username = socket.data.username || 'Anonymous';
    const message = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2,8),
      username,
      text: payload.text,
      email: socket.data.email || '',
      reactions: {},
      time: new Date().toISOString()
    };
    // persist
    appendMessage(room, message);
    io.to(room).emit('message', message);
  });

  // reactions: payload { messageId, emoji }
  socket.on('reaction', ({ messageId, emoji }) => {
    const room = socket.data.room || 'general';
    const username = socket.data.username || 'Anonymous';
    const list = messagesStore[room] || [];
    const msg = list.find((m) => m.id === messageId);
    if (!msg) return;
    msg.reactions = msg.reactions || {};
    msg.reactions[emoji] = msg.reactions[emoji] || [];
    const idx = msg.reactions[emoji].indexOf(username);
    if (idx === -1) {
      msg.reactions[emoji].push(username);
    } else {
      msg.reactions[emoji].splice(idx, 1);
      if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
    }
    persistMessages();
    io.to(room).emit('reaction', { messageId, reactions: msg.reactions });
  });

  // edit message: { messageId, text }
  socket.on('editMessage', ({ messageId, text }) => {
    const room = socket.data.room || 'general';
    const username = socket.data.username || 'Anonymous';
    const list = messagesStore[room] || [];
    const msg = list.find((m) => m.id === messageId);
    if (!msg) return;
    // only author or admin can edit
    const isAdmin = roomsMeta[room] && roomsMeta[room].admin === socket.id;
    if (msg.username !== username && !isAdmin) return;
    msg.text = String(text || '');
    msg.edited = true;
    persistMessages();
    io.to(room).emit('messageEdited', { messageId, text: msg.text });
  });

  // delete message: { messageId }
  socket.on('deleteMessage', ({ messageId }) => {
    const room = socket.data.room || 'general';
    const username = socket.data.username || 'Anonymous';
    const list = messagesStore[room] || [];
    const idx = list.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const msg = list[idx];
    const isAdmin = roomsMeta[room] && roomsMeta[room].admin === socket.id;
    if (msg.username !== username && !isAdmin) return;
    list.splice(idx, 1);
    persistMessages();
    io.to(room).emit('messageDeleted', { messageId });
  });

  // admin action: kick user by username (only admin allowed)
  socket.on('kick', ({ target }) => {
    const room = socket.data.room || 'general';
    if (!roomsMeta[room] || roomsMeta[room].admin !== socket.id) return;
    // find socket ids for target
    const roomMap = rooms[room] || {};
    const targets = Object.entries(roomMap).filter(([sid, name]) => name === target).map(([sid]) => sid);
    targets.forEach((sid) => {
      const s = io.sockets.sockets.get(sid);
      if (s) {
        s.emit('kicked', { room, reason: `Kicked by ${socket.data.username}` });
        s.leave(room);
        try { s.disconnect(true); } catch(e) {}
        delete rooms[room][sid];
      }
    });
    // notify room and update roomData
    io.to(room).emit('system', { message: `${target} was kicked by ${socket.data.username}`, room, users: Object.values(rooms[room]) });
    io.to(room).emit('roomData', { users: Object.values(rooms[room]), admin: roomsMeta[room].admin ? rooms[room][roomsMeta[room].admin] : null });
  });

  socket.on('typing', () => {
    const room = socket.data.room || 'general';
    const username = socket.data.username || 'Anonymous';
    socket.to(room).emit('typing', { username });
  });

  socket.on('stopTyping', () => {
    const room = socket.data.room || 'general';
    const username = socket.data.username || 'Anonymous';
    socket.to(room).emit('stopTyping', { username });
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    const username = socket.data.username;
    if (room && rooms[room]) {
      delete rooms[room][socket.id];
      // if admin left, elect new admin
      if (roomsMeta[room] && roomsMeta[room].admin === socket.id) {
        const remaining = Object.keys(rooms[room]);
        roomsMeta[room].admin = remaining.length ? remaining[0] : null;
      }
      io.to(room).emit('system', { message: `${username || 'Someone'} left ${room}`, room, users: Object.values(rooms[room]) });
      io.to(room).emit('roomData', { users: Object.values(rooms[room]), admin: roomsMeta[room].admin ? rooms[room][roomsMeta[room].admin] : null });
    }
    console.log('socket disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Chat server listening on port ${PORT}`);
});
