"""
tests/validate_lesson_format_test.py

validate_lesson_format.py のユニットテスト。
正解肢に解法ヒント・公式・概念説明が混入する典型パターンの NG ケースと、
数値・短答・長文許容ユニットなどの OK ケースを検証する。
"""
import sys
import os

# scripts/ を import パスに追加
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

import pytest
from validate_lesson_format import (
    check_answer,
    check_question_extended,
    batch_validate,
    load_allowed_units,
    load_r10r16_config,
    validate_remediation_and_blocks,
    VALIDATION_MD_PATH,
)


# ─────────────────────────────────────────────
# 共通フィクスチャ: 許容ユニット一覧
# ─────────────────────────────────────────────

@pytest.fixture(scope="module")
def allowed_units():
    return load_allowed_units(VALIDATION_MD_PATH)


# ─────────────────────────────────────────────
# NG ケース（条件 1-4 のいずれかに引っかかるべき）
# ─────────────────────────────────────────────

def test_ng_rule3_rule4_equivalent_transform(allowed_units):
    """等積変形の解法ヒント文: 条件3(20字超)・条件4(助詞3+数字0)"""
    answer = "等積変形: 三角形の頂点を底辺と平行線上で動かしても面積不変"
    unit_id = "tamen-tayoukei"
    options = [answer, "底辺を変える", "高さを変える"]
    violations = check_answer(answer, unit_id, options, allowed_units)
    assert len(violations) > 0, f"NG 未検出: {answer!r}"


def test_ng_rule1_equal_sign(allowed_units):
    """平行四辺形公式: 条件1 (= を含む)"""
    answer = "平行四辺形の面積 = 底辺 × 高さ"
    unit_id = "tamen-tayoukei"
    options = [answer, "96", "48"]
    violations = check_answer(answer, unit_id, options, allowed_units)
    assert len(violations) > 0, f"NG 未検出: {answer!r}"


def test_ng_rule1_arrow(allowed_units):
    """u段→e段＋る: 条件1 (→ を含む)"""
    answer = "u段→e段＋る"
    unit_id = "kanou-jihatsu-ukemi"
    options = [answer, "可能", "受身"]
    violations = check_answer(answer, unit_id, options, allowed_units)
    assert len(violations) > 0, f"NG 未検出: {answer!r}"


def test_ng_rule3_rule4_jizen_concept(allowed_units):
    """自発概念の説明文: 条件3(20字超)・条件4(助詞3+数字0)"""
    answer = "気持ち・考えが自然に湧く場面は自発表現。『思い出される』"
    unit_id = "kanou-jihatsu-ukemi"
    options = [answer, "可能", "受身"]
    violations = check_answer(answer, unit_id, options, allowed_units)
    assert len(violations) > 0, f"NG 未検出: {answer!r}"


def test_ng_rule3_triangle_congruent(allowed_units):
    """2直角三角形合同の説明: 条件3(20字超)"""
    answer = "2つの直角三角形は合同（3-4-5比? 5-12-13の比）"
    unit_id = "tamen-tayoukei"
    options = [answer, "96", "48"]
    violations = check_answer(answer, unit_id, options, allowed_units)
    assert len(violations) > 0, f"NG 未検出: {answer!r}"


def test_ng_rule1_union_intersection(allowed_units):
    """包除原理: 条件1 (∪, ∩, = を含む)"""
    answer = "包除原理: A∪B∪C = A+B+C - (A∩B) - (B∩C) - (A∩C) + (A∩B∩C)"
    unit_id = "tamen-tayoukei"
    options = [answer, "96", "48"]
    violations = check_answer(answer, unit_id, options, allowed_units)
    assert len(violations) > 0, f"NG 未検出: {answer!r}"


def test_ng_rule1_sqrt_equal(allowed_units):
    """対角線 = √: 条件1 (=, √ を含む)"""
    answer = "対角線の長さ = √(AB² + BC²)"
    unit_id = "tamen-tayoukei"
    options = [answer, "96", "48"]
    violations = check_answer(answer, unit_id, options, allowed_units)
    assert len(violations) > 0, f"NG 未検出: {answer!r}"


# ─────────────────────────────────────────────
# OK ケース（すべて条件 1-4 を通過すべき）
# ─────────────────────────────────────────────

def test_ok_fraction_2_3(allowed_units):
    """分数 2/3: 数値 OK"""
    violations = check_answer("2/3", "yakubun-incomplete", ["2/3", "3/4", "1/3"], allowed_units)
    assert violations == [], f"誤 NG: {violations}"


def test_ok_integer_96(allowed_units):
    """整数 96: 数値 OK"""
    violations = check_answer("96", "tamen-tayoukei", ["96", "48", "72"], allowed_units)
    assert violations == [], f"誤 NG: {violations}"


def test_ok_fraction_1_6(allowed_units):
    """分数 1/6: 分数 OK"""
    violations = check_answer("1/6", "shigotozan", ["1/6", "1/3", "1/2"], allowed_units)
    assert violations == [], f"誤 NG: {violations}"


def test_ok_integer_75(allowed_units):
    """整数 75: 角度数値 OK"""
    violations = check_answer("75", "kakudo", ["75", "60", "90"], allowed_units)
    assert violations == [], f"誤 NG: {violations}"


def test_ok_kanji_tegami(allowed_units):
    """漢字 手紙: 短答 OK"""
    violations = check_answer("手紙", "sk-kanji", ["手紙", "荷物", "封筒"], allowed_units)
    assert violations == [], f"誤 NG: {violations}"


def test_ok_kanoushi_aeru(allowed_units):
    """可能動詞 会える: 変換後単語 OK"""
    violations = check_answer("会える", "kanou-jihatsu-ukemi", ["会える", "会いたい", "会わせる"], allowed_units)
    assert violations == [], f"誤 NG: {violations}"


