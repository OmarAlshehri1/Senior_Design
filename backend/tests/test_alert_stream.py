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
