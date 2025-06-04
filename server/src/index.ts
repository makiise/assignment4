import express from 'express';
import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors()); // Enable CORS for all routes
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: "http://localhost:3000", // Your React app's address
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 4000;

// --- Game Constants ---
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PADDLE_WIDTH = 15;
const PADDLE_HEIGHT = 100;
const BALL_RADIUS = 10;
const PADDLE_SPEED = 10;
const INITIAL_BALL_SPEED_X = 5;
const INITIAL_BALL_SPEED_Y = 5;

// --- Game State Interfaces ---
interface Player {
  id: string;
  y: number;
  score: number;
  socketId: string;
}

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GameRoom {
  id: string;
  players: Player[];
  ball: Ball;
  status: 'waiting' | 'playing' | 'finished';
  spectators: string[];
  intervalId?: NodeJS.Timeout;
}

// --- Server State ---
const gameRooms: Record<string, GameRoom> = {};
let waitingPlayerSocket: Socket | null = null;

// --- Helper Functions ---
function createPlayer(socketId: string, isPlayerOne: boolean): Player {
  return {
    id: isPlayerOne ? 'player1' : 'player2',
    y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2,
    score: 0,
    socketId: socketId,
  };
}

function createBall(): Ball {
  return {
    x: CANVAS_WIDTH / 2,
    y: CANVAS_HEIGHT / 2,
    vx: Math.random() > 0.5 ? INITIAL_BALL_SPEED_X : -INITIAL_BALL_SPEED_X,
    vy: Math.random() > 0.5 ? INITIAL_BALL_SPEED_Y : -INITIAL_BALL_SPEED_Y,
  };
}

function resetBall(ball: Ball): void {
  ball.x = CANVAS_WIDTH / 2;
  ball.y = CANVAS_HEIGHT / 2;
  ball.vx = (Math.random() > 0.5 ? INITIAL_BALL_SPEED_X : -INITIAL_BALL_SPEED_X) * (Math.random() * 0.5 + 0.75); // Add some variation
  ball.vy = (Math.random() * 4 + 2) * (Math.random() > 0.5 ? 1 : -1);
}

function createGameRoom(roomId: string, player1Socket: Socket, player2Socket: Socket): GameRoom {
  const room: GameRoom = {
    id: roomId,
    players: [
      createPlayer(player1Socket.id, true),
      createPlayer(player2Socket.id, false),
    ],
    ball: createBall(),
    status: 'playing',
    spectators: [],
  };
  gameRooms[roomId] = room;
  return room;
}

// --- Game Logic Update ---
function updateGame(roomId: string): void {
  const room = gameRooms[roomId];
  if (!room || room.status !== 'playing') return;

  const { ball, players } = room;

  ball.x += ball.vx;
  ball.y += ball.vy;

  if (ball.y - BALL_RADIUS < 0 || ball.y + BALL_RADIUS > CANVAS_HEIGHT) {
    ball.vy *= -1;
    ball.y = Math.max(BALL_RADIUS, Math.min(ball.y, CANVAS_HEIGHT - BALL_RADIUS));
  }

  const player1 = players.find(p => p.id === 'player1')!;
  const player2 = players.find(p => p.id === 'player2')!;

  // Player 1 (left paddle) collision
  if (ball.vx < 0 && ball.x - BALL_RADIUS < PADDLE_WIDTH && ball.x > 0 && // Moving left & within paddle horizontal zone
      ball.y > player1.y && ball.y < player1.y + PADDLE_HEIGHT) {
    ball.vx *= -1.1; // Reverse and increase speed
    ball.vy += (ball.y - (player1.y + PADDLE_HEIGHT / 2)) * 0.15; // Add spin based on hit location
    ball.x = PADDLE_WIDTH + BALL_RADIUS; // Ensure ball is outside paddle
  }

  // Player 2 (right paddle) collision
  if (ball.vx > 0 && ball.x + BALL_RADIUS > CANVAS_WIDTH - PADDLE_WIDTH && ball.x < CANVAS_WIDTH && // Moving right & within paddle horizontal zone
      ball.y > player2.y && ball.y < player2.y + PADDLE_HEIGHT) {
    ball.vx *= -1.1; // Reverse and increase speed
    ball.vy += (ball.y - (player2.y + PADDLE_HEIGHT / 2)) * 0.15; // Add spin based on hit location
    ball.x = CANVAS_WIDTH - PADDLE_WIDTH - BALL_RADIUS; // Ensure ball is outside paddle
  }
  
  // Speed cap
  ball.vx = Math.max(-15, Math.min(15, ball.vx));
  ball.vy = Math.max(-10, Math.min(10, ball.vy));


  if (ball.x - BALL_RADIUS < 0) {
    player2.score++;
    resetBall(ball);
    io.to(roomId).emit('scoreUpdate', { player1Score: player1.score, player2Score: player2.score });
  } else if (ball.x + BALL_RADIUS > CANVAS_WIDTH) {
    player1.score++;
    resetBall(ball);
    io.to(roomId).emit('scoreUpdate', { player1Score: player1.score, player2Score: player2.score });
  }

  io.to(roomId).emit('gameState', { players, ball });
}

// --- Socket.IO Connection Handling ---
io.on('connection', (socket: Socket) => {
  console.log('A user connected:', socket.id);

  if (waitingPlayerSocket) {
    const player1Socket = waitingPlayerSocket;
    const player2Socket = socket;
    waitingPlayerSocket = null;

    const roomId = `room-${player1Socket.id}-${player2Socket.id}`;
    player1Socket.join(roomId);
    player2Socket.join(roomId);

    const room = createGameRoom(roomId, player1Socket, player2Socket);
    gameRooms[roomId] = room;

    player1Socket.emit('gameStart', { roomId, playerRole: 'player1', gameState: room });
    player2Socket.emit('gameStart', { roomId, playerRole: 'player2', gameState: room });
    console.log(`Game started in room ${roomId} with ${player1Socket.id} (P1) and ${player2Socket.id} (P2)`);

    room.intervalId = setInterval(() => updateGame(roomId), 1000 / 60); // 60 FPS
  } else {
    waitingPlayerSocket = socket;
    socket.emit('waitingForOpponent');
    console.log(`${socket.id} is waiting for an opponent.`);
  }

  socket.on('paddleMove', (data: { direction: 'up' | 'down', roomId: string }) => {
    const room = gameRooms[data.roomId];
    if (!room || room.status !== 'playing') return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (player) {
      if (data.direction === 'up') {
        player.y = Math.max(0, player.y - PADDLE_SPEED);
      } else if (data.direction === 'down') {
        player.y = Math.min(CANVAS_HEIGHT - PADDLE_HEIGHT, player.y + PADDLE_SPEED);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (waitingPlayerSocket && waitingPlayerSocket.id === socket.id) {
      waitingPlayerSocket = null;
      console.log('Waiting player disconnected.');
    }

    for (const roomId in gameRooms) {
      const room = gameRooms[roomId];
      const playerInRoom = room.players.find(p => p.socketId === socket.id);

      if (playerInRoom) {
        console.log(`Player ${playerInRoom.id} (${socket.id}) disconnected from room ${roomId}`);
        if (room.intervalId) clearInterval(room.intervalId);
        
        const otherPlayer = room.players.find(p => p.socketId !== socket.id);
        if (otherPlayer) {
          io.to(otherPlayer.socketId).emit('opponentDisconnected', { message: "Opponent disconnected. Game Over."});
        }
        delete gameRooms[roomId];
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});