def test_ok_label_kanou(allowed_units):
    """分類ラベル 可能: 1語 OK"""
    violations = check_answer("可能", "kanou-jihatsu-ukemi", ["可能", "受身", "自発"], allowed_units)
    assert violations == [], f"誤 NG: {violations}"


def test_ok_long_answer_kokoro(allowed_units):
    """長文正答許容ユニット kokoro-kansetsu: 60字まで OK"""
    answer = "新参の子はサッカリなんか夢中になっていなかったから"
    violations = check_answer(answer, "kokoro-kansetsu", [answer, "楽しかったから", "好きだったから"], allowed_units)
    assert violations == [], f"誤 NG: {violations}"


def test_ok_long_answer_sk_hitei(allowed_units):
    """長文正答許容ユニット sk-hitei: 20字超でも OK"""
    answer = "ホタルは昼間に光を出す"
    violations = check_answer(answer, "sk-hitei", [answer, "ホタルは夜に光を出す", "ホタルは水中で光を出す"], allowed_units)
    assert violations == [], f"誤 NG: {violations}"


def test_ok_dotted_numbers(allowed_units):
    """数字+・列挙 2・3・5: 条件2に引っかからない"""
    violations = check_answer("2・3・5", "yakusuu", ["2・3・5", "1・2・3", "3・5・7"], allowed_units)
    assert violations == [], f"誤 NG: {violations}"


# ─────────────────────────────────────────────
# 追加: 条件2の境界値テスト
# ─────────────────────────────────────────────

def test_ng_rule1_formula_with_equal(allowed_units):
    """三角形の面積 = ... 形式（= で始まる公式）: 条件1"""
    answer = "三角形の面積 = 底辺 × 高さ ÷ 2"
    violations = check_answer(answer, "tamen-tayoukei", [answer, "96", "48"], allowed_units)
    assert len(violations) > 0, f"NG 未検出: {answer!r}"


def test_ok_short_kanji(allowed_units):
    """短い漢字 正答: idiom_vocabulary_units なら助詞閾値 5"""
    # 「が」「を」「の」が 3つ → 通常は NG だが idiom なら閾値 5 なので OK
    # ただし数字がないと閾値 3 でも NG になる
    # ここは通常の短答テスト
    violations = check_answer("学校", "sk-kanji", ["学校", "学問", "勉強"], allowed_units)
    assert violations == [], f"誤 NG: {violations}"


def test_ok_goi_kanyouku_particle_threshold_relaxed(allowed_units):
    """goi-kanyouku: 正解肢が20字未満で助詞5個ちょうどなら OK"""
    answer = "犬の手も猫の手も借りる"
    violations = check_answer(answer, "goi-kanyouku", [answer, "忙しい", "手伝う"], allowed_units)
    assert violations == [], f"誤 NG: {violations}"


def test_ok_niyouso_kijutsu_evidence_first_long_answer(allowed_units):
    """niyouso-kijutsu: evidence_first の21-59字記述正解肢は OK"""
    answer = "根拠を示して気持ちを二つの要素で説明すること"
    assert 21 <= len(answer) < 60
    violations = check_answer(answer, "niyouso-kijutsu", [answer, "根拠だけ", "気持ちだけ"], allowed_units)
    assert violations == [], f"誤 NG: {violations}"


def test_ng_niyouso_kijutsu_answer_60_chars_or_more(allowed_units):
    """niyouso-kijutsu: 60字以上の正解肢は NG"""
    answer = "本文の根拠を先に示し、そこから分かる気持ちを二つの要素で説明し、理由まで具体的にまとめることで、人物の変化も読み取れると分かる"
    assert len(answer) >= 60
    violations = check_answer(answer, "niyouso-kijutsu", [answer, "根拠だけ", "気持ちだけ"], allowed_units)
    assert any(v["rule"] == 3 for v in violations), f"条件3 未検出: {violations}"


def test_ng_long_answer_disallowed_unit_over_20_chars(allowed_units):
    """長文非許可ユニット: 21字以上の正解肢は NG"""
    answer = "本文に書かれていない内容を選ぶ問題であること"
    assert len(answer) >= 21
    violations = check_answer(answer, "kanou-jihatsu-ukemi", [answer, "書いてある", "正しい"], allowed_units)
    assert any(v["rule"] == 3 for v in violations), f"条件3 未検出: {violations}"




# ─────────────────────────────────────────────
# 新規追加: 偽陽性修正後の OK ケース・NG ケース
# ─────────────────────────────────────────────

def test_ok_sk_gacchi_hokkaido(allowed_units):
    """sk-gacchi: 助詞5個ちょうど → > 5 で false → OK"""
    answer = "北海道は酪農が盛んで牛乳の生産が多い"
    violations = check_answer(answer, "sk-gacchi", [answer, "正しい", "誤り"], allowed_units)
    assert violations == [], f"誤 NG: {violations}"


def test_ok_kanou_bunsyo_kakikae(allowed_units):
    """kanou-jihatsu-ukemi: 書き換え文（助詞3個、long_allowed で閾値5）→ OK"""
    answer = "コスモスの花を見ると母が思い出される。"
    violations = check_answer(answer, "kanou-jihatsu-ukemi", [answer, "思い出す", "思い出した"], allowed_units)
    assert violations == [], f"誤 NG: {violations}"


def test_ng_tamen_pos19_ito_e(allowed_units):
    """tamen-tayoukei: 括弧+助詞多数 → rule4 (4個 > 3) NG"""
    answer = "イとエ（または ウとエ: 平行線間の三角形は底辺と高さが同じなら面積等しい）"
    violations = check_answer(answer, "tamen-tayoukei", [answer, "ア", "イ"], allowed_units)
    assert len(violations) > 0, f"NG 未検出: {answer!r}"


def test_ng_tamen_pos20_kyoukai(allowed_units):
    """tamen-tayoukei: 境界線説明文 → rule3(20字超) or rule4(助詞多数) NG"""
    answer = "パーツの境界線が正確に一直線になっておらず、わずかな隙間（または重なり）が生じているため"
    violations = check_answer(answer, "tamen-tayoukei", [answer, "正しい", "誤り"], allowed_units)
    assert len(violations) > 0, f"NG 未検出: {answer!r}"



