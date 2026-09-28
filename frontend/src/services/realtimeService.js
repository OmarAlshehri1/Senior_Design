import { environment } from '../config/env.js';

export const REALTIME_STATES = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
});

export function parseRealtimeMessage(rawMessage) {
  try {
    const event = typeof rawMessage === 'string' ? JSON.parse(rawMessage) : rawMessage;
    if (!event || event.type !== 'alert.created' || !event.data || typeof event.data !== 'object') {
      return null;
    }
    return {
      type: event.type,
      occurredAt: event.occurred_at ?? null,
      data: event.data,
    };
  } catch {
    return null;
  }
}

export function createRealtimeClient(options = {}) {
  const {
    url = environment.websocketUrl,
    webSocketFactory = (socketUrl) => new WebSocket(socketUrl),
    maxReconnectAttempts = 3,
    reconnectDelayMs = 1000,
    schedule = (callback, delay) => setTimeout(callback, delay),
    cancelSchedule = (timerId) => clearTimeout(timerId),
  } = options;

  let socket = null;
  let state = REALTIME_STATES.IDLE;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let intentionallyDisconnected = false;
  let connectionGeneration = 0;
  const messageListeners = new Set();
  const stateListeners = new Set();

  const setState = (nextState) => {
    state = nextState;
    stateListeners.forEach((listener) => listener(state));
  };

  const detachSocket = () => {
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
  };

  const connect = () => {
    if (!url || socket) return false;

    intentionallyDisconnected = false;
    connectionGeneration += 1;
    const generation = connectionGeneration;
    setState(reconnectAttempts > 0 ? REALTIME_STATES.RECONNECTING : REALTIME_STATES.CONNECTING);

    try {
      socket = webSocketFactory(url);
    } catch {
      socket = null;
      setState(REALTIME_STATES.ERROR);
      return false;
    }

    socket.onopen = () => {
      if (generation !== connectionGeneration) return;
      reconnectAttempts = 0;
      setState(REALTIME_STATES.CONNECTED);
    };
    socket.onmessage = (message) => {
      if (generation !== connectionGeneration) return;
      const parsedMessage = parseRealtimeMessage(message?.data);
      if (parsedMessage) messageListeners.forEach((listener) => listener(parsedMessage));
    };
    socket.onerror = () => {
      if (generation === connectionGeneration) setState(REALTIME_STATES.ERROR);
    };
    socket.onclose = () => {
      if (generation !== connectionGeneration) return;
      detachSocket();
      socket = null;

      if (intentionallyDisconnected) {
        setState(REALTIME_STATES.DISCONNECTED);
        return;
      }

      if (reconnectAttempts >= maxReconnectAttempts) {
        setState(REALTIME_STATES.DISCONNECTED);
        return;
      }

      reconnectAttempts += 1;
      setState(REALTIME_STATES.RECONNECTING);
      reconnectTimer = schedule(() => {
        reconnectTimer = null;
        connect();
      }, reconnectDelayMs * reconnectAttempts);
    };

    return true;
  };

  const disconnect = () => {
    intentionallyDisconnected = true;
    connectionGeneration += 1;
    if (reconnectTimer !== null) {
      cancelSchedule(reconnectTimer);
      reconnectTimer = null;
    }
    const activeSocket = socket;
    detachSocket();
    socket = null;
    activeSocket?.close();
    reconnectAttempts = 0;
    setState(REALTIME_STATES.DISCONNECTED);
  };

  return Object.freeze({
    connect,
    disconnect,
    getState: () => state,
    onMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onStateChange(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
  });
}

export const realtimeService = createRealtimeClient();
