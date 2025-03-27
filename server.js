const express = require('express');
const cors = require('cors');
const app = express();
const server = require('http').createServer(app);

const corsOrigin = process.env.NODE_ENV === 'production' 
  ? ['https://catupet.vercel.app', 'https://imasdk.googleapis.com', 'https://pubads.g.doubleclick.net']
  : ['http://localhost:3000', 'https://imasdk.googleapis.com', 'https://pubads.g.doubleclick.net'];

app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ["GET", "POST"]
}));

// Add headers for CORS
app.use((req, res, next) => {
  res.header('Cross-Origin-Opener-Policy', 'same-origin');
  res.header('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

// Aktif oyuncuları tutacak obje
const players = {};

// Rooms object to store room data
const rooms = {};

// Generate random 8-digit room ID
const generateRoomId = () => {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
};

// Generate consistent random values for a room
const generateRoomData = () => {
  const treePositions = [];
  const rockPositions = [];
  
  // Generate consistent tree positions
  for(let i = 0; i < 20; i++) {
    treePositions.push({
      x: (Math.random() - 0.5) * (100 - 10),
      z: (Math.random() - 0.5) * (100 - 10)
    });
  }
  
  // Generate consistent rock positions
  for(let i = 0; i < 15; i++) {
    rockPositions.push({
      x: (Math.random() - 0.5) * (100 - 10),
      z: (Math.random() - 0.5) * (100 - 10)
    });
  }
  
  return {
    startTime: Date.now(),
    treePositions,
    rockPositions
  };
};

const io = require('socket.io')(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? 'https://catupet.vercel.app'
      : 'http://localhost:3000',
    methods: ["GET", "POST"],
    credentials: true
  }
});

io.on('connection', (socket) => {
  console.log('Yeni oyuncu bağlandı:', socket.id);

  socket.on('playerInit', (playerData) => {
    // Debug için
    console.log('Player init data:', playerData);
    
    const player = {
      id: socket.id,
      x: Math.random() * 10 - 5,
      z: Math.random() * 10 - 5,
      color: playerData.color,
      username: playerData.username
    };

    players[socket.id] = player;
    
    // Debug için
    console.log('Current players:', players);
    
    socket.emit('currentPlayers', players);
    socket.broadcast.emit('newPlayer', player);
  });

  // Handle room creation/joining
  socket.on('joinRoom', ({ roomId, isRandom, playerData }) => {
    let targetRoomId = roomId;
    
    if (isRandom) {
      targetRoomId = generateRoomId();
    }
    
    // Create room if it doesn't exist
    if (!rooms[targetRoomId]) {
      rooms[targetRoomId] = {
        players: {},
        ...generateRoomData()
      };
    }
    
    // Leave previous room if any
    if (socket.roomId) {
      const previousRoom = socket.roomId;
      socket.leave(previousRoom);
      if (rooms[previousRoom]?.players[socket.id]) {
        delete rooms[previousRoom].players[socket.id];
        // Eski odadaki oyunculara ayrılan oyuncuyu bildir
        socket.to(previousRoom).emit('playerDisconnected', socket.id);
      }
    }
    
    // Join new room
    socket.join(targetRoomId);
    socket.roomId = targetRoomId;
    
    // Add player to room
    rooms[targetRoomId].players[socket.id] = {
      id: socket.id,
      x: Math.random() * 10 - 5,
      z: Math.random() * 10 - 5,
      ...playerData
    };
    
    // Send room data and ONLY the players in this room to the new player
    socket.emit('roomJoined', {
      roomId: targetRoomId,
      roomData: rooms[targetRoomId],
      currentPlayers: rooms[targetRoomId].players // Sadece bu odadaki oyuncuları gönder
    });
    
    // Notify ONLY the players in this room about the new player
    socket.to(targetRoomId).emit('newPlayer', {
      id: socket.id,
      ...rooms[targetRoomId].players[socket.id]
    });
  });

  // Oyuncu hareketi - sadece aynı odadaki oyunculara bildir
  socket.on('playerMove', (position) => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]?.players[socket.id]) {
      // Oyuncunun pozisyonunu güncelle
      rooms[roomId].players[socket.id] = {
        ...rooms[roomId].players[socket.id],
        ...position
      };
      
      // SADECE aynı odadaki oyunculara hareket bilgisini gönder
      socket.to(roomId).emit('playerMoved', {
        id: socket.id,
        ...rooms[roomId].players[socket.id]
      });
    }
  });

  // Bağlantı koptuğunda
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      // Oyuncuyu odadan sil
      delete rooms[roomId].players[socket.id];
      
      // Oda boşsa odayı sil
      if (Object.keys(rooms[roomId].players).length === 0) {
        delete rooms[roomId];
      } else {
        // SADECE aynı odadaki oyunculara ayrılan oyuncuyu bildir
        socket.to(roomId).emit('playerDisconnected', socket.id);
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});