# ─────────────────────────────────────────────
# 新規追加: 条件0 (hints[0] != answer) のテスト
# ─────────────────────────────────────────────

ALLOWED_UNITS = None  # モジュールスコープで allowed_units を使うためフィクスチャ経由

def test_ng_rule0_hints0_mismatch(allowed_units):
    """hints[0] != answer は条件0 で NG"""
    violations = check_answer(
        answer="96",
        unit_id="tamen-tayoukei",
        options=["等積変形: 三角形の頂点を底辺と平行線上で動かしても面積不変", "48", "192"],
        allowed_units=allowed_units,
    )
    assert any(v["rule"] == 0 for v in violations), f"条件0 未検出: {violations}"


def test_ok_rule0_hints0_match(allowed_units):
    """hints[0] == answer なら条件0 OK"""
    violations = check_answer(
        answer="96",
        unit_id="tamen-tayoukei",
        options=["96", "48", "192"],
        allowed_units=allowed_units,
    )
    assert not any(v["rule"] == 0 for v in violations), f"条件0 誤検出: {violations}"


def test_ok_remediation_and_blocks_schema():
    lesson = {
        "id": "lesson-test",
        "questions": [
            {"id": "q1", "position": 1, "unit_id": "kakudo", "answer": "60", "remediation": {"same_skill_question_id": "q2", "micro_explanation": "半径を確認"}},
            {"id": "q2", "position": 2, "unit_id": "kakudo", "answer": "50"},
        ],
        "blocks": [
            {"id": "warmup", "title": "復習", "block_type": "warmup", "question_ids": ["q1"]},
            {"id": "extra", "title": "任意追加", "block_type": "optional_extra", "optional_extra": True, "question_ids": ["q2"]},
        ],
    }
    assert validate_remediation_and_blocks(lesson) == []


def test_ok_remediation_and_blocks_for_handwritten_source_without_question_ids():
    lesson = {
        "lesson_id": "lesson-m-test",
        "questions": [
            {
                "position": 1,
                "unit_id": "kakudo",
                "answer": "60",
                "remediation": {"same_skill_question_id": "q-lesson-m-test-02"},
            },
            {"position": 2, "unit_id": "kakudo", "answer": "50"},
        ],
        "blocks": [
            {
                "id": "review",
                "title": "復習",
                "block_type": "warmup",
                "question_ids": ["q-lesson-m-test-01", "q-lesson-m-test-02"],
            },
        ],
    }
    assert validate_remediation_and_blocks(lesson) == []


def test_ng_remediation_missing_target_and_bad_block():
    lesson = {
        "id": "lesson-test",
        "questions": [
            {"id": "q1", "position": 1, "unit_id": "kakudo", "answer": "60", "remediation": {"transfer_question_id": "missing"}},
        ],
        "blocks": [
            {"id": "bad", "title": "bad", "kind": "unknown", "question_ids": ["missing"]},
        ],
    }
    violations = validate_remediation_and_blocks(lesson)
    assert any(v["rule"] == "R20" for v in violations)
    assert any(v["rule"] == "R21" for v in violations)


@pytest.fixture(scope="module")
def r10r16_config():
    return load_r10r16_config(VALIDATION_MD_PATH)


def test_r10_ng_machine_template_reject(r10r16_config):
    """R10: answer=100, hints=[100,50,200] は2要素マッチで reject"""
    q = {
        "lesson_id": "lesson-m-test",
        "position": 1,
        "unit_id": "tamen-tayoukei",
        "answer": "100",
        "hints": '["100", "50", "200"]',
        "is_figure": False,
        "figure_svg": None,
        "question_text": "面積を求めなさい。",
        "reference_problem_id": None,
    }
    violations = check_question_extended(q, r10r16_config)
    r10_violations = [v for v in violations if v["rule"] == "R10"]
    assert any(v["level"] == "reject" for v in r10_violations), f"R10 reject 未検出: {violations}"


def test_r10_ng_machine_template_warn(r10r16_config):
    """R10: answer=100, hints=[100,50,300] は1要素マッチで warn"""
    q = {
        "lesson_id": "lesson-m-test",
        "position": 2,
        "unit_id": "tamen-tayoukei",
        "answer": "100",
        "hints": '["100", "50", "150"]',
        "is_figure": False,
        "figure_svg": None,
        "question_text": "面積を求めなさい。",
        "reference_problem_id": None,
    }
    violations = check_question_extended(q, r10r16_config)
    r10_violations = [v for v in violations if v["rule"] == "R10"]
    assert any(v["level"] == "warn" for v in r10_violations), f"R10 warn 未検出: {violations}"


def test_r10_ok_non_template(r10r16_config):
    """R10: answer=100, hints=[100,85,120] はマッチなし OK"""
    q = {
        "lesson_id": "lesson-m-test",
        "position": 3,
        "unit_id": "tamen-tayoukei",
        "answer": "100",
        "hints": '["100", "85", "120"]',
        "is_figure": False,
        "figure_svg": None,
        "question_text": "面積を求めなさい。",
        "reference_problem_id": None,
    }
    violations = check_question_extended(q, r10r16_config)
    r10_violations = [v for v in violations if v["rule"] == "R10"]
    assert r10_violations == [], f"R10 誤検出: {violations}"


def test_r11_ng_duplicate_qtext(r10r16_config):
    """R11: 同一 question_text（正規化後）が2問あれば reject"""
    questions = [
        {"lesson_id": "lesson-m-test", "position": 1, "unit_id": "a", "answer": "1",
         "hints": '["1","2","3"]', "is_figure": False, "figure_svg": None,
         "question_text": "面積を求めなさい。", "reference_problem_id": None},
        {"lesson_id": "lesson-m-test", "position": 2, "unit_id": "b", "answer": "2",
         "hints": '["2","1","3"]', "is_figure": False, "figure_svg": None,
         "question_text": "面積を求めなさい。", "reference_problem_id": None},
    ]
    lesson_meta_map = {"lesson-m-test": {"title": "テスト"}}
    violations = batch_validate(questions, lesson_meta_map, r10r16_config)
    r11_violations = [v for v in violations if v.get("rule") == "R11"]
    assert len(r11_violations) > 0, f"R11 未検出: {violations}"


