from __future__ import annotations

import asyncio
from typing import Any, Protocol

class AlertWebSocket(Protocol):
    async def accept(self) -> None: ...

    async def send_json(self, data: Any) -> None: ...


class AlertConnectionManager:
    def __init__(self) -> None:
        self._connections: list[AlertWebSocket] = []

    async def connect(self, websocket: AlertWebSocket) -> None:
        await websocket.accept()
        self._connections.append(websocket)

    def disconnect(self, websocket: AlertWebSocket) -> None:
        if websocket in self._connections:
            self._connections.remove(websocket)

    async def publish_created(
        self,
        alert: dict[str, Any],
    ) -> None:
        event = {
            "type": "alert.created",
            "occurred_at": alert.get("created_at"),
            "data": alert,
        }

        connections = list(self._connections)

        if not connections:
            return

        results = await asyncio.gather(
            *(
                websocket.send_json(event)
                for websocket in connections
            ),
            return_exceptions=True,
        )

        for websocket, result in zip(
            connections,
            results,
            strict=True,
        ):
            if isinstance(result, BaseException):
                self.disconnect(websocket)


alert_manager = AlertConnectionManager()
