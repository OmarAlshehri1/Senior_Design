import asyncio
from copy import deepcopy
from decimal import Decimal

import pytest

from app.services import feed_auditing as audit
from app.services.audit_rules import evaluate_transaction_rules
from app.repositories.supabase_transactions import SupabasePersistenceError


def configuration():
    return {"schema_version":"1.0","actor_namespace":"employees","actor_case_insensitive":True,
        "history":{"reference":"history-snapshot-1","authoritative":True,"vendor_namespace":"vendors",
                   "valid_from":"2025-01-01T00:00:00Z","valid_to":"2027-01-01T00:00:00Z"},
        "approval_policies":[{"reference":"authority-policy-1","approver_id":"EMP-2","currency":"USD","limit":"100.00",
                              "valid_from":"2025-01-01T00:00:00Z","valid_to":"2027-01-01T00:00:00Z"}],
        "vendor_registry":{"reference":"registry-snapshot-1","authoritative":True,"vendor_namespace":"vendors",
                           "valid_from":"2025-01-01T00:00:00Z","valid_to":"2027-01-01T00:00:00Z",
                           "entries":[{"id":"V-1","active":True}]}}


def job():
    return {"transaction_id":"10000000-0000-4000-8000-000000000001","lease_token":"lease","context_version":"v1",
            "canonical":{"amount":"60.00","currency":"USD","timestamp":"2026-01-01T12:00:00Z","vendor_id":"V-1",
                         "invoice_number":"INV-1","created_by":"EMP-1","approved_by":"EMP-2","approval_limit":"999999",
                         "category":"Office","approver_role":"Manager"},
            "identity_context":{"actor_namespace":"employees","vendor_namespace":"vendors"},
            "snapshot":{"configuration":configuration(),"history":{"arrival_cutoff":"2026-01-01T12:01:00Z",
                "prior_count":1,"unprepared_prior_count":0,"incomplete_duplicate_count":0,"incomplete_window_count":0,
                "duplicate_payment_count":0,"invoice_splitting_context":{"historical_transaction_count":1,"window_total_amount":"120.00"}}}}


def by_key(bundle):
    return {result["rule_key"]:result for result in bundle["rule_results"]}


def test_five_rules_use_verified_policy_and_exact_history_without_forcing_risk():
    item=job()
    before=deepcopy(item)
    bundle=audit.build_bundle(item)
    results=by_key(bundle)
    assert item==before
    assert bundle["coverage"]=={"total":5,"evaluated":5,"failed":1,"not_evaluated":0}
    assert results["invoice_splitting"]["status"]=="FAILED"
    assert results["approval_limits"]["status"]=="PASSED"
    assert bundle["authority_reference"]=="authority-policy-1"
    assert bundle["verified_approval_limit"]=="100.00"
    assert bundle["rule_score"]==20
    assert bundle["ai_score"] is None and bundle["risk_score"] is None and bundle["risk_level"] is None
    assert bundle["anomaly"]["reason"]=="MODEL_SOURCE_NOT_APPROVED"


def simulation_job():
    item=job()
    item["canonical"].update(timestamp=None,source_date="2002-01-01",time_precision="date")
    item["snapshot"].update(time_basis="SIMULATED_ARRIVAL_TIME",evaluation_time="2026-01-01T12:01:00Z")
    item["snapshot"]["configuration"]["time_basis"]="SIMULATED_ARRIVAL_TIME"
    item["snapshot"]["history"]["arrival_window_count"]=1
    return item


@pytest.mark.parametrize("amount,total,count,expected", [
    ("60", "120", 1, "FAILED"), ("50", "100", 1, "PASSED"),
    ("150", "60", 1, "PASSED"), ("100", "60", 1, "PASSED"),
    ("0", "60", 1, "PASSED"), ("60", "60", 0, "PASSED")])
def test_subthreshold_splitting_uses_filtered_context_and_current_payment_eligibility(amount, total, count, expected):
    item = job()
    item["snapshot"]["configuration"]["invoice_splitting_mode"] = "SUBTHRESHOLD_PAYMENTS"
    item["canonical"]["amount"] = amount
    item["snapshot"]["history"]["subthreshold_invoice_splitting_context"] = {
        "calculation_basis": "SUBTHRESHOLD_CURRENT_APPROVAL_LIMIT", "approval_limit": "100",
        "historical_transaction_count": count, "window_total_amount": total}
    before = deepcopy(item)
    bundle = audit.build_bundle(item)
    result = by_key(bundle)["invoice_splitting"]
    assert result["status"] == expected and result["rule_version"] == "1.1.0"
    assert item == before
    assert by_key(bundle)["approval_limits"]["status"] == ("FAILED" if Decimal(amount) > 100 else "PASSED")