def test_r11_ok_all_different(r10r16_config):
    """R11: 全て異なる question_text なら OK"""
    questions = [
        {"lesson_id": "lesson-m-test", "position": 1, "unit_id": "a", "answer": "1",
         "hints": '["1","2","3"]', "is_figure": False, "figure_svg": None,
         "question_text": "面積を求めなさい。", "reference_problem_id": None},
        {"lesson_id": "lesson-m-test", "position": 2, "unit_id": "b", "answer": "2",
         "hints": '["2","1","3"]', "is_figure": False, "figure_svg": None,
         "question_text": "周の長さを求めなさい。", "reference_problem_id": None},
    ]
    lesson_meta_map = {"lesson-m-test": {"title": "テスト"}}
    violations = batch_validate(questions, lesson_meta_map, r10r16_config)
    r11_violations = [v for v in violations if v.get("rule") == "R11"]
    assert r11_violations == [], f"R11 誤検出: {violations}"


def test_r11_ng_duplicate_reference_id(r10r16_config):
    """R11: 同一 reference_problem_id が2問あれば reject"""
    questions = [
        {"lesson_id": "lesson-m-test", "position": 1, "unit_id": "a", "answer": "1",
         "hints": '["1","2","3"]', "is_figure": False, "figure_svg": None,
         "question_text": "問題A", "reference_problem_id": "ref-001"},
        {"lesson_id": "lesson-m-test", "position": 2, "unit_id": "b", "answer": "2",
         "hints": '["2","1","3"]', "is_figure": False, "figure_svg": None,
         "question_text": "問題B", "reference_problem_id": "ref-001"},
    ]
    lesson_meta_map = {"lesson-m-test": {"title": "テスト"}}
    violations = batch_validate(questions, lesson_meta_map, r10r16_config)
    r11_violations = [v for v in violations if v.get("rule") == "R11"]
    assert len(r11_violations) > 0, f"R11 reference_problem_id 重複 未検出"


def test_r12_ng_is_figure_true(r10r16_config):
    """R12: is_figure=True なら reject"""
    q = {
        "lesson_id": "lesson-m-test", "position": 1, "unit_id": "a", "answer": "96",
        "hints": '["96","48","192"]', "is_figure": True, "figure_svg": None,
        "question_text": "図のように面積を求めなさい。", "reference_problem_id": None,
    }
    violations = check_question_extended(q, r10r16_config)
    r12_violations = [v for v in violations if v["rule"] == "R12"]
    assert len(r12_violations) > 0, f"R12 未検出: {violations}"


def test_r12_ng_geometry_without_svg_even_if_is_figure_false(r10r16_config):
    """R12: 図形単元/図形語なら is_figure=False でも SVG 必須"""
    q = {
        "lesson_id": "lesson-m-test", "position": 1, "unit_id": "a", "answer": "96",
        "hints": '["96","48","192"]', "is_figure": False, "figure_svg": None,
        "question_text": "長方形の面積を求めなさい。", "reference_problem_id": None,
    }
    violations = check_question_extended(q, r10r16_config)
    r12_violations = [v for v in violations if v["rule"] == "R12"]
    assert len(r12_violations) > 0, f"R12 未検出: {violations}"


def test_r13_ng_5consecutive_same_unit(r10r16_config):
    """R13: 同一 unit_id 'tamen-tayoukei' が5問連続 → reject"""
    questions = [
        {"lesson_id": "lesson-m-test", "position": i, "unit_id": "tamen-tayoukei",
         "answer": str(i), "hints": f'["{i}","1","2"]', "is_figure": False, "figure_svg": None,
         "question_text": f"問題{i}", "reference_problem_id": None}
        for i in range(1, 6)
    ]
    lesson_meta_map = {"lesson-m-test": {"title": "テスト"}}
    violations = batch_validate(questions, lesson_meta_map, r10r16_config)
    r13_violations = [v for v in violations if v.get("rule") == "R13"]
    assert len(r13_violations) > 0, f"R13 未検出"


def test_r13_ok_3consecutive_same_unit(r10r16_config):
    """R13: 同一 unit_id が3問連続なら OK"""
    questions = [
        {"lesson_id": "lesson-m-test", "position": i, "unit_id": "tamen-tayoukei",
         "answer": str(i), "hints": f'["{i}","1","2"]', "is_figure": False, "figure_svg": None,
         "question_text": f"問題{i}", "reference_problem_id": None}
        for i in range(1, 4)
    ]
    questions.append({
        "lesson_id": "lesson-m-test", "position": 4, "unit_id": "kakudo",
        "answer": "90", "hints": '["90","60","45"]', "is_figure": False, "figure_svg": None,
        "question_text": "角度問題", "reference_problem_id": None
    })
    lesson_meta_map = {"lesson-m-test": {"title": "テスト"}}
    violations = batch_validate(questions, lesson_meta_map, r10r16_config)
    r13_violations = [v for v in violations if v.get("rule") == "R13"]
    assert r13_violations == [], f"R13 誤検出: {violations}"


def test_r14_ng_daihyorei(r10r16_config):
    """R14: 問題文に '代表例の答え。' が含まれる → reject"""
    q = {
        "lesson_id": "lesson-j-test", "position": 1, "unit_id": "kanou-jihatsu-ukemi",
        "answer": "話せる", "hints": '["話せる","話す","話した"]',
        "is_figure": False, "figure_svg": None,
        "question_text": "動詞を可能動詞にしなさい。代表例の答え。",
        "reference_problem_id": None,
    }
    violations = check_question_extended(q, r10r16_config)
    r14_violations = [v for v in violations if v["rule"] == "R14"]
    assert len(r14_violations) > 0, f"R14 未検出"


