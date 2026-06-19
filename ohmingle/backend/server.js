const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  // ✅ FIX: Allow both websocket and polling
  transports: ['websocket', 'polling'],
});

app.get('/', (req, res) => {
  res.json({ message: 'Ohmingle Server Running!', online: onlineUsers.size });
});

let waitingUsers = [];
const activePairs = new Map();
const onlineUsers = new Set();   // ✅ Use const so it's never accidentally replaced

function broadcastOnlineCount() {
  const count = onlineUsers.size;
  console.log(`📡 Broadcasting online count: ${count}`);
  io.emit('onlineCount', count);  // ✅ io.emit = send to ALL connected clients
}

io.on('connection', (socket) => {
  console.log('✅ Connected:', socket.id, '| Total:', onlineUsers.size + 1);
  onlineUsers.add(socket.id);
  broadcastOnlineCount();  // ✅ Broadcast immediately when someone joins

  socket.on('findStranger', () => {
    waitingUsers = waitingUsers.filter(id => id !== socket.id);

    if (waitingUsers.length > 0) {
      const partnerId = waitingUsers.shift();
      const partnerSocket = io.sockets.sockets.get(partnerId);

      if (partnerSocket) {
        activePairs.set(socket.id, partnerId);
        activePairs.set(partnerId, socket.id);
        socket.emit('strangerFound', { role: 'caller' });
        partnerSocket.emit('strangerFound', { role: 'callee' });
        console.log(`💚 Matched: ${socket.id} <-> ${partnerId}`);
      } else {
        // Partner already gone — try again
        waitingUsers.push(socket.id);
        socket.emit('waiting');
      }
    } else {
      waitingUsers.push(socket.id);
      socket.emit('waiting');
    }
  });

  socket.on('offer', (offer) => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) io.sockets.sockets.get(partnerId)?.emit('offer', offer);
  });

  socket.on('answer', (answer) => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) io.sockets.sockets.get(partnerId)?.emit('answer', answer);
  });

  socket.on('iceCandidate', (candidate) => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) io.sockets.sockets.get(partnerId)?.emit('iceCandidate', candidate);
  });

  socket.on('message', (data) => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) io.sockets.sockets.get(partnerId)?.emit('message', data);
  });

  function cleanupSocket() {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      io.sockets.sockets.get(partnerId)?.emit('strangerLeft');
      activePairs.delete(partnerId);
      activePairs.delete(socket.id);
    }
    waitingUsers = waitingUsers.filter(id => id !== socket.id);
  }

  socket.on('skip', () => {
    cleanupSocket();
  });

  socket.on('disconnect', () => {
    console.log('❌ Disconnected:', socket.id, '| Total:', onlineUsers.size - 1);
    onlineUsers.delete(socket.id);
    cleanupSocket();
    broadcastOnlineCount();  // ✅ Broadcast immediately when someone leaves
  });
});

// ✅ FIX: Sync count every 10 seconds to fix any missed updates
setInterval(() => {
  broadcastOnlineCount();
}, 10000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Ohmingle backend running on port ${PORT}`);
});