def test_subthreshold_splitting_never_falls_back_to_unfiltered_snapshot():
    item = job()
    item["snapshot"]["configuration"]["invoice_splitting_mode"] = "SUBTHRESHOLD_PAYMENTS"
    result = by_key(audit.build_bundle(item))["invoice_splitting"]
    assert result["status"] == "NOT_EVALUATED"
    assert "SUBTHRESHOLD_HISTORY_UNAVAILABLE" in result["evidence"]["gate_reasons"]
    item["snapshot"]["history"]["subthreshold_invoice_splitting_context"] = {
        "calculation_basis": "SUBTHRESHOLD_CURRENT_APPROVAL_LIMIT", "approval_limit": "999",
        "historical_transaction_count": 2, "window_total_amount": "120"}
    assert by_key(audit.build_bundle(item))["invoice_splitting"]["status"] == "NOT_EVALUATED"


def test_subthreshold_version_does_not_reuse_model_approval_for_legacy_rule_features():
    item = job()
    item["snapshot"]["configuration"].update(invoice_splitting_mode="SUBTHRESHOLD_PAYMENTS", model_approval=approval())
    result = audit.build_bundle(item, allow_model=True, model_loader=lambda _: pytest.fail("Legacy model must not load"))
    assert result["anomaly"]["reason"] == "MODEL_RULE_VERSION_NOT_APPROVED"
    assert result["ai_score"] is None and result["risk_score"] is None


def test_explicit_simulation_clock_preserves_business_date_and_labels_rules():
    item=simulation_job();before=deepcopy(item)
    bundle=audit.build_bundle(item)
    assert item==before
    assert bundle["time_basis"]=="SIMULATED_ARRIVAL_TIME"
    assert bundle["temporal_observation"]["observed_transactions"]==2
    assert bundle["temporal_observation"]["two_or_more_observed"] is True
    assert by_key(bundle)["invoice_splitting"]["status"]=="FAILED"
    assert all(r["evidence"]["historical_source_date"]=="2002-01-01" for r in bundle["rule_results"])
    assert all(r["evidence"]["time_basis"]=="SIMULATED_ARRIVAL_TIME" for r in bundle["rule_results"])
    assert bundle["anomaly"]["reason"]=="MODEL_SIMULATION_CLOCK_NOT_APPROVED"


def test_simulation_clock_never_bypasses_missing_vendor_and_authority_or_loads_model():
    item=simulation_job()
    item["canonical"].update(vendor_id=None,created_by=None,approved_by=None,invoice_number=None)
    item["snapshot"]["configuration"].update(model_approval=approval(),approval_policies=[],vendor_registry=None)
    def forbidden(_):raise AssertionError("simulation must not invoke model")
    result=audit.build_bundle(item,allow_model=True,model_loader=forbidden)
    assert result["coverage"]["evaluated"]==0
    assert result["risk_score"] is None
    assert result["temporal_observation"]["two_or_more_observed"] is True


def test_missing_simulation_snapshot_cannot_fall_back_to_worker_clock():
    item=simulation_job();del item["snapshot"]["time_basis"]
    with pytest.raises(ValueError,match="snapshot required"):
        audit.build_bundle(item)


def test_one_observed_arrival_is_unknown_with_incomplete_history():
    item=simulation_job()
    item["snapshot"]["history"].update(arrival_window_count=0,unprepared_prior_count=1)
    result=audit.build_bundle(item)
    assert result["temporal_observation"]["observed_transactions"]==1
    assert result["temporal_observation"]["two_or_more_observed"] is None


def test_assumed_name_window_is_separate_from_verified_rule_coverage():
    item=simulation_job()
    policy={"scenario_version":"payments-name-window-1.0.0","threshold":"10000.00","currency":"USD",
            "grouping_path":["source","VENDOR NAME"]}
    item["snapshot"]["configuration"]={"time_basis":"SIMULATED_ARRIVAL_TIME","simulation_splitting":policy}
    item["canonical"].update(vendor_id=None,created_by=None,approved_by=None,invoice_number=None)
    indicator={"scenario_version":policy["scenario_version"],"threshold":"10000.00","time_basis":"SIMULATED_ARRIVAL_TIME",
               "status":"INDICATED","indicated":True,"assumed_policy":True,"verified_supplier_identity":False}
    item["snapshot"]["simulation_name_window"]=indicator
    result=audit.build_bundle(item)
    assert result["simulation_indicator"]==indicator
    item["snapshot"]["configuration"]["simulation_history_wait_seconds"] = 15
    assert audit.build_bundle(item)["simulation_indicator"] == indicator
    assert result["coverage"]["evaluated"]==0
    assert result["authority_reference"] is None and result["verified_approval_limit"] is None
    assert result["risk_score"] is None
    del item["snapshot"]["simulation_name_window"]
    with pytest.raises(ValueError,match="snapshot required"):
        audit.build_bundle(item)