def test_r14_ng_square_unit(r10r16_config):
    """R14: '□cm' が含まれる → reject"""
    q = {
        "lesson_id": "lesson-m-test", "position": 1, "unit_id": "tamen-tayoukei",
        "answer": "6", "hints": '["6","8","4"]',
        "is_figure": False, "figure_svg": None,
        "question_text": "□cmに入る長さを求めなさい（与えられている辺を使って）。",
        "reference_problem_id": None,
    }
    violations = check_question_extended(q, r10r16_config)
    r14_violations = [v for v in violations if v["rule"] == "R14"]
    assert len(r14_violations) > 0, f"R14 未検出"


def test_r14_ok_normal_qtext(r10r16_config):
    """R14: 通常の問題文は OK"""
    q = {
        "lesson_id": "lesson-m-test", "position": 1, "unit_id": "tamen-tayoukei",
        "answer": "96", "hints": '["96","48","192"]',
        "is_figure": False, "figure_svg": None,
        "question_text": "長方形の面積を求めなさい。たて12cm、横16cm。",
        "reference_problem_id": None,
    }
    violations = check_question_extended(q, r10r16_config)
    r14_violations = [v for v in violations if v["rule"] == "R14"]
    assert r14_violations == [], f"R14 誤検出: {violations}"


def test_r15_ng_dummy_choice(r10r16_config):
    """R15: hints に '△場合による' が含まれる → reject"""
    q = {
        "lesson_id": "lesson-j-test", "position": 1, "unit_id": "kanou-jihatsu-ukemi",
        "answer": "○", "hints": '["○", "△場合による", "わからない"]',
        "is_figure": False, "figure_svg": None,
        "question_text": "可能動詞に変換できますか？",
        "reference_problem_id": None,
    }
    violations = check_question_extended(q, r10r16_config)
    r15_violations = [v for v in violations if v["rule"] == "R15"]
    assert len(r15_violations) > 0, f"R15 未検出"


def test_r15_ng_wakaranai(r10r16_config):
    """R15: hints に 'わからない' が含まれる → reject"""
    q = {
        "lesson_id": "lesson-j-test", "position": 2, "unit_id": "sk-kanji",
        "answer": "友達", "hints": '["友達", "友立", "わからない"]',
        "is_figure": False, "figure_svg": None,
        "question_text": "漢字を選びなさい。",
        "reference_problem_id": None,
    }
    violations = check_question_extended(q, r10r16_config)
    r15_violations = [v for v in violations if v["rule"] == "R15"]
    assert len(r15_violations) > 0, f"R15 未検出"


def test_r15_ok_normal_hints(r10r16_config):
    """R15: 通常の hints は OK"""
    q = {
        "lesson_id": "lesson-m-test", "position": 1, "unit_id": "tamen-tayoukei",
        "answer": "96", "hints": '["96", "48", "192"]',
        "is_figure": False, "figure_svg": None,
        "question_text": "面積を求めなさい。",
        "reference_problem_id": None,
    }
    violations = check_question_extended(q, r10r16_config)
    r15_violations = [v for v in violations if v["rule"] == "R15"]
    assert r15_violations == [], f"R15 誤検出: {violations}"


def test_r16_ng_60percent_over(r10r16_config):
    """R16: 30問中20問が同一 unit_id → 66.7% > 60% → reject"""
    questions = []
    for i in range(1, 21):
        questions.append({
            "lesson_id": "lesson-j-test", "position": i, "unit_id": "kanou-jihatsu-ukemi",
            "answer": f"ans{i}", "hints": f'["ans{i}","x","y"]',
            "is_figure": False, "figure_svg": None,
            "question_text": f"問題{i}", "reference_problem_id": None,
        })
    for i in range(21, 31):
        questions.append({
            "lesson_id": "lesson-j-test", "position": i, "unit_id": "sk-kanji",
            "answer": f"ans{i}", "hints": f'["ans{i}","x","y"]',
            "is_figure": False, "figure_svg": None,
            "question_text": f"問題{i}", "reference_problem_id": None,
        })
    lesson_meta_map = {"lesson-j-test": {"title": "通常レッスン"}}
    violations = batch_validate(questions, lesson_meta_map, r10r16_config)
    r16_violations = [v for v in violations if v.get("rule") == "R16"]
    assert any(v.get("level") == "reject" for v in r16_violations), f"R16 reject 未検出"


def test_r16_ok_10out_of_30(r10r16_config):
    """R16: 30問中10問が同一 unit_id → 33.3% < 60% → OK"""
    questions = []
    for i in range(1, 11):
        questions.append({
            "lesson_id": "lesson-j-test", "position": i, "unit_id": "kanou-jihatsu-ukemi",
            "answer": f"ans{i}", "hints": f'["ans{i}","x","y"]',
            "is_figure": False, "figure_svg": None,
            "question_text": f"問題{i}", "reference_problem_id": None,
        })
    for i in range(11, 31):
        questions.append({
            "lesson_id": "lesson-j-test", "position": i, "unit_id": f"unit-{i}",
            "answer": f"ans{i}", "hints": f'["ans{i}","x","y"]',
            "is_figure": False, "figure_svg": None,
            "question_text": f"問題{i}", "reference_problem_id": None,
        })
    lesson_meta_map = {"lesson-j-test": {"title": "通常レッスン"}}
    violations = batch_validate(questions, lesson_meta_map, r10r16_config)
    r16_violations = [v for v in violations if v.get("rule") == "R16"]
    assert r16_violations == [], f"R16 誤検出: {violations}"


