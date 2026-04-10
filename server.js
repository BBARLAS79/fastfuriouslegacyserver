const fs    = require('fs');
const http  = require('http');
const https = require('https');
const crypto = require('crypto');
const path  = require('path');
const config = require('./src/config');
const { createAppServer } = require('./src/app');
const { getUserState } = require('./src/services/userService');

// ── logging ──────────────────────────────────────────────────────────────────
const consoleLoggingEnabled = true;
const fileLoggingEnabled    = false;

const logStream = fileLoggingEnabled
  ? fs.createWriteStream(path.join(config.dataDir, 'server.log'), { flags: 'a' })
  : null;

function writeLog(level, msg, toStdErr = false) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
  if (consoleLoggingEnabled) {
    if (toStdErr) process.stderr.write(line);
    else          process.stdout.write(line);
  }
  if (fileLoggingEnabled && logStream) logStream.write(line);
}

function logInfo(msg)  { writeLog('INFO',  msg, false); }
function logError(msg) { writeLog('ERROR', msg, true);  }

logInfo('FF7 Custom Server v0.1.0');
logInfo(`Console logging: ${consoleLoggingEnabled ? 'ENABLED' : 'DISABLED'}`);
logInfo(`File logging:    ${fileLoggingEnabled    ? 'ENABLED' : 'DISABLED'}`);
logInfo('Server is starting...');

// ── ensure required directories exist ────────────────────────────────────────
[config.dataDir, config.saveDir, config.jsonResponsesDir].forEach((dir) => {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logInfo(`Created directory: ${dir}`);
    }
  } catch (e) {
    logError(`Could not create directory ${dir}: ${e.message}`);
  }
});

// ── app ───────────────────────────────────────────────────────────────────────
const app = createAppServer();
const chatRooms = new Map();
let nextServerRpcId = 1;

