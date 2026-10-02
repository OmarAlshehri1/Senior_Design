from pathlib import Path

from app.services.anomaly_model import (
    calculate_detection_metrics,
    load_anomaly_model,
    save_anomaly_model,
    select_anomaly_threshold,
    train_anomaly_model,
)


def test_model_assigns_higher_score_to_outlier() -> None:
    training_features = [
        {
            "amount_log": 4.0 + index * 0.001,
            "category": "inventory",
        }
        for index in range(100)
    ]

    model = train_anomaly_model(training_features)

    normal_score, outlier_score = model.score(
        [
            {
                "amount_log": 4.05,
                "category": "inventory",
            },
            {
                "amount_log": 12.0,
                "category": "unusual",
            },
        ]
    )

    assert 0 <= normal_score <= 100
    assert 0 <= outlier_score <= 100
    assert outlier_score > normal_score


def test_detection_metrics_are_calculated() -> None:
    metrics = calculate_detection_metrics(
        [95.0, 85.0, 20.0, 10.0],
        [True, True, False, False],
        threshold=80.0,
    )

    assert metrics == {
        "detection_rate": 1.0,
        "false_positive_rate": 0.0,
    }


def test_threshold_uses_validation_targets() -> None:
    class FakeModel:
        threshold = 100.0

        def score(
            self,
            feature_records: list[
                dict[str, float | str]
            ],
        ) -> list[float]:
            return [95.0, 90.0, 20.0, 10.0]

    model = FakeModel()

    result = select_anomaly_threshold(
        model,  # type: ignore[arg-type]
        [{}, {}, {}, {}],
        [True, True, False, False],
    )

    assert result == {
        "threshold": 90.0,
        "detection_rate": 1.0,
        "false_positive_rate": 0.0,
    }
    assert model.threshold == 90.0


def test_model_artifact_round_trip(
    tmp_path: Path,
) -> None:
    model = train_anomaly_model(
        [
            {"amount_log": float(index)}
            for index in range(20)
        ]
    )
    model.threshold = 88.5
    artifact_path = tmp_path / "model.joblib"

    save_anomaly_model(model, artifact_path)
    loaded = load_anomaly_model(artifact_path)

    assert loaded.version == "1.0.0"
    assert loaded.threshold == 88.5
    assert loaded.score(
        [{"amount_log": 5.0}]
    ) == model.score(
        [{"amount_log": 5.0}]
    )