def test_r19_rejects_single_option_decimal_slot(r10r16_config):
    """R19: valid_positions が1個だけの slot_decimal は答えを表示してしまうため reject"""
    q = {
        "lesson_id": "lesson-m-test",
        "position": 1,
        "unit_id": "kakudo",
        "answer": "56.52",
        "hints": [],
        "question_type": "slot_decimal",
        "slot_config": {"type": "decimal", "digit_string": "5652", "valid_positions": [2]},
        "is_figure": False,
        "figure_svg": None,
        "question_text": "円周を求めなさい。",
        "reference_problem_id": None,
    }
    violations = check_question_extended(q, r10r16_config)
    r19_violations = [v for v in violations if v["rule"] == "R19"]
    assert any("1択スロット" in v["detail"] for v in r19_violations), f"R19 1択 reject 未検出: {violations}"


def test_r19_accepts_multi_option_decimal_slot(r10r16_config):
    """R19: 正解を含む複数候補の slot_decimal は OK"""
    q = {
        "lesson_id": "lesson-m-test",
        "position": 1,
        "unit_id": "kakudo",
        "answer": "56.52",
        "hints": [],
        "question_type": "slot_decimal",
        "slot_config": {"type": "decimal", "digit_string": "5652", "valid_positions": [1, 2, 3]},
        "is_figure": False,
        "figure_svg": None,
        "question_text": "円周を求めなさい。",
        "reference_problem_id": None,
    }
    violations = check_question_extended(q, r10r16_config)
    r19_violations = [v for v in violations if v["rule"] == "R19"]
    assert r19_violations == [], f"R19 誤検出: {violations}"


def test_r19_accepts_number_slot_correct_value_with_fixed_unit(r10r16_config):
    """R19: number slot は config.unit 付き correct_value も入力可能として扱う"""
    q = {
        "lesson_id": "lesson-m-test",
        "position": 1,
        "unit_id": "bunsu",
        "answer": "5/12",
        "hints": [],
        "question_type": "slot_number",
        "slot_config": {"type": "number", "digits": 1, "unit": "/12"},
        "is_figure": False,
        "figure_svg": None,
        "question_text": "分子を入力しなさい。",
        "reference_problem_id": None,
    }
    violations = check_question_extended(q, r10r16_config)
    r19_violations = [v for v in violations if v["rule"] == "R19"]
    assert r19_violations == [], f"R19 unit 付き number 誤検出: {violations}"


def test_r19_rejects_empty_kanji_slot_option(r10r16_config):
    """R19: 空文字の kanji option は placeholder と衝突して UI で選択不能になるため reject"""
    q = {
        "lesson_id": "lesson-j-test",
        "position": 1,
        "unit_id": "kanji-kakitori",
        "answer": "梅",
        "hints": [],
        "question_type": "slot_kanji",
        "slot_config": {
            "type": "kanji",
            "left_options": ["梅", "毎"],
            "right_options": [""],
            "correct_value": "梅",
        },
        "is_figure": False,
        "figure_svg": None,
        "question_text": "漢字に直しなさい。",
        "reference_problem_id": None,
    }
    violations = check_question_extended(q, r10r16_config)
    r19_violations = [v for v in violations if v["rule"] == "R19"]
    assert any("空文字" in v["detail"] for v in r19_violations), f"R19 空文字 reject 未検出: {violations}"


def _r22_base_question(**overrides):
    q = {
        "lesson_id": "lesson-m-test",
        "position": 1,
        "unit_id": "bunsu",
        "difficulty": "d4",
        "answer": "24",
        "hints": '["24", "12", "36"]',
        "question_type": "single_tier",
        "is_figure": False,
        "figure_svg": None,
        "question_text": "AはBの3/4です。Bが32のときAを求めなさい。",
        "solution_steps": ["基準量Bを確認する", "32×3/4を計算する"],
        "reference_problem_id": None,
    }
    q.update(overrides)
    return q


def test_r22_rejects_answer_only_d4_math_single_tier(r10r16_config):
    q = _r22_base_question()
    violations = check_question_extended(q, r10r16_config)
    r22 = [v for v in violations if v["rule"] == "R22"]
    assert any(v["level"] == "reject" for v in r22), f"R22 reject 未検出: {violations}"
    assert "process_understanding" in r22[0]["detail"]


def test_r22_strict_option_still_rejects_answer_only_d4_math_single_tier(r10r16_config):
    q = _r22_base_question()
    violations = check_question_extended(q, r10r16_config, strict_process_gate=True)
    r22 = [v for v in violations if v["rule"] == "R22"]
    assert any(v["level"] == "reject" for v in r22), f"R22 reject 未検出: {violations}"


def test_r22_accepts_single_tier_process_purpose(r10r16_config):
    q = _r22_base_question(tier1_purpose="strategy")
    violations = check_question_extended(q, r10r16_config, strict_process_gate=True)
    r22 = [v for v in violations if v["rule"] == "R22"]
    assert r22 == [], f"R22 process purpose 誤検出: {violations}"


def test_r22_accepts_two_tier_process_purpose(r10r16_config):
    q = _r22_base_question(
        question_type="two_tier",
        hints='["基準量はB", "基準量はA", "差を先に見る", "24", "12", "36"]',
        tier1_label="基準量を選ぼう",
        tier1_purpose="basis",
        tier2_label="答えを選ぼう",
        tier2_purpose="answer",
        tier2_correct_index=3,
    )
    violations = check_question_extended(q, r10r16_config, strict_process_gate=True)
    r22 = [v for v in violations if v["rule"] == "R22"]
    assert r22 == [], f"R22 two_tier 誤検出: {violations}"


def test_r22_accepts_exempt_reason(r10r16_config):
    q = _r22_base_question(meta={"process_gate_exempt_reason": "暗算速度を測る復習問題"})
    violations = check_question_extended(q, r10r16_config, strict_process_gate=True)
    r22 = [v for v in violations if v["rule"] == "R22"]
    assert r22 == [], f"R22 exempt 誤検出: {violations}"


