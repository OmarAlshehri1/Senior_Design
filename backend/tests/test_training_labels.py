import pytest

from scripts import train_anomaly_model as training


def test_missing_or_ambiguous_labels_are_not_negative_examples(monkeypatch, tmp_path):
    source = tmp_path / "synthetic.xlsx"
    source.write_bytes(b"synthetic parser stub")
    labels = [True, False, None, "false", 0, 1, 2]
    monkeypatch.setattr(training, "parse_transaction_workbook", lambda _: {
        "transactions": [
            {"id": str(i), "metadata": {"ground_truth": {"is_anomaly": label}}}
            for i, label in enumerate(labels)
        ] + [{"id": "missing", "metadata": {}}]
    })
    assert training._load_labels(source) == {"0": True, "1": False, "4": False, "5": True}


def test_conflicting_duplicate_labels_stop_training(monkeypatch, tmp_path):
    source = tmp_path / "synthetic.xlsx"
    source.write_bytes(b"synthetic parser stub")
    monkeypatch.setattr(training, "parse_transaction_workbook", lambda _: {
        "transactions": [
            {"id": "same", "metadata": {"ground_truth": {"is_anomaly": label}}}
            for label in (False, True)
        ]
    })
    with pytest.raises(ValueError, match="Conflicting labels"):
        training._load_labels(source)