// ── raw websocket push handler (no ws dependency needed) ─────────────────────
function encodeWebSocketFrame(opcode, payloadBuffer) {
  const payload = Buffer.isBuffer(payloadBuffer) ? payloadBuffer : Buffer.from(payloadBuffer || '');
  const length  = payload.length;
  let header;

  if (length < 126) {
    header    = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  header[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([header, payload]);
}

function handlePushSocketData(socket, chunk) {
  if (!chunk || chunk.length < 2) return;

  const firstByte   = chunk[0];
  const secondByte  = chunk[1];
  const opcode      = firstByte & 0x0f;
  const masked      = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7f;
  let offset        = 2;

  if (payloadLength === 126) {
    if (chunk.length < 4) return;
    payloadLength = chunk.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (chunk.length < 10) return;
    payloadLength = Number(chunk.readBigUInt64BE(2));
    offset = 10;
  }

  let payload = chunk.slice(offset);
  if (masked) {
    const mask = chunk.slice(offset, offset + 4);
    payload = chunk.slice(offset + 4, offset + 4 + payloadLength);
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
  } else {
    payload = payload.slice(0, payloadLength);
  }

  if (opcode === 0x8) { socket.write(encodeWebSocketFrame(0x8, payload)); socket.end(); return; }
  if (opcode === 0x9) { socket.write(encodeWebSocketFrame(0xA, payload)); return; }
  if (opcode === 0x1) {
    handlePushTextMessage(socket, payload.toString('utf8'));
  }
}

function getChatRoom(roomName) {
  const normalizedRoomName = String(roomName || '').trim();
  if (!normalizedRoomName) {
    return null;
  }
  if (!chatRooms.has(normalizedRoomName)) {
    chatRooms.set(normalizedRoomName, {
      name: normalizedRoomName,
      members: new Set(),
      messages: []
    });
  }
  return chatRooms.get(normalizedRoomName);
}

function sendSocketJson(socket, payload) {
  socket.write(encodeWebSocketFrame(0x1, JSON.stringify(payload)));
}

function sendRpcResult(socket, id, error, result) {
  sendSocketJson(socket, [1, Number(id) || 0, error == null ? null : String(error), result == null ? null : result]);
}

function sendRpcEvent(socket, rpcName, args) {
  const rpcId = nextServerRpcId++;
  sendSocketJson(socket, [2, rpcId, String(rpcName || ''), Array.isArray(args) ? args : []]);
}

function normalizeSenderData(sender) {
  return sender && typeof sender === 'object' ? sender : {};
}

function buildChatItem(channel, text, sender, socketState) {
  const senderData = normalizeSenderData(sender);
  const userId = String(
    senderData.uid ||
    socketState.userId ||
    'default'
  ).trim() || 'default';
  const userName = String(
    senderData.name ||
    socketState.userName ||
    `Player ${userId}`
  ).trim() || `Player ${userId}`;
  const locale = String(
    senderData.locale ||
    senderData.lang ||
    socketState.locale ||
    'tr_TR'
  ).trim() || 'tr_TR';

  socketState.userId = userId;
  socketState.userName = userName;
  socketState.locale = locale;

  return {
    uid: Number.isFinite(Number(userId)) ? Number(userId) : userId,
    id: `chat_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
    text: String(text || ''),
    filtered: String(text || ''),
    attributes: senderData,
    channel: String(channel || ''),
    name: userName,
    locale,
    ts: Math.floor(Date.now() / 1000)
  };
}

function rememberSocketIdentity(socketState, maybeUserId) {
  const normalizedUserId = String(maybeUserId || '').trim();
  if (!normalizedUserId) {
    return;
  }
  socketState.userId = normalizedUserId;
  const user = getUserState(normalizedUserId);
  const profile = user && user.profile && typeof user.profile === 'object' ? user.profile : {};
  const name = String(profile.name || profile.Nickname || '').trim();
  if (name) {
    socketState.userName = name;
  }
}

function joinChatRoom(socket, roomName, options = {}) {
  const room = getChatRoom(roomName);
  if (!room) {
    return [];
  }
  room.members.add(socket);
  socket.chatState.rooms.add(room.name);

  const limit = Math.max(0, Math.trunc(Number(options.limit || 0)));
  if (limit > 0) {
    return room.messages.slice(-limit);
  }
  return room.messages.slice();
}

function leaveAllChatRooms(socket) {
  if (!socket.chatState || !socket.chatState.rooms) {
    return;
  }
  socket.chatState.rooms.forEach((roomName) => {
    const room = chatRooms.get(roomName);
    if (!room) return;
    room.members.delete(socket);
    if (room.members.size === 0 && room.messages.length === 0) {
      chatRooms.delete(roomName);
    }
  });
  socket.chatState.rooms.clear();
}

function broadcastChatItem(room, item) {
  if (!room) {
    return;
  }
  room.members.forEach((memberSocket) => {
    if (memberSocket.destroyed) {
      room.members.delete(memberSocket);
      return;
    }
    sendRpcEvent(memberSocket, room.name, [item]);
  });
}

function handlePushRpc(socket, message) {
  if (!Array.isArray(message) || message.length !== 4) {
    throw new Error(`Invalid message: ${JSON.stringify(message)}`);
  }

  const type = Number(message[0]);
  const id = Number(message[1]);
  const rpcName = String(message[2] || '');
  const args = Array.isArray(message[3]) ? message[3] : [];

  if (type === 1) {
    return;
  }

  // FF7 TalkWebSocket sends client RPC requests as type 0.
  // Type 2 is also a valid fire-and-forget RPC frame.
  if (type !== 0 && type !== 2) {
    throw new Error(`Unknown message type ${type}`);
  }

  if (rpcName === 'join') {
    const roomName = String(args[0] || '').trim();
    const options = args[1] && typeof args[1] === 'object' ? args[1] : {};
    const history = joinChatRoom(socket, roomName, options);
    return sendRpcResult(socket, id, null, history);
  }

  if (rpcName === 'history') {
    const roomName = String(args[0] || '').trim();
    const options = args[1] && typeof args[1] === 'object' ? args[1] : {};
    const room = getChatRoom(roomName);
    if (!room) {
      return sendRpcResult(socket, id, null, []);
    }

    let history = room.messages.slice();
    const lastMessageId = String(options.last || '').trim();
    if (lastMessageId) {
      const lastIndex = history.findIndex((entry) => String(entry && entry.id) === lastMessageId);
      if (lastIndex > 0) {
        history = history.slice(0, lastIndex);
      }
    }

    const limit = Math.max(0, Math.trunc(Number(options.limit || 0)));
    if (limit > 0 && history.length > limit) {
      history = history.slice(-limit);
    }

    return sendRpcResult(socket, id, null, history);
  }

  if (rpcName === 'send') {
    const roomName = String(args[0] || '').trim();
    const text = String(args[1] || '');
    const sender = args[2] && typeof args[2] === 'object' ? args[2] : {};
    const extra = args[3] && typeof args[3] === 'object' ? args[3] : {};
    rememberSocketIdentity(socket.chatState, sender.uid || extra.uid || extra.playerId);

    if (!roomName) {
      return sendRpcResult(socket, id, 'room is not joined', null);
    }

    if (!socket.chatState.rooms.has(roomName)) {
      joinChatRoom(socket, roomName, { limit: 0 });
    }

    const room = getChatRoom(roomName);
    const item = buildChatItem(roomName, text, sender, socket.chatState);
    room.messages.push(item);
    if (room.messages.length > 50) {
      room.messages.splice(0, room.messages.length - 50);
    }
    sendRpcResult(socket, id, null, item);
    broadcastChatItem(room, item);
    return;
  }

  if (rpcName === 'leave') {
    const roomName = String(args[0] || '').trim();
    const room = getChatRoom(roomName);
    if (room) {
      room.members.delete(socket);
    }
    socket.chatState.rooms.delete(roomName);
    return sendRpcResult(socket, id, null, true);
  }

  if (rpcName === 'report') {
    return sendRpcResult(socket, id, null, true);
  }

  return sendRpcResult(socket, id, 'no handler for rpc', null);
}

function handlePushTextMessage(socket, text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch (_) {
    return sendSocketJson(socket, { type: 'ack', connected: true });
  }

  if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
    const authToken = String(parsed.authToken || parsed.token || '').trim();
    const uid = String(parsed.uid || parsed.userId || parsed.playerId || '').trim();
    if (uid) {
      rememberSocketIdentity(socket.chatState, uid);
    }
    if (authToken) {
      return sendSocketJson(socket, {
        type: 'authResponse',
        authToken,
        token: authToken,
        connected: true,
        status: 'connected'
      });
    }
    return sendSocketJson(socket, { type: 'ack', connected: true });
  }

  try {
    handlePushRpc(socket, parsed);
  } catch (error) {
    logError(`[WS PUSH] ${error.message}`);
    sendSocketJson(socket, { error: error.message });
  }
}

function handlePushUpgrade(req, socket) {
  const websocketKey = req.headers['sec-websocket-key'];
  if (!websocketKey) { socket.destroy(); return; }

  const accept = crypto
    .createHash('sha1')
    .update(`${websocketKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, 'binary')
    .digest('base64');

  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '\r\n'
  ].join('\r\n'));

  socket.setKeepAlive(true, 30000);
  socket.setNoDelay(true);
  socket.chatState = {
    rooms: new Set(),
    userId: '',
    userName: '',
    locale: 'tr_TR'
  };
  logInfo(`[WS PUSH] connected ${req.socket.remoteAddress || 'unknown'}`);

  socket.write(encodeWebSocketFrame(0x1, JSON.stringify({
    type:      'connected',
    connected: true,
    status:    'connected',
    ts:        Math.floor(Date.now() / 1000)
  })));

  socket.on('data', (chunk) => handlePushSocketData(socket, chunk));
  socket.on('error', () => {});
  socket.on('end',   () => {
    leaveAllChatRooms(socket);
    logInfo('[WS PUSH] disconnected');
  });
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const httpServer = http.createServer(app.listeners('request')[0]);
httpServer.keepAliveTimeout  = 60000;
httpServer.headersTimeout    = 65000;
httpServer.requestTimeout    = 0;

httpServer.on('upgrade', (req, socket) => {
  if ((req.url || '').replace(/\?.*$/, '') === '/push/token') {
    return handlePushUpgrade(req, socket);
  }
  socket.destroy();
});

httpServer.listen(config.httpPort, config.bindHost, () => {
  logInfo(`HTTP  listening → http://${config.bindHost}:${config.httpPort}`);
  logInfo(`Client IP to use → http://${config.getPublicHttpAddress()}`);
  if (config.lanHosts.length > 1) {
    logInfo(`Other detected IPs: ${config.lanHosts.join(', ')}`);
  }
  logInfo('Server is running.');
});

// ── HTTPS server (optional) ───────────────────────────────────────────────────
if (
  config.sslKeyPath &&
  config.sslCertPath &&
  fs.existsSync(config.sslKeyPath) &&
  fs.existsSync(config.sslCertPath)
) {
  const tlsOptions = {
    key:  fs.readFileSync(config.sslKeyPath,  'utf8'),
    cert: fs.readFileSync(config.sslCertPath, 'utf8')
  };

  const httpsServer = https.createServer(tlsOptions, app.listeners('request')[0]);
  httpsServer.keepAliveTimeout = 60000;
  httpsServer.headersTimeout   = 65000;

  httpsServer.on('upgrade', (req, socket) => {
    if ((req.url || '').replace(/\?.*$/, '') === '/push/token') {
      return handlePushUpgrade(req, socket);
    }
    socket.destroy();
  });

  httpsServer.listen(config.httpsPort, config.bindHost, () => {
    logInfo(`HTTPS listening → https://${config.bindHost}:${config.httpsPort}`);
    logInfo(`Client HTTPS IP → https://${config.getPublicHttpsAddress()}`);
  });
} else {
  logInfo('HTTPS disabled — set SSL_KEY_PATH and SSL_CERT_PATH env vars to enable.');
}

// ── cleanup ───────────────────────────────────────────────────────────────────
process.on('exit', () => {
  if (logStream) logStream.end();
});