def test_r22_rejects_answer_only_d4_japanese_weak_reading(r10r16_config):
    q = _r22_base_question(
        lesson_id="lesson-j-test",
        unit_id="seikaku-kijutsu",
        difficulty="d4",
        answer="本当は不安だが、友人を思って平気なふりをしている",
        hints='["本当は不安だが、友人を思って平気なふりをしている", "ただ退屈している", "友人に怒っている"]',
        question_text="本文を読んで、主人公の気持ちとして最もふさわしいものを選びなさい。",
        solution_steps=["直前の行動を確認する", "会話と表情を根拠に気持ちを判断する"],
    )
    violations = check_question_extended(q, r10r16_config, strict_process_gate=True)
    r22 = [v for v in violations if v["rule"] == "R22"]
    assert any(v["level"] == "reject" for v in r22), f"R22 reject 未検出: {violations}"


def test_r22_accepts_japanese_evidence_first(r10r16_config):
    q = _r22_base_question(
        lesson_id="lesson-j-test",
        unit_id="seikaku-kijutsu",
        difficulty="d5",
        question_type="evidence_first",
        answer="友人を思って平気なふりをしている",
        hints='["笑った後にすぐ下を向いた", "走るのが速いと書いてある", "朝ごはんを食べた", "友人を思って平気なふりをしている", "ただ退屈している", "友人に怒っている"]',
        question_text="本文を読んで、主人公の性格がわかる根拠を先に選びなさい。",
        solution_steps=["直前の行動を確認する", "会話と表情を根拠に気持ちを判断する"],
        tier1_label="根拠を選ぼう",
        tier1_purpose="evidence",
        tier2_label="性格を選ぼう",
        tier2_purpose="answer",
        tier2_correct_index=3,
    )
    violations = check_question_extended(q, r10r16_config, strict_process_gate=True)
    r22 = [v for v in violations if v["rule"] == "R22"]
    assert r22 == [], f"R22 evidence_first 誤検出: {violations}"


def test_r18_rejects_two_tier_answer_first_legacy_layout(r10r16_config):
    q = _r22_base_question(
        question_type="two_tier",
        hints='["24", "12", "36", "基準量はB", "基準量はA", "差を先に見る"]',
        tier1_label="答えを選ぼう",
        tier1_purpose="answer",
        tier2_label="基準量を選ぼう",
        tier2_purpose="basis",
        tier2_correct_index=0,
    )
    violations = check_question_extended(q, r10r16_config, strict_process_gate=True)
    r18 = [v for v in violations if v["rule"] == "R18"]
    assert any("tier1_label" in v["detail"] for v in r18), f"R18 tier1_label 未検出: {violations}"
    assert any("tier1_purpose" in v["detail"] for v in r18), f"R18 tier1_purpose 未検出: {violations}"
    assert any("tier2_purpose" in v["detail"] for v in r18), f"R18 tier2_purpose 未検出: {violations}"
    assert any("tier2_correct_index" in v["detail"] for v in r18), f"R18 tier2_correct_index 未検出: {violations}"
    assert any("hints[3]" in v["detail"] for v in r18), f"R18 hints[3] 未検出: {violations}"


def test_r22_accepts_japanese_elimination_reason_purpose(r10r16_config):
    q = _r22_base_question(
        lesson_id="lesson-j-test",
        unit_id="hitei-sentaku",
        difficulty="d4",
        question_text="本文の内容としてふさわしくないものを選ぶ前に、消去理由を選びなさい。",
        tier1_purpose="elimination_reason",
    )
    violations = check_question_extended(q, r10r16_config, strict_process_gate=True)
    r22 = [v for v in violations if v["rule"] == "R22"]
    assert r22 == [], f"R22 elimination_reason 誤検出: {violations}"


def test_r23_accepts_valid_choice_meta(r10r16_config):
    q = _r22_base_question(
        tier1_purpose="strategy",
        choice_meta=[
            {
                "step": 1,
                "choice_text": "外側の1/4円から内側の1/4円を引く",
                "role": "correct",
                "purpose": "strategy",
            },
            {
                "step": 1,
                "choice_text": "外側の1/4円だけ求める",
                "role": "distractor",
                "purpose": "strategy",
                "misconception_tag": "outer_only",
            },
        ],
    )
    violations = check_question_extended(q, r10r16_config, strict_process_gate=True)
    r23 = [v for v in violations if v["rule"] == "R23"]
    assert r23 == [], f"R23 choice_meta 誤検出: {violations}"


def test_r23_rejects_invalid_choice_meta(r10r16_config):
    q = _r22_base_question(
        tier1_purpose="strategy",
        choice_meta=[
            {
                "step": 0,
                "choice_text": "",
                "role": "wrong",
                "purpose": "not_allowed",
                "misconception_tag": 123,
            },
        ],
    )
    violations = check_question_extended(q, r10r16_config, strict_process_gate=True)
    r23 = [v for v in violations if v["rule"] == "R23"]
    assert len(r23) >= 5, f"R23 invalid choice_meta 未検出: {violations}"

# ─────────────────────────────────────────────
# R24: calc_list 正本との answer 照合
# ─────────────────────────────────────────────

import validate_lesson_format as vlf


CALC_LIST_SAMPLE = """# 第99回 計算テキスト範囲

## 計算ドリル

### 2日目
| # | 問題 | 答え | メモ |
|---|------|------|------|
| (4) | 24 ÷ 3 3/7 | 7 | 24÷24/7 |
| (5) | 時速90km = 秒速 □ m | 25 | 90000m÷3600秒 |
"""


def _calc_ref_question(answer, calc_ref):
    return {
        "lesson_id": "lesson-r24",
        "position": 1,
        "unit_id": "bunsuu-warisan",
        "answer": answer,
        "meta": {"calc_ref": calc_ref},
    }


@pytest.fixture()
def calc_list_dir(tmp_path, monkeypatch):
    calc_dir = tmp_path / "99回" / "計算"
    calc_dir.mkdir(parents=True)
    (calc_dir / "calc_list.md").write_text(CALC_LIST_SAMPLE, encoding="utf-8")
    monkeypatch.setattr(vlf, "CALC_LIST_DIR", tmp_path)
    vlf._calc_answers_cache.clear()
    yield tmp_path
    vlf._calc_answers_cache.clear()


