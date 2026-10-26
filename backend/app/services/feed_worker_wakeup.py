"""Process-local hints only; durable database jobs and periodic polling remain authoritative."""
import asyncio
from contextlib import contextmanager
from weakref import WeakKeyDictionary

_listeners = WeakKeyDictionary()


@contextmanager
def listen(channel):
    if channel not in {"validation", "audit"}:
        raise ValueError("Unknown feed worker channel")
    loop = asyncio.get_running_loop()
    event = asyncio.Event()
    group = _listeners.setdefault(loop, {})
    events = group.setdefault(channel, set())
    events.add(event)
    try:
        yield event
    finally:
        events.discard(event)
        if not events:
            group.pop(channel, None)
        if not group:
            _listeners.pop(loop, None)


def notify(channel):
    """Called on the request/worker event loop, only after a confirmed durable commit."""
    loop = asyncio.get_running_loop()
    events = _listeners.get(loop, {}).get(channel, ())
    for event in events:
        event.set()
    return len(events)


async def wait(event, timeout=2):
    try:
        await asyncio.wait_for(event.wait(), timeout=timeout)
    except TimeoutError:
        pass
