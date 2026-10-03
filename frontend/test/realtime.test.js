import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REALTIME_STATES,
  createRealtimeClient,
  parseRealtimeMessage,
} from '../src/services/realtimeService.js';

class FakeSocket {
  closeCalls = 0;
  sent = [];

  send(message) { this.sent.push(message); }

  close() {
    this.closeCalls += 1;
  }
}

test('real-time client supports connect and intentional disconnect lifecycle', () => {
  const sockets = [];
  const states = [];
  const client = createRealtimeClient({
    url: 'ws://localhost:8000/ws/alerts',
    getToken: () => 'test-access-token',
    webSocketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  client.onStateChange((state) => states.push(state));

  assert.equal(client.connect(), true);
  assert.equal(client.getState(), REALTIME_STATES.CONNECTING);
  sockets[0].onopen();
  assert.deepEqual(JSON.parse(sockets[0].sent[0]), { type: 'auth', access_token: 'test-access-token' });
  sockets[0].onmessage({ data: JSON.stringify({ type: 'auth.ready' }) });
  assert.equal(client.getState(), REALTIME_STATES.CONNECTED);
  client.disconnect();
  assert.equal(client.getState(), REALTIME_STATES.DISCONNECTED);
  assert.equal(sockets[0].closeCalls, 1);
  assert.deepEqual(states, ['connecting', 'connected', 'disconnected']);
});

test('real-time message parser accepts only the documented alert event', () => {
  assert.deepEqual(parseRealtimeMessage(JSON.stringify({
    type: 'alert.created',
    occurred_at: '2026-09-20T14:42:03Z',
    data: { id: 'AL-1' },
  })), {
    type: 'alert.created',
    occurredAt: '2026-09-20T14:42:03Z',
    data: { id: 'AL-1' },
  });
});

test('real-time client does not connect without credentials or accept events before auth', () => {
  let socketCount = 0;
  const noTokenClient = createRealtimeClient({ url: 'ws://localhost/ws/alerts', getToken: () => null,
    webSocketFactory: () => { socketCount += 1; return new FakeSocket(); } });
  assert.equal(noTokenClient.connect(), false);
  assert.equal(socketCount, 0);

  const socket = new FakeSocket();
  const client = createRealtimeClient({ url: 'ws://localhost/ws/alerts', getToken: () => 'token', webSocketFactory: () => socket });
  const messages = [];
  client.onMessage((message) => messages.push(message));
  client.connect();
  socket.onopen();
  socket.onmessage({ data: JSON.stringify({ type: 'alert.created', data: { id: 'before-auth' } }) });
  assert.deepEqual(messages, []);
  socket.onmessage({ data: JSON.stringify({ type: 'auth.ready' }) });
  socket.onmessage({ data: JSON.stringify({ type: 'alert.created', data: { id: 'after-auth' } }) });
  assert.equal(messages[0].data.id, 'after-auth');
  client.disconnect();
});

test('malformed and unknown real-time messages fail safely', () => {
  assert.equal(parseRealtimeMessage('{bad json'), null);
  assert.equal(parseRealtimeMessage(JSON.stringify({ type: 'unknown', data: {} })), null);
  assert.equal(parseRealtimeMessage(JSON.stringify({ type: 'alert.created' })), null);
});

test('unexpected closure uses bounded reconnect state and backoff scheduling', () => {
  const sockets = [];
  const scheduled = [];
  const client = createRealtimeClient({
    url: 'ws://localhost:8000/ws/alerts',
    getToken: () => 'test-access-token',
    maxReconnectAttempts: 1,
    reconnectDelayMs: 250,
    webSocketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    schedule: (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
  });

  client.connect();
  sockets[0].onopen();
  sockets[0].onclose();
  assert.equal(client.getState(), REALTIME_STATES.RECONNECTING);
  assert.equal(scheduled[0].delay, 250);

  scheduled[0].callback();
  assert.equal(sockets.length, 2);
  sockets[1].onclose();
  assert.equal(client.getState(), REALTIME_STATES.DISCONNECTED);
});

test('cleanup prevents stale socket callbacks and removes message listeners', () => {
  const socket = new FakeSocket();
  const received = [];
  const client = createRealtimeClient({
    url: 'ws://localhost:8000/ws/alerts',
    getToken: () => 'test-access-token',
    webSocketFactory: () => socket,
  });
  const unsubscribe = client.onMessage((message) => received.push(message));

  client.connect();
  const staleMessageHandler = socket.onmessage;
  unsubscribe();
  client.disconnect();
  staleMessageHandler({ data: JSON.stringify({ type: 'alert.created', data: { id: 'AL-1' } }) });

  assert.deepEqual(received, []);
  assert.equal(client.getState(), REALTIME_STATES.DISCONNECTED);
});
