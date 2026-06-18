const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.get('/', (req, res) => {
  res.json({ message: 'Ohmingle Server Running!' });
});

let waitingUsers = [];
const activePairs = new Map();
let onlineUsers = new Set();

function broadcastOnlineCount() {
  io.emit('onlineCount', onlineUsers.size);
}

io.on('connection', (socket) => {
  console.log('✅ New connection:', socket.id);
  onlineUsers.add(socket.id);
  broadcastOnlineCount();

  socket.on('findStranger', () => {
    // Remove this socket from waiting list if already there
    waitingUsers = waitingUsers.filter(id => id !== socket.id);

    if (waitingUsers.length > 0) {
      // Match with the first waiting user
      const partnerId = waitingUsers.shift();
      const partnerSocket = io.sockets.sockets.get(partnerId);

      if (partnerSocket) {
        activePairs.set(socket.id, partnerId);
        activePairs.set(partnerId, socket.id);

        // Tell this socket it's the "caller" (creates offer)
        socket.emit('strangerFound', { role: 'caller' });
        // Tell the partner it's the "callee" (waits for offer)
        partnerSocket.emit('strangerFound', { role: 'callee' });
      } else {
        // Partner disconnected, add this socket to waiting
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
    if (partnerId) {
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) partnerSocket.emit('offer', offer);
    }
  });

  socket.on('answer', (answer) => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) partnerSocket.emit('answer', answer);
    }
  });

  socket.on('iceCandidate', (candidate) => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) partnerSocket.emit('iceCandidate', candidate);
    }
  });

  socket.on('message', (data) => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) partnerSocket.emit('message', data);
    }
  });

  function disconnectFromPartner() {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) partnerSocket.emit('strangerLeft');
      activePairs.delete(socket.id);
      activePairs.delete(partnerId);
    }
    waitingUsers = waitingUsers.filter(id => id !== socket.id);
  }

  socket.on('skip', () => {
    disconnectFromPartner();
  });

  socket.on('disconnect', () => {
    console.log('❌ Disconnected:', socket.id);
    onlineUsers.delete(socket.id);
    disconnectFromPartner();
    broadcastOnlineCount();
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Ohmingle backend running on port ${PORT}`);
});