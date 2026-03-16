import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import session from 'express-session';
import cors from 'cors';
import routes from './routes/index.js';
import { limiter } from './middleware/rateLimit.js';
import plcManager from './services/plcManager.js';
import monitorService from './services/monitorService.js';
import commandQueue from './services/commandQueue.js';
import notificationService from './services/notificationService.js';
import logger from './utils/logger.js';
import config from './utils/configLoader.js';

const app = express();

// CORS middleware - allow frontend from any origin with credentials
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));

// Session middleware (simple in-memory store - suitable for small deployments)
app.use(session({
  secret: config.auth?.session?.secret || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: config.auth?.session?.maxAge || 86400000 }
}));
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.use(express.json());
app.use(limiter);
app.use(routes);

// Healthcheck endpoint
app.get('/api/status', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// JSON parse error handler
app.use((err, req, res, next) => {
  if (err && err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    logger.error(`Invalid JSON: ${err.message}`);
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  return next(err);
});

// WebSocket connection handler
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);
  
  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Broadcast state change notifications from notificationService
notificationService.on('state-change', (notification) => {
  io.emit('state-changed', notification);
  logger.debug(`Broadcasted state change: Room ${notification.room} → ${notification.newState}`);
});

// Note: Interlock logic is now handled directly in relayService.js via commandQueue

const PORT = config.app?.port || 3000;

async function startServer() {
  try {
    await plcManager.initialize();
    
    monitorService.setSocketIO(io);
    monitorService.startMonitoring();

    httpServer.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');
  monitorService.destroy();
  commandQueue.destroy();
  await plcManager.destroy();
  process.exit(0);
});

startServer();