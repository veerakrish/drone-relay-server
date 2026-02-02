/**
 * Remote Control Relay Server
 * Both phones connect via WebSocket. Target gets a session code; controller joins with that code.
 */

const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

// sessionCode (6 digits) -> { target: WebSocket, controller?: WebSocket }
const sessions = new Map();

function generateSessionCode() {
  let code;
  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (sessions.has(code));
  return code;
}

wss.on('connection', (ws, req) => {
  let role = null;
  let sessionCode = null;

  ws.on('message', (data, isBinary) => {
    // First message must be { type: "register", role: "target" | "controller", sessionCode?: "123456" }
    if (!role) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'register') {
          role = msg.role;
          if (role === 'target') {
            sessionCode = generateSessionCode();
            sessions.set(sessionCode, { target: ws, controller: null });
            ws.send(JSON.stringify({ type: 'session', sessionCode }));
          } else if (role === 'controller' && msg.sessionCode) {
            sessionCode = msg.sessionCode;
            const session = sessions.get(sessionCode);
            if (session && session.target && session.target.readyState === WebSocket.OPEN) {
              session.controller = ws;
              ws.send(JSON.stringify({ type: 'paired' }));
              session.target.send(JSON.stringify({ type: 'controller_joined' }));
            } else {
              ws.send(JSON.stringify({ type: 'error', message: 'Invalid or expired code' }));
            }
          }
        }
      } catch (_) {
        ws.send(JSON.stringify({ type: 'error', message: 'Send register first' }));
      }
      return;
    }

    const session = sessionCode ? sessions.get(sessionCode) : null;
    if (!session) return;

    if (role === 'target') {
      // Target -> relay -> Controller (screen frames, view tree, etc.)
      if (session.controller && session.controller.readyState === WebSocket.OPEN) {
        session.controller.send(data, { binary: isBinary });
      }
    } else if (role === 'controller') {
      // Controller -> relay -> Target (tap, swipe, etc.)
      if (session.target && session.target.readyState === WebSocket.OPEN) {
        session.target.send(data, { binary: isBinary });
      }
    }
  });

  ws.on('close', () => {
    if (sessionCode && sessions.has(sessionCode)) {
      const session = sessions.get(sessionCode);
      if (session.target === ws) {
        if (session.controller && session.controller.readyState === WebSocket.OPEN) {
          session.controller.send(JSON.stringify({ type: 'target_disconnected' }));
        }
        sessions.delete(sessionCode);
      } else if (session.controller === ws) {
        session.controller = null;
        if (session.target && session.target.readyState === WebSocket.OPEN) {
          session.target.send(JSON.stringify({ type: 'controller_left' }));
        }
      }
    }
  });
});

console.log(`Relay server listening on port ${PORT}`);
console.log('Target and controller connect to: ws://<this-server-ip>:${PORT}');
