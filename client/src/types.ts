// client/src/types.ts
export interface Player {
    id: string;
    y: number;
    score: number;
    socketId: string; // For consistency, though client mainly cares about its own paddle based on playerRole
  }
  
  export interface Ball {
    x: number;
    y: number;
    // vx, vy not strictly needed for client rendering if server dictates all movement
  }
  
  export interface GameState {
    players: Player[];
    ball: Ball;
  }
  
  // Game Constants (mirrored from server for rendering consistency)
  export const CANVAS_WIDTH = 800;
  export const CANVAS_HEIGHT = 600;
  export const PADDLE_WIDTH = 15;
  export const PADDLE_HEIGHT = 100;
  export const BALL_RADIUS = 10;