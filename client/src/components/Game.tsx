import React, { useEffect, useRef, useState } from 'react';
import io, { Socket } from 'socket.io-client';
import { GameState, Player, Ball, CANVAS_WIDTH, CANVAS_HEIGHT, PADDLE_WIDTH, PADDLE_HEIGHT, BALL_RADIUS } from '../types';

const SERVER_URL = "http://localhost:4000";

interface GameProps {}

const Game: React.FC<GameProps> = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerRole, setPlayerRole] = useState<'player1' | 'player2' | 'spectator' | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("Connecting to server...");

  useEffect(() => {
    const newSocket = io(SERVER_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to server with ID:', newSocket.id);
      setMessage("Connected. Waiting for an opponent...");
    });

    newSocket.on('waitingForOpponent', () => {
        setMessage("Waiting for an opponent to join...");
    });

    newSocket.on('gameStart', (data: { roomId: string, playerRole: 'player1' | 'player2', gameState: GameState }) => {
      console.log('Game starting!', data);
      setPlayerRole(data.playerRole);
      setRoomId(data.roomId);
      setGameState(data.gameState); 
      setMessage(`Game started! You are ${data.playerRole}. Room: ${data.roomId}`);
    });

    newSocket.on('gameState', (newGameState: GameState) => {
      setGameState(newGameState);
    });

    newSocket.on('scoreUpdate', (scores: { player1Score: number, player2Score: number }) => {
        setGameState(prev => {
            if (!prev) return null;
            const updatedPlayers = prev.players.map(p => {
                if (p.id === 'player1') return { ...p, score: scores.player1Score };
                if (p.id === 'player2') return { ...p, score: scores.player2Score };
                return p;
            });
            return { ...prev, players: updatedPlayers };
        });
    });

    newSocket.on('opponentDisconnected', (data: { message: string }) => {
        setMessage(data.message + " Refresh to find a new game.");
        setPlayerRole('spectator'); 
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setMessage("Disconnected from server. Please refresh.");
      setPlayerRole(null);
      setGameState(null);
      setRoomId(null);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!socket || !roomId || !playerRole || playerRole === 'spectator') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      let moveDirection: 'up' | 'down' | null = null;
      if (event.key === 'w' || event.key === 'ArrowUp') {
        moveDirection = 'up';
      } else if (event.key === 's' || event.key === 'ArrowDown') {
        moveDirection = 'down';
      }

      if (moveDirection) {
        socket.emit('paddleMove', { direction: moveDirection, roomId });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [socket, roomId, playerRole]); 
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !gameState) { 
        
        if (canvas && canvas.getContext('2d')) {
            const context = canvas.getContext('2d')!;
            context.fillStyle = 'black';
            context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            context.font = '20px Arial';
            context.fillStyle = 'white';
            context.textAlign = 'center';
            context.fillText(message, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
        }
        return;
    }


    const context = canvas.getContext('2d');
    if (!context) return;

    context.fillStyle = 'black';
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    gameState.players.forEach(player => {
      context.fillStyle = 'white';
      const paddleX = player.id === 'player1' ? 0 : CANVAS_WIDTH - PADDLE_WIDTH;
      context.fillRect(paddleX, player.y, PADDLE_WIDTH, PADDLE_HEIGHT);
    });

    const { ball } = gameState;
    context.beginPath();
    context.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
    context.fillStyle = 'white';
    context.fill();
    context.closePath();

    context.font = '30px Arial';
    context.fillStyle = 'white';
    context.textAlign = 'center';
    const player1 = gameState.players.find(p => p.id === 'player1');
    const player2 = gameState.players.find(p => p.id === 'player2');
    if (player1) context.fillText(`${player1.score}`, CANVAS_WIDTH / 4, 50);
    if (player2) context.fillText(`${player2.score}`, (CANVAS_WIDTH / 4) * 3, 50);

  }, [gameState, message]); 


  return (
    <div>
      <h1>Multiplayer Pong</h1>
      <p>{message}</p>
      {playerRole && playerRole !== 'spectator' && <p>You are: {playerRole}</p>}
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        style={{ border: '1px solid white', backgroundColor: 'black' }}
      />
    </div>
  );
};

export default Game;