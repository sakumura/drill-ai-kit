import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_learning_profile import build_learning_profile_payload


def test_learning_profile_merges_signal_profile_fields():
    weakness_profile = {
        "last_updated": "2026-05-21T00:00:00+09:00",
        "patterns": {
            "math": [
                {
                    "id": "kakudo",
                    "name": "角度",
                    "score": 90,
                    "severity": "critical",
                    "evidence_tier": {"state": "recurred"},
                }
            ]
        },
        "priority_queue": [
            {"pattern_id": "kakudo", "subject": "math", "score": 100, "severity": "critical"}
        ],
    }
    signal_profile = {
        "generated_at": "2026-05-21T00:00:00+09:00",
        "rows": [
            {
                "pattern_id": "kakudo",
                "subject": "math",
                "learning_signal": "procedure_gap",
                "signal_confidence": 0.8,
                "recommended_intervention": "process_scaffold",
                "recent_valid_accuracy": 40.0,
                "recent_fast_wrong_rate": 20.0,
                "recent_late_drop_rate": 50.0,
            }
        ],
    }

    payload = build_learning_profile_payload(weakness_profile, signal_profile)
    row = payload["weaknesses"][0]

    assert payload["version"] == 2
    assert payload["signal_profile_generated_at"] == "2026-05-21T00:00:00+09:00"
    assert row["learning_signal"] == "procedure_gap"
    assert row["recommended_intervention"] == "process_scaffold"
    assert row["next_question_type"] == "式・図・穴埋め"
    assert row["recent_valid_accuracy"] == 40.0


def test_low_confidence_signal_does_not_override_question_type():
    weakness_profile = {
        "last_updated": "2026-05-21T00:00:00+09:00",
        "patterns": {
            "math": [
                {
                    "id": "kakudo",
                    "name": "角度",
                    "score": 90,
                    "severity": "critical",
                    "evidence_tier": {"state": "recurred"},
                }
            ]
        },
        "priority_queue": [
            {"pattern_id": "kakudo", "subject": "math", "score": 100, "severity": "critical"}
        ],
    }
    signal_profile = {
        "generated_at": "2026-05-21T00:00:00+09:00",
        "rows": [
            {
                "pattern_id": "kakudo",
                "subject": "math",
                "learning_signal": "fatigue_throwaway",
                "signal_confidence": 0.2,
                "recommended_intervention": "rest_or_short_block",
                "recent_valid_accuracy": 100.0,
                "recent_fast_wrong_rate": 0.0,
                "recent_late_drop_rate": None,
            }
        ],
    }

    payload = build_learning_profile_payload(weakness_profile, signal_profile)
    row = payload["weaknesses"][0]

    assert row["learning_signal"] == "fatigue_throwaway"
    assert row["recommended_intervention"] == "rest_or_short_block"
    assert row["next_question_type"] == "転移・本番形式"