def test_r24_accepts_matching_answer(calc_list_dir):
    q = _calc_ref_question("25", {"kai": 99, "day": 2, "q": 5})
    rejects, warns = vlf.validate_calc_refs([q])
    assert rejects == [], f"一致なのに reject: {rejects}"
    assert warns == []


def test_r24_rejects_mismatched_answer(calc_list_dir):
    q = _calc_ref_question("8", {"kai": 99, "day": 2, "q": 4})
    rejects, _ = vlf.validate_calc_refs([q])
    assert len(rejects) == 1
    assert rejects[0]["violated_rules"][0]["rule"] == "R24"
    assert "不一致" in rejects[0]["violated_rules"][0]["detail"]


def test_r24_rejects_missing_row(calc_list_dir):
    q = _calc_ref_question("25", {"kai": 99, "day": 2, "q": 9})
    rejects, _ = vlf.validate_calc_refs([q])
    assert len(rejects) == 1
    assert "対応行が無い" in rejects[0]["violated_rules"][0]["detail"]


def test_r24_warns_when_calc_list_absent(calc_list_dir):
    q = _calc_ref_question("25", {"kai": 98, "day": 2, "q": 5})
    rejects, warns = vlf.validate_calc_refs([q])
    assert rejects == []
    assert len(warns) == 1
    assert "照合スキップ" in warns[0]["violated_rules"][0]["detail"]


def test_r24_rejects_malformed_ref(calc_list_dir):
    q = _calc_ref_question("25", {"kai": 99, "day": 2})  # q 欠落
    rejects, _ = vlf.validate_calc_refs([q])
    assert len(rejects) == 1
    assert "dict が必須" in rejects[0]["violated_rules"][0]["detail"]


def test_r24_ignores_questions_without_calc_ref(calc_list_dir):
    q = {"lesson_id": "lesson-r24", "position": 1, "answer": "25", "meta": {}}
    rejects, warns = vlf.validate_calc_refs([q])
    assert rejects == [] and warns == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


# ─────────────────────────────────────────────
# sketch_gate / sketch_hint 型検証
# ─────────────────────────────────────────────

def _sketch_base_question() -> dict:
    return {
        "question_text": "三角形の内角の和は何度ですか。",
        "unit_id": "sk-zukei",
        "answer": "180",
        "hints": ["180", "360", "90"],
        "question_type": "single_tier",
    }


def test_sketch_gate_bool_is_accepted(r10r16_config):
    q = {**_sketch_base_question(), "sketch_gate": True, "sketch_hint": "線分図"}
    violations = check_question_extended(q, r10r16_config)
    assert not [v for v in violations if "sketch" in v.get("detail", "")]


def test_sketch_gate_non_bool_is_rejected(r10r16_config):
    q = {**_sketch_base_question(), "sketch_gate": "yes"}
    violations = check_question_extended(q, r10r16_config)
    assert any("sketch_gate" in v.get("detail", "") and v.get("level") == "reject" for v in violations)


def test_sketch_hint_non_string_is_rejected(r10r16_config):
    q = {**_sketch_base_question(), "sketch_gate": True, "sketch_hint": 123}
    violations = check_question_extended(q, r10r16_config)
    assert any("sketch_hint" in v.get("detail", "") and v.get("level") == "reject" for v in violations)



def _base_sketch_kind_question(**overrides):
    q = {
        "lesson_id": "lesson-j-test",
        "position": 1,
        "unit_id": "kanji-kakitori",
        "answer": "結ばれた",
        "hints": '["結ばれた","話された","読まれた"]',
        "is_figure": False,
        "figure_svg": None,
        "question_text": "『むすばれた』を漢字と送りがなで指書きしてから、答えを選ぼう。",
        "question_type": "single_tier",
        "sketch_gate": True,
        "sketch_kind": "kanji",
        "sketch_hint": "『むすばれた』を漢字と送りがなで指書きしてから、答えを選ぼう",
        "reference_problem_id": None,
    }
    q.update(overrides)
    return q


def test_r18_sketch_kind_kanji_ok_with_reading_only_hint(r10r16_config):
    violations = check_question_extended(_base_sketch_kind_question(), r10r16_config)
    r18_sketch = [v for v in violations if v["rule"] == "R18" and "sketch" in v["detail"]]
    assert r18_sketch == [], f"R18 sketch_kind 誤検出: {violations}"


def test_r18_sketch_kind_rejects_invalid_value(r10r16_config):
    violations = check_question_extended(_base_sketch_kind_question(sketch_kind="letter"), r10r16_config)
    assert any(v["rule"] == "R18" and "sketch_kind" in v["detail"] for v in violations), violations


def test_r18_sketch_kind_kanji_rejects_answer_kanji_leak_in_hint(r10r16_config):
    violations = check_question_extended(_base_sketch_kind_question(sketch_hint="『結ばれた』を指で書いてみよう"), r10r16_config)
    assert any(
        v["rule"] == "R18" and "答え漏洩" in v["detail"]
        for v in violations
    ), violations


def test_r18_sketch_kind_kanji_allows_answer_kanji_already_in_question_text(r10r16_config):
    q = _base_sketch_kind_question(
        question_text="「結ばれた」の読みを確認しよう。",
        sketch_hint="『結ばれた』を指で書いてみよう",
    )
    violations = check_question_extended(q, r10r16_config)
    r18_sketch = [v for v in violations if v["rule"] == "R18" and "sketch" in v["detail"]]
    assert r18_sketch == [], f"R18 sketch_kind 誤検出: {violations}"


def test_r18_sketch_kind_rejects_without_sketch_gate_true(r10r16_config):
    violations = check_question_extended(_base_sketch_kind_question(sketch_gate=False), r10r16_config)
    assert any(v["rule"] == "R18" and "sketch_gate" in v["detail"] for v in violations), violations
