const express = require('express');
const http    = require('http');
const cors    = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors({ origin: '*' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});

app.get('/', (req, res) => res.json({ status: 'ok', online: onlineUsers.size }));

let waitingUsers  = [];
let interestQueue = [];
const activePairs = new Map();
const onlineUsers = new Set();

function broadcastCount() {
  io.emit('onlineCount', onlineUsers.size);
}

function getCommon(a, b) {
  return a.filter(x => b.map(y => y.toLowerCase()).includes(x.toLowerCase()));
}

io.on('connection', (socket) => {
  console.log('✅ Connected:', socket.id);
  onlineUsers.add(socket.id);
  broadcastCount();

  socket.on('findStranger', (data) => {
    const myInterests = (data && Array.isArray(data.interests)) ? data.interests : [];

    // Clean up from any existing queues
    waitingUsers  = waitingUsers.filter(id => id !== socket.id);
    interestQueue = interestQueue.filter(u => u.id !== socket.id);

    // ── Interest-based matching ────────────────────────────────────────────
    if (myInterests.length > 0) {
      const idx = interestQueue.findIndex(u => getCommon(myInterests, u.interests).length > 0);

      if (idx !== -1) {
        const partner = interestQueue.splice(idx, 1)[0];
        const ps      = io.sockets.sockets.get(partner.id);
        const common  = getCommon(myInterests, partner.interests);
        if (ps) {
          activePairs.set(socket.id, partner.id);
          activePairs.set(partner.id, socket.id);
          socket.emit('strangerFound', { role: 'caller', commonInterests: common });
          ps.emit('strangerFound', { role: 'callee', commonInterests: common });
          console.log(`💚 Interest match: ${socket.id} <-> ${partner.id}`);
          return;
        }
      }

      // No match yet — add to interest queue, emit waiting
      interestQueue.push({ id: socket.id, interests: myInterests });
      socket.emit('waiting');

      // ✅ FIX: 5-second fallback — check activePairs FIRST so already-paired
      //         sockets are never re-matched (this was causing auto-disconnect)
      setTimeout(() => {
        // Guard 1: already paired by interest match or another path?
        if (activePairs.has(socket.id)) return;
        // Guard 2: already removed from interest queue?
        const stillIn = interestQueue.find(u => u.id === socket.id);
        if (!stillIn) return;

        interestQueue = interestQueue.filter(u => u.id !== socket.id);

        if (waitingUsers.length > 0) {
          const pid = waitingUsers.shift();
          const ps  = io.sockets.sockets.get(pid);
          if (ps) {
            activePairs.set(socket.id, pid);
            activePairs.set(pid, socket.id);
            socket.emit('strangerFound', { role: 'caller', commonInterests: [] });
            ps.emit('strangerFound', { role: 'callee', commonInterests: [] });
            return;
          }
        }
        waitingUsers.push(socket.id);
      }, 5000);
      return;
    }

    // ── Random matching (no interests) ─────────────────────────────────────
    // Try interest queue first (match any waiting user who has interests)
    if (interestQueue.length > 0) {
      const partner = interestQueue.shift();
      const ps = io.sockets.sockets.get(partner.id);
      if (ps) {
        activePairs.set(socket.id, partner.id);
        activePairs.set(partner.id, socket.id);
        socket.emit('strangerFound', { role: 'caller', commonInterests: [] });
        ps.emit('strangerFound', { role: 'callee', commonInterests: [] });
        return;
      }
    }

    if (waitingUsers.length > 0) {
      const pid = waitingUsers.shift();
      const ps  = io.sockets.sockets.get(pid);
      if (ps) {
        activePairs.set(socket.id, pid);
        activePairs.set(pid, socket.id);
        socket.emit('strangerFound', { role: 'caller', commonInterests: [] });
        ps.emit('strangerFound', { role: 'callee', commonInterests: [] });
        console.log(`💚 Matched: ${socket.id} <-> ${pid}`);
      } else {
        waitingUsers.push(socket.id);
        socket.emit('waiting');
      }
    } else {
      waitingUsers.push(socket.id);
      socket.emit('waiting');
    }
  });

  socket.on('offer',        o => { const p = activePairs.get(socket.id); if (p) io.sockets.sockets.get(p)?.emit('offer', o); });
  socket.on('answer',       a => { const p = activePairs.get(socket.id); if (p) io.sockets.sockets.get(p)?.emit('answer', a); });
  socket.on('iceCandidate', c => { const p = activePairs.get(socket.id); if (p) io.sockets.sockets.get(p)?.emit('iceCandidate', c); });
  socket.on('message',      d => { const p = activePairs.get(socket.id); if (p) io.sockets.sockets.get(p)?.emit('message', d); });
  socket.on('typing',       () => { const p = activePairs.get(socket.id); if (p) io.sockets.sockets.get(p)?.emit('typing'); });

  function cleanupSocket() {
    const p = activePairs.get(socket.id);
    if (p) {
      io.sockets.sockets.get(p)?.emit('strangerLeft');
      activePairs.delete(p);
      activePairs.delete(socket.id);
    }
    waitingUsers  = waitingUsers.filter(id => id !== socket.id);
    interestQueue = interestQueue.filter(u => u.id !== socket.id);
  }

  socket.on('skip',       () => cleanupSocket());
  socket.on('disconnect', () => {
    console.log('❌ Disconnected:', socket.id);
    onlineUsers.delete(socket.id);
    cleanupSocket();
    broadcastCount();
  });
});

setInterval(() => broadcastCount(), 10000);

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Ohmingle running on port ${PORT}`));