import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from audit_learning_signals import (
    Attempt,
    AttemptGroup,
    QuestionMeta,
    audit_groups,
    build_attempt,
    build_question_meta_from_lesson,
    classify_signal,
    group_attempts,
)


def meta(**overrides):
    base = {
        "question_id": "q-lesson-m-0521-01",
        "lesson_id": "lesson-m-0521",
        "lesson_title": "test",
        "subject": "math",
        "position": 1,
        "total_questions": 30,
        "unit_id": "unit",
        "difficulty": "d3",
        "question_type": "single_tier",
        "tier1_purpose": "answer",
        "tier2_purpose": "",
        "step_purpose": "answer",
        "question_text": "1 + 1",
        "answer": "2",
        "common_mistakes": (),
    }
    base.update(overrides)
    return QuestionMeta(**base)


def group(**overrides):
    question_meta = overrides.pop("meta", meta())
    base = {
        "session_id": "session-1",
        "question_id": question_meta.question_id,
        "lesson_id": question_meta.lesson_id,
        "play_run": 0,
        "user_answer": "1",
        "is_correct": False,
        "time_spent_sec": 10,
        "answered_at": "2026-05-21T00:00:00.000Z",
        "day": "2026-05-21",
        "step": 1,
        "unit_id": question_meta.unit_id,
        "difficulty": question_meta.difficulty,
        "question_type": question_meta.question_type,
        "step_purpose": question_meta.step_purpose,
        "subject": question_meta.subject,
        "meta": question_meta,
    }
    base.update(overrides)
    attempt = Attempt(**base)
    return AttemptGroup(
        key=(
            attempt.session_id,
            attempt.lesson_id,
            attempt.play_run,
            attempt.question_id,
            attempt.step,
        ),
        attempts=(attempt,),
        first=attempt,
        last=attempt,
        position=attempt.meta.position if attempt.meta else None,
        total_questions=attempt.meta.total_questions if attempt.meta else None,
    )


def test_question_quality_bug_when_wrong_log_matches_lesson_answer():
    signal, _ = classify_signal(group(user_answer="2"))
    assert signal == "question_quality_bug"


def test_late_short_wrong_is_fatigue_throwaway():
    question_meta = meta(position=24)
    signal, _ = classify_signal(group(meta=question_meta, time_spent_sec=2))
    assert signal == "fatigue_throwaway"


def test_early_short_wrong_is_careless_noise():
    signal, _ = classify_signal(group(time_spent_sec=2))
    assert signal == "careless_or_tap_noise"


def test_japanese_evidence_miss_is_reading_load():
    question_meta = meta(
        lesson_id="lesson-j-0521",
        question_id="q-lesson-j-0521-12",
        subject="japanese",
        difficulty="d4",
        step_purpose="evidence",
    )
    signal, _ = classify_signal(group(meta=question_meta, time_spent_sec=8))
    assert signal == "reading_load"


def test_formula_miss_is_procedure_gap():
    question_meta = meta(step_purpose="formula")
    signal, _ = classify_signal(group(meta=question_meta, time_spent_sec=8))
    assert signal == "procedure_gap"


def test_group_attempts_separates_replay_after_long_gap():
    question_meta = meta(position=1)
    first_run = group(
        meta=question_meta,
        is_correct=False,
        answered_at="2026-05-21T00:00:00.000Z",
    ).first
    second_run = group(
        meta=question_meta,
        is_correct=True,
        answered_at="2026-05-21T01:00:00.000Z",
    ).first

    groups = group_attempts([first_run, second_run])

    assert len(groups) == 2
    assert [item.play_run for item in (groups[0].first, groups[1].first)] == [0, 1]
    assert groups[0].last.is_correct is False
    assert groups[1].first.is_correct is True


def test_group_attempts_keeps_immediate_retry_in_same_group():
    question_meta = meta(position=1)
    wrong = group(
        meta=question_meta,
        is_correct=False,
        answered_at="2026-05-21T00:00:00.000Z",
    ).first
    retry = group(
        meta=question_meta,
        is_correct=True,
        answered_at="2026-05-21T00:00:20.000Z",
    ).first

    groups = group_attempts([wrong, retry])

    assert len(groups) == 1
    assert len(groups[0].attempts) == 2
    assert groups[0].first.is_correct is False
    assert groups[0].last.is_correct is True


def test_two_tier_step2_uses_tier2_purpose_when_payload_is_legacy():
    lesson = {
        "lesson_id": "lesson-m-test",
        "subject": "math",
        "title": "two tier",
        "questions": [
            {
                "position": 1,
                "unit_id": "two-tier-unit",
                "difficulty": "d3",
                "question_text": "式を選ぶ問題",
                "answer": "20",
                "question_type": "two_tier",
                "tier1_purpose": "strategy",
                "tier2_purpose": "answer",
            }
        ],
    }
    meta_by_question = build_question_meta_from_lesson(lesson)
    attempt = build_attempt(
        {
            "type": "answer",
            "session_id": "session-1",
            "occurred_at": "2026-05-21T00:00:00.000Z",
            "payload": {
                "question_id": "q-lesson-m-test-01",
                "lesson_id": "lesson-m-test",
                "user_answer": "10",
                "is_correct": False,
                "time_spent_sec": 10,
                "step": 2,
                "answered_at": "2026-05-21T00:00:00.000Z",
            },
        },
        meta_by_question,
    )

    assert attempt is not None
    assert attempt.step_purpose == "answer"
    rows = audit_groups(group_attempts([attempt]))
    assert rows[0].signal == "concept_gap"


def test_error_diagnosis_is_procedure_gap():
    question_meta = meta(tier1_purpose="error_diagnosis", step_purpose="")
    signal, _ = classify_signal(group(meta=question_meta, step_purpose="error_diagnosis"))
    assert signal == "procedure_gap"