def test_name_window_configuration_cannot_be_silently_retuned_or_used_with_business_clock():
    policy={"scenario_version":"payments-name-window-1.0.0","threshold":"10000.00","currency":"USD",
            "grouping_path":["source","VENDOR NAME"]}
    with pytest.raises(ValueError):
        audit.AuditContext.model_validate({"simulation_splitting":policy})
    with pytest.raises(ValueError):
        audit.AuditContext.model_validate({"time_basis":"SIMULATED_ARRIVAL_TIME","simulation_splitting":policy|{"threshold":"5000.00"}})


@pytest.mark.parametrize("seconds", [-1, 31, 1.5, "15", True])
def test_simulation_readiness_wait_is_strict_and_bounded(seconds):
    policy={"scenario_version":"payments-name-window-1.0.0","threshold":"10000.00","currency":"USD",
            "grouping_path":["source","VENDOR NAME"]}
    with pytest.raises(ValueError):
        audit.AuditContext.model_validate({"time_basis":"SIMULATED_ARRIVAL_TIME","simulation_splitting":policy,
                                          "simulation_history_wait_seconds":seconds})


def test_readiness_wait_is_opt_in_to_simulation_only():
    assert audit.AuditContext().simulation_history_wait_seconds == 0
    with pytest.raises(ValueError):
        audit.AuditContext.model_validate({"simulation_history_wait_seconds":15})


@pytest.mark.parametrize("change,rule,reason",[
    ("actor_semantics","segregation_of_duties","ACTOR_COMPARISON_NOT_VERIFIED"),
    ("actor_namespace","approval_limits","APPROVAL_POLICY_UNAVAILABLE"),
    ("currency","approval_limits","APPROVAL_POLICY_UNAVAILABLE"),
    ("expired_policy","approval_limits","APPROVAL_POLICY_UNAVAILABLE"),
    ("ambiguous_policy","approval_limits","APPROVAL_POLICY_AMBIGUOUS"),
    ("unavailable_registry","ghost_vendors","AUTHORITATIVE_VENDOR_REGISTRY_UNAVAILABLE"),
    ("vendor_name_only","ghost_vendors","VENDOR_IDENTITY_UNRESOLVED"),
    ("history_gap","duplicate_payment","HISTORY_INCOMPLETE"),
    ("history_window","invoice_splitting","HISTORY_COVERAGE_UNAVAILABLE"),
    ("missing_time","ghost_vendors","PRECISE_EVENT_TIME_MISSING"),
])
def test_semantic_gates_do_not_convert_missing_information_into_pass(change,rule,reason):
    item=job(); context=item["snapshot"]["configuration"]
    if change=="actor_semantics":context["actor_case_insensitive"]=False
    elif change=="actor_namespace":item["identity_context"]["actor_namespace"]="another-namespace"
    elif change=="currency":item["canonical"]["currency"]="EUR"
    elif change=="expired_policy":context["approval_policies"][0]["valid_to"]="2025-12-31T00:00:00Z"
    elif change=="ambiguous_policy":context["approval_policies"]*=2
    elif change=="unavailable_registry":context["vendor_registry"]["authoritative"]=False
    elif change=="vendor_name_only":item["canonical"].update(vendor_id=None,vendor_name="V-1")
    elif change=="history_gap":item["snapshot"]["history"]["unprepared_prior_count"]=1
    elif change=="history_window":context["history"]["valid_from"]="2026-01-01T01:00:00Z"
    elif change=="missing_time":item["canonical"]["timestamp"]=None
    bundle=audit.build_bundle(item)
    result=by_key(bundle)[rule]
    assert result["status"]=="NOT_EVALUATED"
    assert reason in result["evidence"]["gate_reasons"]
    assert result["score_contribution"] is None
    assert bundle["risk_level"] is None


def test_unverified_payload_limit_and_unregistered_vendor_do_not_change_policy():
    item=job()
    item["canonical"].update(amount="101.00",approval_limit="999999999",vendor_id="UNKNOWN")
    results=by_key(audit.build_bundle(item))
    assert results["approval_limits"]["status"]=="FAILED"
    assert results["approval_limits"]["evidence"]["excess_amount"]=="1.00"
    assert results["ghost_vendors"]["status"]=="FAILED"
    assert results["ghost_vendors"]["evidence"]["manual_review_required"] is True


