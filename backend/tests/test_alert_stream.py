import asyncio
from typing import Any

from app.services.alert_stream import AlertConnectionManager


class FakeWebSocket:
    def __init__(self) -> None:
        self.accepted = False
        self.messages: list[dict[str, Any]] = []

    async def accept(self) -> None:
        self.accepted = True

    async def send_json(
        self,
        data: Any,
    ) -> None:
        self.messages.append(data)


def test_publish_created_alert_event() -> None:
    manager = AlertConnectionManager()
    websocket = FakeWebSocket()
    alert = {
        "id": "AL-001",
        "transaction_id": "TX-HIGH-001",
        "created_at": "2026-10-03T03:00:01+00:00",
        "severity": "HIGH",
        "status": "ACTIVE",
    }

    async def exercise() -> None:
        await manager.connect(websocket)
        await manager.publish_created(alert)

    asyncio.run(exercise())

    assert websocket.accepted is True
    assert websocket.messages == [
        {
            "type": "alerts.changed",
            "occurred_at": alert["created_at"],
        }
    ]

    manager.disconnect(websocket)


def test_publish_changed_sends_only_invalidation() -> None:
    manager = AlertConnectionManager()
    websocket = FakeWebSocket()

    async def exercise() -> None:
        await manager.connect(websocket)
        await manager.publish_changed()

    asyncio.run(exercise())

    assert websocket.messages == [{"type": "alerts.changed", "occurred_at": None}]


def test_auth_failure_after_peer_disconnect_does_not_escape(monkeypatch):
    from app.api.alerts import alert_stream
    from app.repositories.identity import IdentityError
    from fastapi import WebSocketDisconnect

    class DisconnectedPeer:
        headers = {}
        close_codes = []

        async def accept(self):
            pass

        async def receive_text(self):
            return '{"type":"auth","access_token":"test-token"}'

        async def close(self, code):
            self.close_codes.append(code)
            raise WebSocketDisconnect(code=1006)

    def unavailable(_token):
        raise IdentityError("AUTH_UNAVAILABLE")

    monkeypatch.setattr("app.api.alerts.authenticate_token", unavailable)
    peer = DisconnectedPeer()
    asyncio.run(alert_stream(peer))
    assert peer.close_codes == [1008]
