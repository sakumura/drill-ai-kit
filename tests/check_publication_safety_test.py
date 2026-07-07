import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scripts.check_publication_safety import check_files


def test_allows_current_synthetic_data_allowlist():
    warnings = check_files(
        [
            "data/learning_signal_profile.json",
            "data/play_log/2026-07-01.jsonl",
            "data/textbooks/curriculum/curriculum.json",
            "frontend/public/data/lessons.json",
        ]
    )

    assert warnings == []


def test_rejects_env_and_production_frontend_env():
    warnings = check_files([".env", "frontend/.env.production", ".dev.vars"])

    assert any("'.env'" in warning for warning in warnings)
    assert any("'frontend/.env.production'" in warning for warning in warnings)
    assert any("'.dev.vars'" in warning for warning in warnings)


def test_rejects_unallowlisted_root_data_file():
    warnings = check_files(["data/students/child-a/weakness_profile.json"])

    assert any("許可リスト外 data ファイル" in warning for warning in warnings)
    assert any("実運用データを示す名前" in warning for warning in warnings)


def test_rejects_sensitive_binary_like_data_file():
    warnings = check_files(["data/practice_test/2026-07/answer-sheet.png"])

    assert any("画像/PDF/表計算" in warning for warning in warnings)


def test_rejects_unallowlisted_public_frontend_data():
    warnings = check_files(["frontend/public/data/user-state-real.json"])

    assert any("public 配信対象" in warning for warning in warnings)
