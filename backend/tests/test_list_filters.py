from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.repositories import identity
from app.repositories import supabase_alerts
from app.repositories import supabase_transactions as repository


client = TestClient(app)


class _Response:
    def __init__(self, rows: list[dict[str, Any]], total: int | None = None) -> None:
        self._rows = rows
        self.headers = {"content-range": f"0-0/{len(rows) if total is None else total}"}

    def raise_for_status(self) -> None:
        return None

    def json(self) -> list[dict[str, Any]]:
        return self._rows


def _fake_client(responder, requests: list[dict[str, str]]):
    class FakeClient:
        def __init__(self, timeout: float) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def get(self, endpoint: str, *, headers: dict[str, str], params: dict[str, str]):
            requests.append(dict(params))
            return responder(params)

    return FakeClient


@pytest.fixture(autouse=True)
def _configured(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_test")
    repository._filter_capability_cache.clear()
    supabase_alerts._rule_capability.clear()
    yield
    repository._filter_capability_cache.clear()
    supabase_alerts._rule_capability.clear()


def _stub_enrichment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("get_duplicate_payment_counts", "get_invoice_splitting_contexts", "get_ghost_vendor_contexts",
                 "get_latest_transaction_evaluations", "get_latest_transaction_anomaly_scores",
                 "get_latest_transaction_risk_scores", "get_latest_transaction_explanations"):
        monkeypatch.setattr(repository, name, lambda transaction_ids: {})


def test_transaction_filters_are_database_parameters_before_paging(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[dict[str, str]] = []
    monkeypatch.setenv("PAYMENTS_PRIMARY_ENABLED", "true")
    monkeypatch.setattr(repository.httpx, "Client", _fake_client(lambda params: _Response([], total=0), requests))
    _stub_enrichment(monkeypatch)

    repository.list_transactions(page=3, page_size=10, sort_by="highest-risk",
                                 risk="medium", rule_status="review", category="Facilities")

    capability, listing = requests
    assert capability["primary_rule_mask"] == "is.null"
    assert listing["and"] == "(primary_risk_scaled.gte.5000,primary_risk_scaled.lt.7500)"
    assert listing["primary_rule_mask"] == "gt.0"
    assert listing["category"] == "eq.Facilities"
    assert listing["order"].startswith("primary_risk_scaled.desc")
    assert listing["offset"] == "20"
    assert listing["limit"] == "10"


def test_risk_filters_are_refused_when_any_row_lacks_persisted_results(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[dict[str, str]] = []
    monkeypatch.setenv("PAYMENTS_PRIMARY_ENABLED", "true")
    monkeypatch.setattr(repository.httpx, "Client", _fake_client(lambda params: _Response([{"id": "x"}], total=4), requests))

    with pytest.raises(repository.TransactionFilterUnavailableError):
        repository.list_transactions(risk="high")
    assert len(requests) == 1


def test_risk_filters_are_unavailable_outside_the_primary_dataset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PAYMENTS_PRIMARY_ENABLED", "false")
    with pytest.raises(repository.TransactionFilterUnavailableError):
        repository.list_transactions(sort_by="lowest-risk")


def test_filter_options_discover_bounded_categories(monkeypatch: pytest.MonkeyPatch) -> None:
    categories = ["Facilities", "Logistics"]
    requests: list[dict[str, str]] = []

    def respond(params: dict[str, str]):
        if params.get("primary_rule_mask") == "is.null":
            return _Response([], total=0)
        bound = params["category"]
        remaining = categories if bound == "not.is.null" else [c for c in categories if c > bound[3:]]
        return _Response([{"category": remaining[0]}] if remaining else [])

    monkeypatch.setenv("PAYMENTS_PRIMARY_ENABLED", "true")
    monkeypatch.setattr(repository.httpx, "Client", _fake_client(respond, requests))
    response = client.get("/api/v1/transactions/filter-options")

    assert response.status_code == 200
    body = response.json()
    assert body["categories"] == categories
    assert body["risk_levels"] == ["low", "medium", "high"]
    assert "highest-risk" in body["sorts"]
    assert body["categories_truncated"] is False


def test_transaction_api_forwards_only_supplied_filters_and_maps_unavailability(monkeypatch: pytest.MonkeyPatch) -> None:
    received: list[dict[str, object]] = []

    def fake_list(**kwargs):
        received.append(kwargs)
        if kwargs.get("risk") == "high":
            raise repository.TransactionFilterUnavailableError("Risk filtering is unavailable.")
        return [], 0

    monkeypatch.setattr("app.api.transactions.list_transactions", fake_list)
    assert client.get("/api/v1/transactions", params={"rule_status": "passed", "category": "Logistics"}).status_code == 200
    assert received[0] == {"page": 1, "page_size": 25, "search": None, "sort_by": "newest",
                           "rule_status": "passed", "category": "Logistics"}
    assert client.get("/api/v1/transactions", params={"risk": "high"}).status_code == 422
    assert client.get("/api/v1/transactions", params={"risk": "critical"}).status_code == 422


def test_alert_filters_use_the_scoped_filtered_query(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr("app.api.alerts.repository_list_alerts",
                        lambda **kwargs: calls.append(("default", kwargs)) or ([], 0))
    monkeypatch.setattr("app.api.alerts.repository_list_alerts_filtered",
                        lambda **kwargs: calls.append(("filtered", kwargs)) or ([], 7))

    assert client.get("/api/v1/alerts?status=ACTIVE").json()["total"] == 0
    response = client.get("/api/v1/alerts", params={"severity": "HIGH", "type": "Payment requires review",
                                                    "search": " north ", "sort": "HIGHEST_RISK", "page": 2})
    assert response.json()["total"] == 7
    assert calls[0][0] == "default"
    kind, filters = calls[1]
    assert kind == "filtered"
    assert filters == {"actor_id": "00000000-0000-0000-0000-000000000001", "page": 2, "page_size": 25,
                       "status_filter": None, "severity": "HIGH", "alert_type": "Payment requires review",
                       "search": "north", "sort": "HIGHEST_RISK"}
    assert client.get("/api/v1/alerts?sort=RANDOM").status_code == 422


def test_alert_filter_options_report_support_without_failing_the_page(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.alerts.repository_alert_filter_options",
                        lambda **kwargs: {"types": ["Payment requires review"], "counts": {"active": 3}})
    monkeypatch.setattr("app.api.alerts.repository_rule_filter_supported", lambda: True)
    assert client.get("/api/v1/alerts/filter-options").json() == {
        "supported": True, "types": ["Payment requires review"], "counts": {"active": 3}, "rules": True}

    def unapplied(**kwargs):
        raise identity.IdentityError("AUTH_UNAVAILABLE")

    monkeypatch.setattr("app.api.alerts.repository_alert_filter_options", unapplied)
    assert client.get("/api/v1/alerts/filter-options").json() == {
        "supported": False, "types": [], "counts": None, "rules": False}


def test_alert_rule_filter_is_sent_to_the_scoped_rule_query(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr("app.api.alerts.repository_list_alerts",
                        lambda **kwargs: calls.append(("default", kwargs)) or ([], 0))
    monkeypatch.setattr("app.api.alerts.repository_list_alerts_filtered",
                        lambda **kwargs: calls.append(("filtered", kwargs)) or ([], 37))

    response = client.get("/api/v1/alerts", params={"rule": "ghost_vendors", "status": "ACTIVE", "severity": "HIGH",
                                                    "type": "Payment requires review", "search": " contoso ",
                                                    "sort": "OLDEST", "page": 1, "page_size": 10})
    assert response.status_code == 200
    assert response.json()["total"] == 37
    assert calls == [("filtered", {"actor_id": "00000000-0000-0000-0000-000000000001", "page": 1, "page_size": 10,
                                   "status_filter": "ACTIVE", "severity": "HIGH",
                                   "alert_type": "Payment requires review", "search": "contoso",
                                   "sort": "OLDEST", "rule": "ghost_vendors"})]
    for rule in supabase_alerts.ALERT_RULE_KEYS:
        assert client.get("/api/v1/alerts", params={"rule": rule}).status_code == 200
        assert calls[-1][1]["rule"] == rule
    assert client.get("/api/v1/alerts", params={"rule": "Ghost Vendors"}).status_code == 422
    assert all(kind == "filtered" for kind, _ in calls)


def test_alert_rule_repository_uses_stored_rule_function_and_same_actor(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, dict[str, object]]] = []

    def rpc(name: str, **payload):
        calls.append((name, payload))
        if name == "get_transaction_failed_rule_keys":
            return {"PAY-1": ["ghost_vendors", "unexpected"]} if payload["p_transaction_ids"] else {}
        return {"items": [{"id": "ALT-PAY-1", "transaction_id": "PAY-1", "rule_keys": ["ghost_vendors"]}], "total": 7}

    monkeypatch.setattr(supabase_alerts.identity, "rpc", rpc)
    items, total = supabase_alerts.list_alerts_filtered(actor_id="actor", page=1, page_size=10, rule="ghost_vendors")
    assert total == 7
    assert items[0]["rule_keys"] == ["ghost_vendors"]
    assert calls[0] == ("list_accessible_alerts_by_rule", {
        "p_actor": "actor", "p_page": 1, "p_page_size": 10, "p_status": None, "p_severity": None,
        "p_title": None, "p_search": None, "p_sort": "NEWEST", "p_rule": "ghost_vendors"})
    supabase_alerts.list_alerts_filtered(actor_id="actor", severity="HIGH")
    assert calls[1][0] == "list_accessible_alerts_filtered"
    assert "p_rule" not in calls[1][1]

    enriched = supabase_alerts.attach_alert_rule_keys([{"id": "ALT-PAY-1", "transaction_id": "PAY-1"}])
    assert enriched[0]["rule_keys"] == ["ghost_vendors"]
    assert [name for name, _ in calls[2:]] == ["get_transaction_failed_rule_keys", "get_transaction_failed_rule_keys"]
    assert calls[-1][1] == {"p_transaction_ids": ["PAY-1"]}


def test_alert_rule_enrichment_is_optional_until_the_migration_is_applied(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    def unapplied(name: str, **payload):
        calls.append(name)
        raise identity.IdentityError("AUTH_UNAVAILABLE")

    monkeypatch.setattr(supabase_alerts.identity, "rpc", unapplied)
    alerts = [{"id": "AL-1", "transaction_id": "PAY-1"}]
    assert supabase_alerts.attach_alert_rule_keys(alerts) == [{"id": "AL-1", "transaction_id": "PAY-1"}]
    assert supabase_alerts.rule_filter_supported() is False
    assert calls == ["get_transaction_failed_rule_keys"]


def test_vendor_search_routes_to_the_search_function(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.repositories import vendors

    monkeypatch.setattr(vendors, "list_vendors", lambda **kwargs: {"items": [], "total": 0, "kind": "list", **kwargs})
    monkeypatch.setattr(vendors, "search_vendors", lambda **kwargs: {"items": [], "total": 0, "kind": "search", **kwargs})
    assert client.get("/api/v1/vendors?search=%20%20").json()["kind"] == "list"
    body = client.get("/api/v1/vendors?search=north&status=NORMAL").json()
    assert body["kind"] == "search"
    assert body["search"] == "north"
    assert body["status"] == "NORMAL"
    assert client.get("/api/v1/vendors/filter-options").json()["search"] is True

    def unapplied(**kwargs):
        raise identity.IdentityError("AUTH_UNAVAILABLE")

    monkeypatch.setattr(vendors, "search_vendors", unapplied)
    assert client.get("/api/v1/vendors/filter-options").json()["search"] is False
