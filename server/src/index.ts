// multiplyer-pong/server/src/index.ts

import express from 'express';
import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors()); // Enable CORS for all routes. IMPORTANT: Ensure client origin is allowed below.

const server = http.createServer(app); // Create HTTP server from Express app

const io = new SocketIOServer(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3001"], // Allows React dev server on these ports
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
  id: string; // 'player1' or 'player2'
  y: number;
  score: number;
  socketId: string; // To identify the socket connection
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
  spectators: string[]; // socket.id of spectators
  intervalId?: NodeJS.Timeout; // For the game loop
}

// --- Server State ---
const gameRooms: Record<string, GameRoom> = {}; // Stores active game rooms
let waitingPlayerSocket: Socket | null = null; // Holds the socket of a player waiting for an opponent

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
    vy: (Math.random() * 4 + 2) * (Math.random() > 0.5 ? 1 : -1), // Random Y speed and direction
  };
}

function resetBall(ball: Ball): void {
  ball.x = CANVAS_WIDTH / 2;
  ball.y = CANVAS_HEIGHT / 2;
  // Make ball speed slightly random on reset, and ensure it doesn't always go to the same player
  const directionX = Math.random() > 0.5 ? 1 : -1;
  ball.vx = (INITIAL_BALL_SPEED_X + Math.random() * 2) * directionX; // Add some randomness
  ball.vy = (Math.random() * 4 + 2) * (Math.random() > 0.5 ? 1 : -1);
}

function createGameRoom(roomId: string, player1Socket: Socket, player2Socket: Socket): GameRoom {
  const room: GameRoom = {
    id: roomId,
    players: [
      createPlayer(player1Socket.id, true), // Player 1
      createPlayer(player2Socket.id, false), // Player 2
    ],
    ball: createBall(),
    status: 'playing',
    spectators: [],
  };
  return room; // Return the created room
}

// --- Game Logic Update ---
function updateGame(roomId: string): void {
  const room = gameRooms[roomId];
  if (!room || room.status !== 'playing') {
    // If room doesn't exist or game isn't playing, stop the loop for this room
    if (room && room.intervalId) {
        clearInterval(room.intervalId);
        delete gameRooms[roomId]; // Clean up if something went wrong
    }
    return;
  }

  const { ball, players } = room;

  // Move ball
  ball.x += ball.vx;
  ball.y += ball.vy;

  // Ball collision with top/bottom walls
  if (ball.y - BALL_RADIUS < 0) {
    ball.y = BALL_RADIUS;
    ball.vy *= -1;
  } else if (ball.y + BALL_RADIUS > CANVAS_HEIGHT) {
    ball.y = CANVAS_HEIGHT - BALL_RADIUS;
    ball.vy *= -1;
  }

  // Ball collision with paddles
  const player1 = players.find(p => p.id === 'player1');
  const player2 = players.find(p => p.id === 'player2');

  if (!player1 || !player2) { // Safety check
    if (room.intervalId) clearInterval(room.intervalId);
    delete gameRooms[roomId];
    return;
  }

  // Player 1 (left paddle) collision
  if (
    ball.vx < 0 && // Ball is moving left
    ball.x - BALL_RADIUS < PADDLE_WIDTH && // Ball's left edge is at or past the paddle's right edge
    ball.x - BALL_RADIUS > 0 && // Ball hasn't completely passed the paddle's left edge
    ball.y + BALL_RADIUS > player1.y && // Ball's bottom is below paddle's top
    ball.y - BALL_RADIUS < player1.y + PADDLE_HEIGHT // Ball's top is above paddle's bottom
  ) {
    ball.x = PADDLE_WIDTH + BALL_RADIUS; // Place ball right outside the paddle
    ball.vx *= -1.1; // Reverse direction and slightly increase speed
    // Add some angle based on where it hits the paddle
    let deltaY = ball.y - (player1.y + PADDLE_HEIGHT / 2);
    ball.vy = deltaY * 0.25; // The further from center, the steeper the angle
    // Cap ball speed
    ball.vx = Math.min(ball.vx, 15);
    ball.vy = Math.max(Math.min(ball.vy, 10), -10);
  }

  // Player 2 (right paddle) collision
  if (
    ball.vx > 0 && // Ball is moving right
    ball.x + BALL_RADIUS > CANVAS_WIDTH - PADDLE_WIDTH && // Ball's right edge is at or past the paddle's left edge
    ball.x + BALL_RADIUS < CANVAS_WIDTH && // Ball hasn't completely passed the paddle's right edge
    ball.y + BALL_RADIUS > player2.y && // Ball's bottom is below paddle's top
    ball.y - BALL_RADIUS < player2.y + PADDLE_HEIGHT // Ball's top is above paddle's bottom
  ) {
    ball.x = CANVAS_WIDTH - PADDLE_WIDTH - BALL_RADIUS; // Place ball right outside the paddle
    ball.vx *= -1.1; // Reverse direction and slightly increase speed
    let deltaY = ball.y - (player2.y + PADDLE_HEIGHT / 2);
    ball.vy = deltaY * 0.25;
    // Cap ball speed
    ball.vx = Math.max(ball.vx, -15);
    ball.vy = Math.max(Math.min(ball.vy, 10), -10);
  }


  // Scoring
  if (ball.x - BALL_RADIUS < 0) { // Player 2 scores
    player2.score++;
    io.to(roomId).emit('scoreUpdate', { player1Score: player1.score, player2Score: player2.score });
    resetBall(ball);
  } else if (ball.x + BALL_RADIUS > CANVAS_WIDTH) { // Player 1 scores
    player1.score++;
    io.to(roomId).emit('scoreUpdate', { player1Score: player1.score, player2Score: player2.score });
    resetBall(ball);
  }

  // Broadcast game state to all players in the room
  io.to(roomId).emit('gameState', { players, ball });
}


