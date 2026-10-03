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

test('real-time parser accepts only the documented alert invalidation event', () => {
  assert.deepEqual(parseRealtimeMessage(JSON.stringify({
    type: 'alerts.changed',
    occurred_at: '2026-09-20T14:42:03Z',
  })), {
    type: 'alerts.changed',
    occurredAt: '2026-09-20T14:42:03Z',
  });
  assert.equal(parseRealtimeMessage({ type: 'alerts.changed', data: { id: 'secret' } }).data, undefined);
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
  socket.onmessage({ data: JSON.stringify({ type: 'alerts.changed' }) });
  assert.deepEqual(messages, []);
  socket.onmessage({ data: JSON.stringify({ type: 'auth.ready' }) });
  socket.onmessage({ data: JSON.stringify({ type: 'alerts.changed' }) });
  assert.deepEqual(messages, [
    { type: 'alerts.catch_up', occurredAt: null },
    { type: 'alerts.changed', occurredAt: null },
  ]);
  client.disconnect();
});

test('malformed and unknown real-time messages fail safely; legacy events become invalidations', () => {
  assert.equal(parseRealtimeMessage('{bad json'), null);
  assert.equal(parseRealtimeMessage(JSON.stringify({ type: 'unknown', data: {} })), null);
  assert.deepEqual(parseRealtimeMessage(JSON.stringify({ type: 'alert.created', data: { id: 'AL-1' } })), {
    type: 'alerts.changed', occurredAt: null,
  });
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

test('every authenticated reconnection requests an alert catch-up', () => {
  const sockets = [];
  const scheduled = [];
  const caughtUp = [];
  const client = createRealtimeClient({
    url: 'ws://localhost:8000/ws/alerts', getToken: () => 'token', maxReconnectAttempts: 2,
    webSocketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
    schedule: (callback) => { scheduled.push(callback); return scheduled.length; },
  });
  client.onMessage((event) => { if (event.type === 'alerts.catch_up') caughtUp.push(event); });

  client.connect();
  sockets[0].onopen();
  sockets[0].onmessage({ data: JSON.stringify({ type: 'auth.ready' }) });
  sockets[0].onclose();
  scheduled[0]();
  sockets[1].onopen();
  sockets[1].onmessage({ data: JSON.stringify({ type: 'auth.ready' }) });

  assert.equal(caughtUp.length, 2);
  client.disconnect();
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
  staleMessageHandler({ data: JSON.stringify({ type: 'alerts.changed' }) });

  assert.deepEqual(received, []);
  assert.equal(client.getState(), REALTIME_STATES.DISCONNECTED);
});
