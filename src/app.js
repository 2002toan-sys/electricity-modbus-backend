import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import db from './database/db.js';
import routes from './routes/index.js';
import { limiter } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/errorHandler.js';
import { corsOrigin } from './middleware/corsPolicy.js';
import plcManager from './services/plcManager.js';
import monitorService from './services/monitorService.js';
import commandQueue from './services/commandQueue.js';
import notificationService from './services/notificationService.js';
import logger from './utils/logger.js';
import config from './utils/configLoader.js';
import authService from './services/authService.js';

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

// Security headers
app.use(helmet({
  strictTransportSecurity: process.env.NODE_ENV === 'production'
    ? { maxAge: 31_536_000, includeSubDomains: true }
    : false
}));

// CORS middleware - allow configured frontend origins.
app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-CSRF-Protection'],
  credentials: true
}));

const httpServer = createServer(app);

// Configure HTTP Keep-Alive
httpServer.keepAliveTimeout = config.app?.http_keep_alive_timeout || 60000;
httpServer.headersTimeout = httpServer.keepAliveTimeout + 1000;

const io = new Server(httpServer, {
  path: '/socket.io/',
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.use(express.json({ limit: '10kb' }));
app.use(limiter);

// Public healthcheck endpoint used by the container health probe.
app.get('/api/status', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(routes);

// JSON parse error handler
app.use((err, req, res, next) => {
  if (err && err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    logger.error(`Invalid JSON: ${err.message}`);
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  return next(err);
});

// Centralized error handler
app.use(errorHandler);

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const authentication = authService.authenticateToken(token, { updateActivity: false });
  if (!authentication) return next(new Error('Unauthorized'));
  socket.data.user = authentication.user;
  socket.data.accessToken = token;
  return next();
});

// WebSocket connection handler
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  const authCheckInterval = setInterval(() => {
    const authentication = authService.authenticateToken(socket.data.accessToken, { updateActivity: false });
    if (!authentication) socket.disconnect(true);
  }, 60000);

  socket.on('auth-refresh', (token) => {
    const authentication = authService.authenticateToken(token, { updateActivity: false });
    if (!authentication || authentication.user.username !== socket.data.user.username) {
      socket.disconnect(true);
      return;
    }
    socket.data.accessToken = token;
  });

  socket.on('disconnect', () => {
    clearInterval(authCheckInterval);
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Broadcast state change notifications from notificationService
notificationService.on('state-change', (notification) => {
  io.emit('state-changed', notification);
  logger.debug(`Broadcasted state change: Room ${notification.room} → ${notification.newState}`);
});

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
  try {
    db.close();
  } catch { /* ignore */ }
  process.exit(0);
});

startServer();
