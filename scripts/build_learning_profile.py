#!/usr/bin/env python3
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "weakness_profile.json"
SIGNAL_SOURCE = ROOT / "data" / "learning_signal_profile.json"
OUTPUT = ROOT / "frontend" / "public" / "data" / "learning_profile.json"
MIN_SIGNAL_CONFIDENCE_FOR_OVERRIDE = 0.4


INTERVENTION_LABELS = {
    "concept_contrast": "見分け問題",
    "process_scaffold": "式・図・穴埋め",
    "short_reading_evidence": "短文根拠確認",
    "slow_confirm": "ゆっくり確認",
    "rest_or_short_block": "短いブロック",
    "fix_question": "問題品質確認",
    "maintain": "維持確認",
}


def pattern_map(profile: dict) -> dict[str, dict]:
    rows: dict[str, dict] = {}
    patterns = profile.get("patterns", {})
    for subject, subject_rows in patterns.items():
        if not isinstance(subject_rows, list):
            continue
        for row in subject_rows:
            if isinstance(row, dict) and isinstance(row.get("id"), str):
                rows[row["id"]] = {**row, "subject": subject}
    return rows


def last_test_result(row: dict) -> str | None:
    evidence = row.get("evidence_tier") if isinstance(row.get("evidence_tier"), dict) else {}
    for key in ("last_failed_test", "last_app_evidence", "state"):
        value = evidence.get(key)
        if isinstance(value, str) and value:
            return value
    for key, value in sorted(row.items(), reverse=True):
        if key.startswith("reason_") and isinstance(value, str) and value:
            return value
    return None


def signal_map(profile: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    rows: dict[tuple[str, str], dict[str, Any]] = {}
    for item in profile.get("rows", []):
        if not isinstance(item, dict):
            continue
        subject = item.get("subject")
        pattern_id = item.get("pattern_id")
        if isinstance(subject, str) and isinstance(pattern_id, str):
            rows[(subject, pattern_id)] = item
    return rows


def load_signal_profile(path: Path = SIGNAL_SOURCE) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "rows": []}
    return json.loads(path.read_text(encoding="utf-8"))


def can_override_question_type(signal_row: dict[str, Any] | None) -> bool:
    if not signal_row:
        return False
    confidence = signal_row.get("signal_confidence")
    return (
        isinstance(confidence, (int, float))
        and confidence >= MIN_SIGNAL_CONFIDENCE_FOR_OVERRIDE
    )


def next_question_type(row: dict, signal_row: dict[str, Any] | None = None) -> str:
    intervention = signal_row.get("recommended_intervention") if signal_row else None
    if (
        can_override_question_type(signal_row)
        and isinstance(intervention, str)
        and intervention in INTERVENTION_LABELS
    ):
        return INTERVENTION_LABELS[intervention]
    evidence = row.get("evidence_tier") if isinstance(row.get("evidence_tier"), dict) else {}
    state = evidence.get("state")
    if state in {"recurred", "new"}:
        return "転移・本番形式"
    if row.get("score", 0) >= 70:
        return "短い復習ブロック"
    return "維持確認"


def build_learning_profile_payload(
    profile: dict[str, Any],
    signal_profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    signal_profile = signal_profile or {"rows": []}
    patterns = pattern_map(profile)
    signals = signal_map(signal_profile)
    weaknesses = []
    for item in profile.get("priority_queue", []):
        if not isinstance(item, dict):
            continue
        pattern_id = item.get("pattern_id")
        subject = item.get("subject")
        if not isinstance(pattern_id, str) or subject not in {"math", "japanese"}:
            continue
        detail = patterns.get(pattern_id, {})
        signal_row = signals.get((subject, pattern_id))
        weakness = {
            "pattern_id": pattern_id,
            "subject": subject,
            "score": item.get("score", detail.get("score", 0)),
            "severity": item.get("severity", detail.get("severity", "medium")),
            "name": detail.get("name", pattern_id),
            "last_test_result": last_test_result(detail),
            "next_question_type": next_question_type(detail, signal_row),
        }
        if signal_row:
            for key in (
                "learning_signal",
                "signal_confidence",
                "recommended_intervention",
                "recent_valid_accuracy",
                "recent_fast_wrong_rate",
                "recent_late_drop_rate",
            ):
                weakness[key] = signal_row.get(key)
        weaknesses.append(weakness)

    return {
        "version": 2,
        "last_updated": profile.get("last_updated", ""),
        "signal_profile_generated_at": signal_profile.get("generated_at"),
        "weaknesses": weaknesses,
    }


def main() -> None:
    profile = json.loads(SOURCE.read_text(encoding="utf-8"))
    signal_profile = load_signal_profile()
    payload = build_learning_profile_payload(profile, signal_profile)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
