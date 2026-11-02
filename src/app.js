import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import session from 'express-session';
import cors from 'cors';
import helmet from 'helmet';
import db from './database/db.js';
import routes from './routes/index.js';
import { limiter } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/errorHandler.js';
import plcManager from './services/plcManager.js';
import monitorService from './services/monitorService.js';
import commandQueue from './services/commandQueue.js';
import notificationService from './services/notificationService.js';
import logger from './utils/logger.js';
import config from './utils/configLoader.js';

const app = express();

// Trust reverse proxy (Caddy/Nginx) so secure cookies work over HTTPS
app.set('trust proxy', 1);

// Security headers
app.use(helmet());

// CORS middleware - strictly allow certain origins with credentials
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const isLocal = /^(http|https):\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(origin);
    const isConfigured = config.app?.frontend_url && origin.startsWith(config.app.frontend_url);
    const allowedOrigins = config.app?.cors_origins || [];
    const isAllowedOrigin = allowedOrigins.includes(origin);

    if (isLocal || isConfigured || isAllowedOrigin) {
      callback(null, true);
    } else {
      callback(null, false); // Block CORS
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));

// Session middleware (simple in-memory store - suitable for small deployments)
app.use(session({
  secret: config.auth?.session?.secret || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  proxy: true, // Force express-session to trust the proxy
  cookie: {
    secure: 'auto',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: config.auth?.session?.maxAge || 86400000
  }
}));
app.use((req, res, next) => {
  if (req.session) {
    req.session.cookie.sameSite = req.secure ? 'none' : 'lax';
  }
  next();
});
const httpServer = createServer(app);

// Configure HTTP Keep-Alive
httpServer.keepAliveTimeout = config.app?.http_keep_alive_timeout || 60000;
httpServer.headersTimeout = httpServer.keepAliveTimeout + 1000;

const io = new Server(httpServer, {
  path: '/socket.io/',
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

// Centralized error handler
app.use(errorHandler);

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
