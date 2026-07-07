import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from audit_learning_signals import Attempt, QuestionMeta, group_attempts
from build_learning_signal_profile import build_signal_profile


def meta(unit_id="kakudo", position=1, total=10, purpose="answer"):
    return QuestionMeta(
        question_id=f"q-lesson-m-test-{position:02d}",
        lesson_id="lesson-m-test",
        lesson_title="test",
        subject="math",
        position=position,
        total_questions=total,
        unit_id=unit_id,
        difficulty="d3",
        question_type="single_tier",
        tier1_purpose=purpose,
        tier2_purpose="",
        step_purpose=purpose,
        question_text="角度を求める",
        answer="60",
        common_mistakes=(),
    )


def attempt(question_meta, *, correct, sec, answered_at, answer="1", session_id="session-1"):
    return Attempt(
        session_id=session_id,
        question_id=question_meta.question_id,
        lesson_id=question_meta.lesson_id,
        play_run=0,
        user_answer=answer,
        is_correct=correct,
        time_spent_sec=sec,
        answered_at=answered_at,
        day="2026-05-21",
        step=1,
        unit_id=question_meta.unit_id,
        difficulty=question_meta.difficulty,
        question_type=question_meta.question_type,
        step_purpose=question_meta.step_purpose,
        subject=question_meta.subject,
        meta=question_meta,
    )


def test_build_signal_profile_derives_intervention_and_rates():
    groups = group_attempts(
        [
            attempt(meta(position=1, purpose="formula"), correct=False, sec=8, answered_at="2026-05-21T00:00:00Z"),
            attempt(meta(position=2), correct=True, sec=10, answered_at="2026-05-21T00:00:20Z", answer="60"),
            attempt(meta(position=8), correct=False, sec=2, answered_at="2026-05-21T00:00:40Z"),
        ]
    )

    profile = build_signal_profile(
        groups,
        start_date="2026-05-21",
        end_date="2026-05-21",
        generated_at="2026-05-21T00:00:00+09:00",
    )
    row = profile["rows"][0]

    assert row["pattern_id"] == "kakudo"
    assert row["learning_signal"] == "procedure_gap"
    assert row["recommended_intervention"] == "process_scaffold"
    assert row["recent_valid_accuracy"] == 50.0
    assert row["recent_fast_wrong_rate"] == 33.3
    assert row["recent_late_drop_rate"] == 100.0


def test_signal_profile_keeps_replayed_question_groups_separate():
    question_meta = meta(position=1, purpose="formula")
    groups = group_attempts(
        [
            attempt(
                question_meta,
                correct=False,
                sec=8,
                answered_at="2026-05-21T00:00:00Z",
                session_id="session-1",
            ),
            attempt(
                question_meta,
                correct=False,
                sec=9,
                answered_at="2026-05-21T00:01:00Z",
                session_id="session-2",
            ),
            attempt(
                question_meta,
                correct=False,
                sec=2,
                answered_at="2026-05-21T00:02:00Z",
                session_id="session-3",
            ),
        ]
    )

    profile = build_signal_profile(
        groups,
        start_date="2026-05-21",
        end_date="2026-05-21",
        generated_at="2026-05-21T00:00:00+09:00",
    )
    row = profile["rows"][0]

    assert row["learning_signal"] == "procedure_gap"
    assert row["signal_counts"] == {"careless_or_tap_noise": 1, "procedure_gap": 2}
