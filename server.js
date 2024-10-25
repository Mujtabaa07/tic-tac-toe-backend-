/* eslint-disable @typescript-eslint/no-require-imports */
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const WebSocket = require('ws');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require('http');

dotenv.config();

const app = express();

app.use(bodyParser.json());
app.use(cors({  origin:'https://tic-tac-toe-full-stack.vercel.app/',
  methods:['GET','POST'],
  allowedHeaders:['Content-Type','Authorization']
}

));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Store connected clients and game states
const clients = new Map();
const games = new Map();

// Create HTTP server
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  const clientId = Date.now().toString();
  clients.set(clientId, ws);
  
  console.log(`New client connected: ${clientId}`);

  ws.on('message', (message) => {
    const data = JSON.parse(message);
    console.log('Received message:', data);
    
    if (data.type === 'join') {
      handleJoin(ws, data, clientId);
    } else if (data.type === 'move') {
      handleMove(data, clientId);
    } else if (data.type === 'symbolSelected') {
      handleSymbolSelection(data, clientId);
    }
  });
  
  ws.on('close', () => {
    handleDisconnect(clientId);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

function handleJoin(ws, data, clientId) {
  const { gameId, playerName } = data;
  
  if (!games.has(gameId)) {
    const newGame = { 
      player1: { id: clientId, name: playerName, symbol: null }, 
      player2: null, 
      board: Array(9).fill(null), 
      currentPlayer: null,
      winner: null 
    };
    games.set(gameId, newGame);
    ws.send(JSON.stringify({type: 'gameCreated', gameId}));
    console.log(`Game created: ${gameId} by ${playerName}`);
  } else {
    const game = games.get(gameId);
    if (!game.player2) {
      game.player2 = { id: clientId, name: playerName, symbol: null };
      games.set(gameId, game);
      console.log(`Player ${playerName} joined game: ${gameId}`);
      
      // Notify both players that the game has started and they need to select symbols
      const gameStartMessage = JSON.stringify({
        type: 'gameStart',
        game: {
          player1: game.player1.name,
          player2: game.player2.name,
          board: game.board,
          currentPlayer: game.currentPlayer
        }
      });
      clients.get(game.player1.id).send(gameStartMessage);
      clients.get(game.player2.id).send(gameStartMessage);
    } else {
      ws.send(JSON.stringify({ type: 'error', message: 'Game already full.' }));
    }
  }
}

function handleSymbolSelection(data, clientId) {
  const { gameId, symbol } = data;
  const game = games.get(gameId);
  
  if (game) {
    if (game.player1.id === clientId) {
      game.player1.symbol = symbol;
      game.player2.symbol = symbol === 'X' ? 'O' : 'X';
    } else if (game.player2.id === clientId) {
      game.player2.symbol = symbol;
      game.player1.symbol = symbol === 'X' ? 'O' : 'X';
    }
    
    game.currentPlayer = 'X';
    games.set(gameId, game);
    
    // Notify both players about the symbol selection
    const symbolSelectionMessage = JSON.stringify({
      type: 'symbolSelected',
      game: {
        player1: { name: game.player1.name, symbol: game.player1.symbol },
        player2: { name: game.player2.name, symbol: game.player2.symbol },
        currentPlayer: game.currentPlayer
      }
    });
    clients.get(game.player1.id).send(symbolSelectionMessage);
    clients.get(game.player2.id).send(symbolSelectionMessage);
  }
}

function handleMove(data, clientId) {
  const { gameId, index } = data;
  const game = games.get(gameId);
  if (game && game.board[index] === null && game.winner === null) {
    const currentPlayer = game.currentPlayer;
    if ((currentPlayer === 'X' && game.player1.symbol === 'X' && game.player1.id === clientId) || 
        (currentPlayer === 'O' && game.player2.symbol === 'O' && game.player2.id === clientId) ||
        (currentPlayer === 'X' && game.player2.symbol === 'X' && game.player2.id === clientId) ||
        (currentPlayer === 'O' && game.player1.symbol === 'O' && game.player1.id === clientId)) {
      game.board[index] = currentPlayer;
      game.winner = checkWinner(game.board);
      game.currentPlayer = currentPlayer === "X" ? "O" : "X";
      
      // Broadcast updated game state to players
      const updateMessage = JSON.stringify({ 
        type: 'moveMade', 
        game: {
          board: game.board,
          currentPlayer: game.currentPlayer,
          winner: game.winner
        }
      });
      clients.get(game.player1.id).send(updateMessage);
      clients.get(game.player2.id).send(updateMessage);
      
      if (game.winner) {
        saveGameToDatabase(game);
      }
    } else {
      clients.get(clientId).send(JSON.stringify({ type: 'error', message: 'Not your turn.' }));
    }
  }
}

function handleDisconnect(clientId) {
  clients.delete(clientId);
  for (const [gameId, game] of games.entries()) {
    if (game.player1.id === clientId || (game.player2 && game.player2.id === clientId)) {
      const otherPlayerId = game.player1.id === clientId ? game.player2.id : game.player1.id;
      const otherPlayerWs = clients.get(otherPlayerId);
      if (otherPlayerWs) {
        otherPlayerWs.send(JSON.stringify({ type: 'gameEnded', message: 'The other player has disconnected.' }));
      }
      games.delete(gameId);
      console.log(`Game ${gameId} ended due to player disconnection`);
      break;
    }
  }
}

const WINNING_COMBINATIONS = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function checkWinner(board) {
  for (let combo of WINNING_COMBINATIONS) {
    if (board[combo[0]] && board[combo[0]] === board[combo[1]] && board[combo[0]] === board[combo[2]]) {
      return board[combo[0]];
    }
  }
  if (board.every(cell => cell !== null)) {
    return 'draw';
  }
  return null;
}

async function saveGameToDatabase(game) {
  const { winner, player1, player2, board } = game;
  const query = 'INSERT INTO games (board, winner, loser, mode) VALUES ($1, $2, $3, $4) RETURNING id';
  const winnerName = winner === player1.symbol ? player1.name : player2.name;
  const loserName = winner === player1.symbol ? player2.name : player1.name;
  const values = [board, winnerName, loserName, 'pvp'];
  try {
    const result = await pool.query(query, values);
    console.log('Game saved to database with id:', result.rows[0].id);
    return result.rows[0].id;
  } catch (error) {
    console.error('Error saving game:', error);
    throw error;
  }
}

app.post('/api/move', async (req, res) => {
  const { board, mode, player1, player2, gameId } = req.body;
  
  console.log('Received move:', { board, mode, player1, player2, gameId });
  
  const winner = checkWinner(board);
  
  try {
    if (winner) {
      const query = 'INSERT INTO games (board, winner, loser, mode) VALUES ($1, $2, $3, $4)RETURNING id';
      const winnerName = winner === 'X' ? player1 : player2;
      const loserName = winner === 'X' ? player2 : player1;
      const values = [board, winnerName, loserName, mode];
      const result = await pool.query(query, values);
      res.json({ winner, gameId: result.rows[0].id });
    } else {
      if (mode === 'online' && gameId) {
        const game = games.get(gameId);
        if (game) {
          game.board = board;
          game.currentPlayer = game.currentPlayer === 'X' ? 'O' : 'X';
          games.set(gameId, game);
        }
      }
      res.json({ winner: null, gameId: null });
    }
  } catch (error) {
    console.error('Error saving game:', error);
    res.status(500).json({ error: 'Failed to save game' });
  }
});

app.get('/api/games', async (req, res) => {
  try {
    const query = 'SELECT id, winner, loser, created_at FROM games WHERE winner IS NOT NULL ORDER BY created_at DESC LIMIT 10';
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const query = `
    SELECT player, 
    SUM(CASE WHEN player = winner THEN 1 ELSE 0 END) AS wins,
    SUM(CASE WHEN player = loser THEN 1 ELSE 0 END) AS losses
    FROM (
      SELECT winner as player, winner, loser FROM games
      UNION ALL
      SELECT loser as player, winner, loser FROM games
      ) as all_players
      GROUP BY player
      ORDER BY wins DESC, losses ASC
      LIMIT 10;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});
wss.on('connection', (ws) => {
  console.log('New WebSocket connection');

  ws.on('message', (message) => {
    console.log('Received:', message);
    // Handle WebSocket messages
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
  });
});
// API routes
app.get('/', (req, res) => {
  res.send('Tic Tac Toe Backend is running');
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});