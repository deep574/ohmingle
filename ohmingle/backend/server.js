const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(cors({ origin: '*' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'], credentials: false },
  allowEIO3: true
});

app.get('/', (req, res) => res.json({ message: 'Ohmingle Server Running!' }));

let waitingUsers = [];   // simple queue (no interests)
let interestQueue = [];  // {id, interests} for interest matching
const activePairs = new Map();
const onlineUsers = new Set();

function broadcastOnlineCount() {
  io.emit('onlineCount', onlineUsers.size);
}

// ── FEATURE 7: Find common interests ──────────────────────────────────────
function getCommonInterests(a, b) {
  return a.filter(i => b.map(x => x.toLowerCase()).includes(i.toLowerCase()));
}

io.on('connection', (socket) => {
  console.log('✅ Connected:', socket.id);
  onlineUsers.add(socket.id);
  broadcastOnlineCount();

  // ── EXISTING + FEATURE 7: findStranger with interests ──────────────────
  socket.on('findStranger', (data) => {
    const myInterests = (data && data.interests) ? data.interests : [];

    // Remove from any existing queues
    waitingUsers = waitingUsers.filter(id => id !== socket.id);
    interestQueue = interestQueue.filter(u => u.id !== socket.id);

    // ── FEATURE 7: Try interest match first ───────────────────────────────
    if (myInterests.length > 0) {
      const matchIndex = interestQueue.findIndex(u => {
        const common = getCommonInterests(myInterests, u.interests);
        return common.length > 0;
      });

      if (matchIndex !== -1) {
        const partner = interestQueue.splice(matchIndex, 1)[0];
        const partnerSocket = io.sockets.sockets.get(partner.id);
        const common = getCommonInterests(myInterests, partner.interests);

        if (partnerSocket) {
          activePairs.set(socket.id, partner.id);
          activePairs.set(partner.id, socket.id);
          socket.emit('strangerFound', { role: 'caller', commonInterests: common });
          partnerSocket.emit('strangerFound', { role: 'callee', commonInterests: common });
          console.log(`💚 Interest match: ${socket.id} <-> ${partner.id} [${common}]`);
          return;
        }
      }

      // No interest match — add to interest queue + fallback timer
      interestQueue.push({ id: socket.id, interests: myInterests });
      socket.emit('waiting');

      // Fallback: if no match in 5 seconds, match randomly
      setTimeout(() => {
        const stillWaiting = interestQueue.find(u => u.id === socket.id);
        if (!stillWaiting) return; // already matched

        // Remove from interest queue
        interestQueue = interestQueue.filter(u => u.id !== socket.id);

        // Try normal queue
        if (waitingUsers.length > 0) {
          const partnerId = waitingUsers.shift();
          const partnerSocket = io.sockets.sockets.get(partnerId);
          if (partnerSocket) {
            activePairs.set(socket.id, partnerId);
            activePairs.set(partnerId, socket.id);
            socket.emit('strangerFound', { role: 'caller', commonInterests: [] });
            partnerSocket.emit('strangerFound', { role: 'callee', commonInterests: [] });
            console.log(`💛 Fallback match: ${socket.id} <-> ${partnerId}`);
            return;
          }
        }

        // Add to normal queue as fallback
        waitingUsers.push(socket.id);
      }, 5000);

      return;
    }

    // ── Normal random matching (no interests) ────────────────────────────
    // Check interest queue first for any waiting user
    if (interestQueue.length > 0) {
      const partner = interestQueue.shift();
      const partnerSocket = io.sockets.sockets.get(partner.id);
      if (partnerSocket) {
        activePairs.set(socket.id, partner.id);
        activePairs.set(partner.id, socket.id);
        socket.emit('strangerFound', { role: 'caller', commonInterests: [] });
        partnerSocket.emit('strangerFound', { role: 'callee', commonInterests: [] });
        return;
      }
    }

    if (waitingUsers.length > 0) {
      const partnerId = waitingUsers.shift();
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        activePairs.set(socket.id, partnerId);
        activePairs.set(partnerId, socket.id);
        socket.emit('strangerFound', { role: 'caller', commonInterests: [] });
        partnerSocket.emit('strangerFound', { role: 'callee', commonInterests: [] });
        console.log(`💚 Matched: ${socket.id} <-> ${partnerId}`);
      } else {
        waitingUsers.push(socket.id);
        socket.emit('waiting');
      }
    } else {
      waitingUsers.push(socket.id);
      socket.emit('waiting');
    }
  });

  socket.on('offer', offer => {
    const p = activePairs.get(socket.id);
    if (p) io.sockets.sockets.get(p)?.emit('offer', offer);
  });

  socket.on('answer', answer => {
    const p = activePairs.get(socket.id);
    if (p) io.sockets.sockets.get(p)?.emit('answer', answer);
  });

  socket.on('iceCandidate', c => {
    const p = activePairs.get(socket.id);
    if (p) io.sockets.sockets.get(p)?.emit('iceCandidate', c);
  });

  socket.on('message', data => {
    const p = activePairs.get(socket.id);
    if (p) io.sockets.sockets.get(p)?.emit('message', data);
  });

  // ── FEATURE 5: Typing indicator ───────────────────────────────────────
  socket.on('typing', () => {
    const p = activePairs.get(socket.id);
    if (p) io.sockets.sockets.get(p)?.emit('typing');
  });

  function cleanupSocket() {
    const p = activePairs.get(socket.id);
    if (p) {
      io.sockets.sockets.get(p)?.emit('strangerLeft');
      activePairs.delete(p);
      activePairs.delete(socket.id);
    }
    waitingUsers = waitingUsers.filter(id => id !== socket.id);
    interestQueue = interestQueue.filter(u => u.id !== socket.id);
  }

  socket.on('skip', () => cleanupSocket());

  socket.on('disconnect', () => {
    console.log('❌ Disconnected:', socket.id);
    onlineUsers.delete(socket.id);
    cleanupSocket();
    broadcastOnlineCount();
  });
});

setInterval(() => broadcastOnlineCount(), 10000);

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Ohmingle backend running on port ${PORT}`);
});