// --- Socket.IO Connection Handling ---
io.on('connection', (socket: Socket) => {
  console.log('A user connected:', socket.id);

  if (waitingPlayerSocket) {
    // Second player connected, create a room and start the game
    const player1Socket = waitingPlayerSocket;
    const player2Socket = socket;
    waitingPlayerSocket = null; // Reset waiting player

    const roomId = `room-${player1Socket.id}-${player2Socket.id}`;
    player1Socket.join(roomId);
    player2Socket.join(roomId);

    const room = createGameRoom(roomId, player1Socket, player2Socket);
    gameRooms[roomId] = room; // Store the room

    // Notify players they are in a game and their roles
    player1Socket.emit('gameStart', { roomId, playerRole: 'player1', gameState: room });
    player2Socket.emit('gameStart', { roomId, playerRole: 'player2', gameState: room });
    console.log(`Game started in room ${roomId} with ${player1Socket.id} (P1) and ${player2Socket.id} (P2)`);

    // Start game loop for this room
    // Clear any existing interval for safety, though shouldn't be necessary here
    if (room.intervalId) clearInterval(room.intervalId);
    room.intervalId = setInterval(() => updateGame(roomId), 1000 / 60); // ~60 FPS

  } else {
    // First player, make them wait
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
      // The game loop ('updateGame') will broadcast the new paddle positions via 'gameState'
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (waitingPlayerSocket && waitingPlayerSocket.id === socket.id) {
      waitingPlayerSocket = null;
      console.log('Waiting player disconnected, resetting.');
    }

    // Find if the disconnected player was in any room
    for (const roomId in gameRooms) {
      const room = gameRooms[roomId];
      const playerIndex = room.players.findIndex(p => p.socketId === socket.id);

      if (playerIndex !== -1) {
        const disconnectedPlayer = room.players[playerIndex];
        console.log(`Player ${disconnectedPlayer.id} (${socket.id}) disconnected from room ${roomId}`);
        
        if (room.intervalId) {
          clearInterval(room.intervalId); // Stop game loop for this room
        }

        // Notify the other player in the room
        const otherPlayer = room.players.find(p => p.socketId !== socket.id);
        if (otherPlayer) {
          io.to(otherPlayer.socketId).emit('opponentDisconnected', { message: "Opponent disconnected. Game Over."});
          // Optionally, you could declare the other player the winner or handle differently
        }
        
        delete gameRooms[roomId]; // Clean up the room from server state
        console.log(`Room ${roomId} closed.`);
        break; // Assume player is in at most one room
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});