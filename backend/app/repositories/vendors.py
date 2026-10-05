"""Vendor monitoring reads and governed state transitions."""

from app.repositories import identity


def _rpc(name: str, **values):
    result = identity.rpc(name, **values)
    if result is None:
        raise identity.IdentityError("VENDOR_STORAGE_UNAVAILABLE")
    return result


def list_vendors(*, actor_id: str, page: int, page_size: int, status: str | None,
                 search: str | None = None, risk: str | None = None):
    return _rpc("list_vendor_monitoring", p_actor=actor_id, p_page=page,
                p_page_size=page_size, p_status=status, p_search=search,
                p_risk=risk)


def get_vendor(*, actor_id: str, vendor_id: str):
    return _rpc("get_vendor_monitoring_bundle", p_actor=actor_id, p_vendor=vendor_id)


def request(*, actor_id: str, vendor_id: str, request_type: str, reason: str):
    return _rpc("request_vendor_monitoring", p_actor=actor_id, p_vendor=vendor_id,
                p_type=request_type, p_reason=reason)


def decide(*, actor_id: str, request_id: str, approve: bool, note: str | None):
    return _rpc("decide_vendor_monitoring", p_actor=actor_id, p_request=request_id,
                p_approve=approve, p_note=note)


def change(*, actor_id: str, vendor_id: str, action: str, note: str | None):
    return _rpc("change_vendor_monitoring", p_actor=actor_id, p_vendor=vendor_id,
                p_action=action, p_note=note)
