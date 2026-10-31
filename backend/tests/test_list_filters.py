from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.repositories import identity
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
    yield
    repository._filter_capability_cache.clear()


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
    assert client.get("/api/v1/alerts/filter-options").json() == {
        "supported": True, "types": ["Payment requires review"], "counts": {"active": 3}}

    def unapplied(**kwargs):
        raise identity.IdentityError("AUTH_UNAVAILABLE")

    monkeypatch.setattr("app.api.alerts.repository_alert_filter_options", unapplied)
    assert client.get("/api/v1/alerts/filter-options").json() == {"supported": False, "types": [], "counts": None}


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