def test_missing_references_produce_null_score_if_no_rule_can_run():
    item=job();item["snapshot"]["configuration"]=None
    bundle=audit.build_bundle(item)
    assert bundle["coverage"]["evaluated"]==0
    assert bundle["rule_score"] is None and bundle["risk_score"] is None


def test_decimal_boundary_is_not_rounded_into_a_pass():
    item=job()
    item["snapshot"]["history"]["invoice_splitting_context"]["window_total_amount"]="100.000000000000000001"
    assert by_key(audit.build_bundle(item))["invoice_splitting"]["status"]=="FAILED"
    direct=evaluate_transaction_rules({"amount":Decimal("100.000000000000000001"),"approval_limit":Decimal("100"),
        "timestamp":"2026-01-01T12:00:00Z","vendor_id":"V"},context={"invoice_splitting_context":{
            "historical_transaction_count":1,"window_total_amount":Decimal("100.000000000000000001")}})
    assert next(r for r in direct if r["rule_key"]=="invoice_splitting")["status"]=="FAILED"


def test_extreme_source_date_is_unevaluated_instead_of_crashing_window_arithmetic():
    item=job();item["canonical"]["timestamp"]="0001-01-01T00:00:00Z"
    result=by_key(audit.build_bundle(item))["invoice_splitting"]
    assert result["status"]=="NOT_EVALUATED"
    assert "TIME_WINDOW_UNSUPPORTED" in result["evidence"]["gate_reasons"]


def approval():
    return {"model_version":"1.0.0","feature_version":"1.0.0","artifact_sha256":"a"*64,
            "validation_reference":"independent-validation-test","population_reference":"approved-test-population",
            "supported_currencies":["USD"]}


def test_reviewed_model_is_optional_and_combined_formula_is_unchanged():
    item=job();item["snapshot"]["configuration"]["model_approval"]=approval()
    class Model:
        version="1.0.0"
        def score(self,features):
            assert not {"id","vendor_id","created_by","ground_truth"} & features[0].keys()
            return [80.0]
    seen=[]
    def load(digest):seen.append(digest);return Model()
    disabled=audit.build_bundle(item,model_loader=load)
    assert disabled["anomaly"]["reason"]=="MODEL_SCORING_DISABLED" and not seen
    result=audit.build_bundle(item,allow_model=True,model_loader=load)
    assert seen==["a"*64]
    assert result["risk_score"]==44.0 and result["risk_level"]=="LOW"
    assert result["anomaly"]["validation_reference"]=="independent-validation-test"


@pytest.mark.parametrize("change,reason",[("currency","MODEL_CURRENCY_UNSUPPORTED"),
    ("features","MODEL_FEATURES_MISSING"),("context","MODEL_CONTEXT_INCOMPLETE")])
def test_unapproved_conditions_never_load_model(change,reason):
    item=job();item["snapshot"]["configuration"]["model_approval"]=approval()
    if change=="currency":item["snapshot"]["configuration"]["model_approval"]["supported_currencies"]=["EUR"]
    elif change=="features":item["canonical"]["category"]=None
    else:item["snapshot"]["configuration"]["vendor_registry"]=None
    def forbidden(_):raise AssertionError("Ineligible source loaded model")
    bundle=audit.build_bundle(item,allow_model=True,model_loader=forbidden)
    assert bundle["anomaly"]["reason"]==reason
    assert bundle["risk_score"] is None


def test_invalid_or_mismatched_model_does_not_return_fake_score():
    item=job();item["snapshot"]["configuration"]["model_approval"]=approval()
    class Model:
        version="1.0.0"
        def score(self,_):return [float("nan")]
    with pytest.raises(audit.ModelUnavailable):
        audit.build_bundle(item,allow_model=True,model_loader=lambda _:Model())
    with pytest.raises(audit.ModelUnavailable):
        audit.approved_model("0"*64)


def test_worker_flags_and_safe_context_failure(monkeypatch):
    calls=[];queue=[job()]
    def rpc(name,payload):
        calls.append((name,deepcopy(payload)))
        if name=="prepare_feed_audits":return 1
        if name=="claim_feed_audit":return queue.pop(0) if queue else None
        if name=="finish_feed_audit":return True
        if name=="release_feed_audit":return None
        raise AssertionError(name)
    monkeypatch.setattr(audit.repository,"rpc",rpc)
    monkeypatch.setenv("INGESTION_ENABLED","true")
    monkeypatch.setenv("INGESTION_AUDIT_ENABLED","false")
    assert asyncio.run(audit.audit_once())==0 and not calls
    monkeypatch.setenv("INGESTION_AUDIT_ENABLED","true")
    assert asyncio.run(audit.audit_once())==1
    assert any(name=="finish_feed_audit" for name,_ in calls)
    item=job();item["snapshot"]=None;queue.append(item)
    assert asyncio.run(audit.audit_once())==0
    assert next(p for name,p in reversed(calls) if name=="release_feed_audit")["p_code"]=="AUDIT_CONTEXT_MISSING"


def payments_approval():
    return {**approval(), 'model_version':'payments-primary-no-calendar-1.0.0',
            'feature_version':'payments-source-no-calendar-1.0.0', 'dataset_key':'payments-source-v1',
            'model_bucket':'private-models', 'model_object':'payments/model.joblib'}


def test_payments_model_uses_original_fields_with_partial_rules_and_simulated_clock():
    item=simulation_job()
    item['canonical'].update(amount='60.00',currency='USD',vendor_name='Original exact name',category=None,approver_role=None)
    item['snapshot']['configuration'].update(model_approval=payments_approval(),invoice_splitting_mode='SUBTHRESHOLD_PAYMENTS',vendor_registry=None)
    item['snapshot']['history']['subthreshold_invoice_splitting_context']={'historical_transaction_count':0,'window_total_amount':'60.00'}
    before=deepcopy(item)
    seen=[]
    class Model:
        version='payments-primary-no-calendar-1.0.0'
        def score_source_rows(self, rows):
            seen.extend(rows)
            return [0.5],[82.0]
    result=audit.build_bundle(item,allow_model=True,payments_model_loader=lambda *args:Model())
    assert seen==[{'AMOUNT':'60.00','CHECK DATE':'01/01/2002','VENDOR NAME':'Original exact name'}]
    assert result['ai_score']==82 and result['risk_score'] is None
    assert result['coverage']['evaluated']<5
    assert result['anomaly']['feature_time_basis']=='SOURCE_FIELDS'
    assert item==before


def test_payments_model_combines_only_complete_rules_without_retail_fallback():
    item=job()
    item['canonical'].update(vendor_name='Original source',category=None,approver_role=None)
    item['snapshot']['configuration']['model_approval']=payments_approval()
    class Model:
        version='payments-primary-no-calendar-1.0.0'
        def score_source_rows(self, rows):return [0.6],[80.0]
    def forbidden(_):raise AssertionError('Retail fallback forbidden')
    result=audit.build_bundle(item,allow_model=True,model_loader=forbidden,payments_model_loader=lambda *args:Model())
    assert result['coverage']['evaluated']==5 and result['risk_score']==44.0
    assert result['anomaly']['dataset_key']=='payments-source-v1'


@pytest.mark.parametrize('field,value,reason',[
    ('currency','SAR','MODEL_CURRENCY_UNSUPPORTED'),('amount','0','MODEL_FEATURES_MISSING'),
    ('vendor_name',None,'MODEL_FEATURES_MISSING'),('timestamp',None,'MODEL_FEATURES_MISSING')])
def test_payments_model_refuses_ineligible_source_features(field,value,reason):
    item=job();item['canonical']['vendor_name']='Original source';item['canonical'][field]=value
    item['snapshot']['configuration']['model_approval']=payments_approval()
    def forbidden(*args):raise AssertionError('Ineligible Payments model loaded')
    result=audit.build_bundle(item,allow_model=True,payments_model_loader=forbidden)
    assert result['ai_score'] is None and result['anomaly']['reason']==reason


def test_payments_approval_rejects_version_currency_and_storage_path_mismatches():
    for change in ({'feature_version':'1.0.0'},{'model_object':'../model.joblib'},{'supported_currencies':['SAR']}):
        with pytest.raises(ValueError):audit.PaymentsModelApproval.model_validate({**payments_approval(),**change})


def test_payments_download_failure_blocks_instead_of_faking_scores(monkeypatch):
    import httpx
    from app.services import primary_dataset
    def unavailable(_):raise httpx.ConnectError('Unavailable')
    monkeypatch.setattr(primary_dataset,'_private_artifact',unavailable)
    audit.approved_payments_model.cache_clear()
    with pytest.raises(audit.ModelUnavailable):
        audit.approved_payments_model('b'*64,'payments-source-v1','private-models','model.joblib')
