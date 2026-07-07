#!/usr/bin/env python3
"""
scripts/validate_lesson_format.py

レッスン生成後の正解肢フォーマット品質チェックスクリプト。
generate-drill-lesson/reference/validation.md に定義されたNGパターン検出ルールを実装。

使い方:
  # JSON 入力モード
  python3 scripts/validate_lesson_format.py --json path/to/generated_lesson.json

終了コード:
  0 = 合格
  1 = 不合格（NG 問題あり）
"""

import argparse
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# ─────────────────────────────────────────────
# パス定数
# ─────────────────────────────────────────────

_SCRIPT_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _SCRIPT_DIR.parent
VALIDATION_MD_PATH = _PROJECT_ROOT / ".claude" / "skills" / "generate-drill-lesson" / "reference" / "validation.md"
FAILURES_DIR = _PROJECT_ROOT / "data" / "generation-failures"
CALC_LIST_DIR = _PROJECT_ROOT / "data" / "textbooks" / "curriculum" / "算数"
ALLOWED_TIER_PURPOSES = {
    "answer",
    "strategy",
    "formula",
    "diagram",
    "basis",
    "error_diagnosis",
    "evidence",
    "elimination_reason",
    "expression_effect",
}
ALLOWED_CHOICE_META_ROLES = {"correct", "distractor"}
PROCESS_TIER_PURPOSES = {
    "strategy",
    "formula",
    "diagram",
    "basis",
    "error_diagnosis",
    "evidence",
    "elimination_reason",
    "expression_effect",
}

# ─────────────────────────────────────────────
# validation.md から許容ユニット一覧を読み込む
# ─────────────────────────────────────────────

def load_allowed_units(md_path: Path) -> dict:
    """
    validation.md の §7 にある YAML ブロックをパースして
    long_answer_allowed_units と idiom_vocabulary_units を返す。
    ワイルドカード (dokkai-* 形式) は "prefix:" として扱う。
    """
    text = md_path.read_text(encoding="utf-8")

    # ```yaml ... ``` ブロックを抽出
    yaml_blocks = re.findall(r"```yaml\n(.*?)```", text, re.DOTALL)
    if not yaml_blocks:
        raise RuntimeError(f"validation.md に YAML ブロックが見つかりません: {md_path}")

    # 最初の YAML ブロックを使う（§7 のブロック）
    yaml_text = yaml_blocks[0]

    result = {"long_answer_allowed_units": [], "idiom_vocabulary_units": []}

    current_key = None
    for line in yaml_text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.endswith(":"):
            key = stripped[:-1]
            if key in result:
                current_key = key
            else:
                current_key = None
        elif stripped.startswith("- ") and current_key:
            value = stripped[2:].strip()
            # コメント (# 以降) を除去（YAML 行末コメント対応）
            if "#" in value:
                value = value.split("#", 1)[0].strip()
            if value:
                result[current_key].append(value)

    return result


def _unit_matches(unit_id: str, pattern: str) -> bool:
    """ユニットIDがパターンに一致するか（ワイルドカード対応）"""
    if pattern.endswith("*"):
        return unit_id.startswith(pattern[:-1])
    return unit_id == pattern


def is_long_answer_allowed(unit_id: str, allowed_units: dict) -> bool:
    return any(
        _unit_matches(unit_id, p)
        for p in allowed_units.get("long_answer_allowed_units", [])
    )


def is_idiom_vocabulary_unit(unit_id: str, allowed_units: dict) -> bool:
    return any(
        _unit_matches(unit_id, p)
        for p in allowed_units.get("idiom_vocabulary_units", [])
    )


# ─────────────────────────────────────────────
# NG パターン検出（コア）
# ─────────────────────────────────────────────

# 条件1: 式・公式記号
_RULE1_SYMBOLS = re.compile(r"[→=∪∩√]")

# 条件2: ・ が式記号として使用 → 「数字・数字」パターン以外の ・ が2個以上
_RULE2_NUMDOT = re.compile(r"\d・\d")  # 数字+・+数字 の許容パターン

# 条件4: 助詞
_PARTICLES = re.compile(r"[はがをにでの]")

# 数字（半角・全角）
_DIGIT = re.compile(r"[0-9０-９]")

# 条件5: 解法文の語尾パターン（これ単独では NG にしない）
_RULE5_ENDING = re.compile(r"(する|できる|なる|ない)$")

_OPTION_UNIT_SUFFIXES = (
    "cm²",
    "cm2",
    "平方cm",
    "m²",
    "m2",
    "平方m",
    "cm",
    "m",
    "°",
    "度",
    "個",
    "人",
    "枚",
    "円",
    "日",
    "時間",
    "分",
    "秒",
    "%",
    "％",
    "g",
    "kg",
    "L",
    "dL",
    "mL",
    "本",
    "台",
    "回",
    "倍",
)


def _normalize_option_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", str(text)).strip()
    return re.sub(r"[\s　]+", "", normalized)


def _answer_matches_option(answer: str, option: str) -> bool:
    """R0: 表示用の単位サフィックスだけは許容して answer と照合する。"""
    answer_norm = _normalize_option_text(answer)
    option_norm = _normalize_option_text(option)
    if option_norm == answer_norm:
        return True
    for suffix in _OPTION_UNIT_SUFFIXES:
        if option_norm.endswith(suffix) and option_norm[: -len(suffix)] == answer_norm:
            return True
    return False


def _count_particles(text: str) -> int:
    return len(_PARTICLES.findall(text))


def _has_digit(text: str) -> bool:
    return bool(_DIGIT.search(text))


def _count_nonnumeric_dots(text: str) -> int:
    """
    ・ の出現回数を数えるが、「数字・数字」パターンは除外した上でカウント。
    """
    # 「数字・数字」パターンを空白に置換してからカウント
    cleaned = _RULE2_NUMDOT.sub("A A", text)  # マッチ部分を無害な文字列に
    return cleaned.count("・")


def check_answer(
    answer: str,
    unit_id: str,
    options: list[str],
    allowed_units: dict,
) -> list[dict]:
    """
    answer フィールドを検査して違反リストを返す。
    空リスト = OK。

    Returns:
        list of {"rule": int, "detail": str}
    """
    violations = []
    rule5_evidence = None

    # ─── 条件0: hints[0] と answer の厳密一致（最優先） ───────────────────────
    # 参照: question-rules.md §4「hints[0] と answer は一致」
    # 現フロントは choice.isCorrect で採点するため、表示用の単位サフィックスは許容する。
    if options and not _answer_matches_option(answer, options[0]):
        h0_preview = options[0][:40] + "..." if len(options[0]) > 40 else options[0]
        ans_preview = answer[:40] + "..." if len(answer) > 40 else answer
        violations.append({
            "rule": 0,
            "detail": f"hints[0]='{h0_preview}' が answer='{ans_preview}' と不一致（フロント採点バグ直結）",
        })
        return violations  # 条件0単独でNGのため他の条件チェックをスキップ

    # ─── 条件1: 式・公式記号 ───────────────────────
    m1 = _RULE1_SYMBOLS.search(answer)
    if m1:
        violations.append({"rule": 1, "detail": f"式記号 '{m1.group()}' を含む"})

    # ─── 条件2: ・ の式記号使用 ────────────────────
    nonnumeric_dots = _count_nonnumeric_dots(answer)
    if nonnumeric_dots >= 3:
        violations.append({"rule": 2, "detail": f"非数字区切りの '・' が {nonnumeric_dots} 個"})

    # ─── 条件3: 文字数 ─────────────────────────────
    char_limit = 60 if is_long_answer_allowed(unit_id, allowed_units) else 20
    if len(answer) >= char_limit:
        violations.append({"rule": 3, "detail": f"文字数 {len(answer)} >= 上限 {char_limit}"})

    # ─── 条件4: 助詞 + 数字なし ────────────────────
    particle_threshold = 5 if (is_idiom_vocabulary_unit(unit_id, allowed_units) or is_long_answer_allowed(unit_id, allowed_units)) else 3
    particle_count = _count_particles(answer)
    if particle_count > particle_threshold and not _has_digit(answer):
        violations.append({
            "rule": 4,
            "detail": f"助詞 {particle_count} 個 > 閾値 {particle_threshold}、かつ数字なし",
        })

    # ─── 条件5: 追加証拠（単独 NG にしない） ───────
    if options and len(options) >= 2:
        other_options = [o for o in options if o != answer]
        if other_options:
            avg_other_len = sum(len(o) for o in other_options) / len(other_options)
            if avg_other_len > 0:
                ratio = len(answer) / avg_other_len
                ends_with_verb = bool(_RULE5_ENDING.search(answer))
                if not ends_with_verb and (ratio < 0.5 or ratio > 2.0):
                    rule5_evidence = {"rule": 5, "detail": f"長さ比 {ratio:.2f} (他平均 {avg_other_len:.1f} 字)"}

    # 条件5 は 1-4 のどれかが NG のときのみ追加
    if rule5_evidence and violations:
        violations.append(rule5_evidence)

    return violations


# ─────────────────────────────────────────────
# レッスン JSON の検証
# ─────────────────────────────────────────────

def validate_questions(questions: list[dict], allowed_units: dict) -> list[dict]:
    """
    問題リストを検証。NG のレコードリストを返す。
    """
    ng_records = []
    for q in questions:
        answer = q.get("answer", "")
        unit_id = q.get("unit_id") or ""
        q_type = q.get("question_type", "single_tier")
        options_raw = q.get("options") or q.get("hints") or []
        # options が JSON 文字列の場合はパース
        if isinstance(options_raw, str):
            try:
                options_raw = json.loads(options_raw)
            except json.JSONDecodeError:
                options_raw = []

        # R0-R5 は旧 single_tier の「hints[0] が answer と一致する」前提の検査。
        # two_tier/evidence_first は tier ごとの正解テキスト、slot_* は picker 入力値で
        # 採点するため、ここで answer/hints[0] 一致を強制しない。
        violations = []
        if q_type in (None, "", "single_tier") or str(q_type).startswith("slot_"):
            violations = check_answer(answer, unit_id, options_raw, allowed_units)
        if violations:
            ng_records.append({
                "lesson_id": q.get("lesson_id", ""),
                "position": q.get("position", "?"),
                "unit_id": unit_id,
                "answer": answer,
                "violated_rules": violations,
            })
    return ng_records


def load_r10r16_config(md_path: Path) -> dict:
    """
    validation.md の §8 にある YAML ブロック（2番目）をパースして
    r13_warmup_exception_units と r16_wu_lesson_title_keywords を返す。
    """
    text = md_path.read_text(encoding="utf-8")
    yaml_blocks = re.findall(r"```yaml\n(.*?)```", text, re.DOTALL)
    if len(yaml_blocks) < 2:
        return {
            "r13_warmup_exception_units": ["sk-kanji", "bunbo-kasan", "bunsuu-kasan"],
            "r16_wu_lesson_title_keywords": ["WU", "前日", "軽復習"],
        }
    yaml_text = yaml_blocks[1]
    result = {"r13_warmup_exception_units": [], "r16_wu_lesson_title_keywords": []}
    current_key = None
    for line in yaml_text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.endswith(":"):
            key = stripped[:-1]
            if key in result:
                current_key = key
            else:
                current_key = None
        elif stripped.startswith("- ") and current_key:
            result[current_key].append(stripped[2:].strip())
    return result


def _parse_list_field(value) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []
    return []


def _question_id_for_validation(lesson_id: str, q: dict) -> str | None:
    qid = q.get("id")
    if isinstance(qid, str) and qid:
        return qid
    pos = q.get("position")
    if isinstance(pos, int):
        return f"q-{lesson_id}-{pos:02d}"
    if isinstance(pos, str) and pos.isdigit():
        return f"q-{lesson_id}-{int(pos):02d}"
    return None


def validate_remediation_and_blocks(lesson: dict) -> list[dict]:
    violations = []
    lesson_id = lesson.get("id") or lesson.get("lesson_id") or ""
    questions = lesson.get("questions") if isinstance(lesson.get("questions"), list) else []
    question_ids = {
        qid
        for q in questions
        if isinstance(q, dict)
        for qid in [_question_id_for_validation(lesson_id, q)]
        if qid
    }

    for q in questions:
        if not isinstance(q, dict):
            continue
        remediation = q.get("remediation")
        if remediation in (None, ""):
            continue
        if not isinstance(remediation, dict):
            violations.append({
                "rule": "R20",
                "level": "reject",
                "detail": "remediation は object または null",
                "lesson_id": lesson_id,
                "position": q.get("position", "?"),
                "unit_id": q.get("unit_id", "") or "",
                "answer": q.get("answer", ""),
            })
            continue
        for key in ("same_skill_question_id", "transfer_question_id"):
            target = remediation.get(key)
            if target is not None and (not isinstance(target, str) or target not in question_ids):
                violations.append({
                    "rule": "R20",
                    "level": "reject",
                    "detail": f"remediation.{key} が同一 lesson 内の question id ではない: {target!r}",
                    "lesson_id": lesson_id,
                    "position": q.get("position", "?"),
                    "unit_id": q.get("unit_id", "") or "",
                    "answer": q.get("answer", ""),
                })
        for key in ("micro_explanation", "pattern_id"):
            value = remediation.get(key)
            if value is not None and not isinstance(value, str):
                violations.append({
                    "rule": "R20",
                    "level": "reject",
                    "detail": f"remediation.{key} は string",
                    "lesson_id": lesson_id,
                    "position": q.get("position", "?"),
                    "unit_id": q.get("unit_id", "") or "",
                    "answer": q.get("answer", ""),
                })

    blocks = lesson.get("blocks")
    if blocks in (None, ""):
        return violations
    if not isinstance(blocks, list):
        return violations + [{
            "rule": "R21",
            "level": "reject",
            "detail": "blocks は配列",
            "lesson_id": lesson_id,
            "position": "?",
            "unit_id": "",
            "answer": "",
        }]
    allowed_kinds = {"review", "main", "spiral", "exam", "confidence"}
    allowed_block_types = {
        "warmup",
        "core",
        "weakness_spiral",
        "exam_transfer",
        "confidence_recovery",
        "optional_extra",
    }
    seen_blocks = set()
    for block in blocks:
        if not isinstance(block, dict):
            violations.append({"rule": "R21", "level": "reject", "detail": "block は object", "lesson_id": lesson_id, "position": "?", "unit_id": "", "answer": ""})
            continue
        block_id = block.get("id")
        if not isinstance(block_id, str) or not block_id:
            violations.append({"rule": "R21", "level": "reject", "detail": "block.id は必須 string", "lesson_id": lesson_id, "position": "?", "unit_id": "", "answer": ""})
        elif block_id in seen_blocks:
            violations.append({"rule": "R21", "level": "reject", "detail": f"block.id 重複: {block_id}", "lesson_id": lesson_id, "position": "?", "unit_id": "", "answer": ""})
        seen_blocks.add(block_id)
        kind = block.get("kind")
        block_type = block.get("block_type")
        if kind is not None and kind not in allowed_kinds:
            violations.append({"rule": "R21", "level": "reject", "detail": f"block.kind が不正: {kind!r}", "lesson_id": lesson_id, "position": "?", "unit_id": "", "answer": ""})
        if block_type is not None and block_type not in allowed_block_types:
            violations.append({"rule": "R21", "level": "reject", "detail": f"block.block_type が不正: {block_type!r}", "lesson_id": lesson_id, "position": "?", "unit_id": "", "answer": ""})
        if kind is None and block_type is None:
            violations.append({"rule": "R21", "level": "reject", "detail": "block.kind または block.block_type は必須", "lesson_id": lesson_id, "position": "?", "unit_id": "", "answer": ""})
        if "optional_extra" in block and not isinstance(block.get("optional_extra"), bool):
            violations.append({"rule": "R21", "level": "reject", "detail": "block.optional_extra は boolean", "lesson_id": lesson_id, "position": "?", "unit_id": "", "answer": ""})
        question_refs = block.get("question_ids")
        if not isinstance(question_refs, list) or not question_refs:
            violations.append({"rule": "R21", "level": "reject", "detail": "block.question_ids は空でない配列", "lesson_id": lesson_id, "position": "?", "unit_id": "", "answer": ""})
        else:
            for qid in question_refs:
                if not isinstance(qid, str) or qid not in question_ids:
                    violations.append({"rule": "R21", "level": "reject", "detail": f"block.question_ids に存在しない id: {qid!r}", "lesson_id": lesson_id, "position": "?", "unit_id": "", "answer": ""})
    return violations


def _to_float_or_none(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _is_truthy(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes", "y", "on"}
    return False


def _is_int_string(value: str) -> bool:
    return bool(re.fullmatch(r"-?\d+", str(value).strip()))


def _compact_slot_value(value) -> str:
    return re.sub(r"[\s　]+", "", str(value or "")).strip()


def _strip_fixed_unit(value: str, unit: str | None) -> str:
    compact = _compact_slot_value(value)
    compact_unit = _compact_slot_value(unit)
    if compact_unit and compact.endswith(compact_unit):
        return compact[: -len(compact_unit)]
    return compact


def _decimal_options(config: dict) -> set[str]:
    ds = str(config.get("digit_string", ""))
    options = set()
    for pos in config.get("valid_positions", []) or []:
        if isinstance(pos, int) and 0 < pos < len(ds):
            options.add(f"{ds[:pos]}.{ds[pos:]}")
    return options


def _slot_option_count(config: dict) -> int:
    c_type = config.get("type")
    if c_type == "number":
        digits = config.get("digits")
        return 10 ** digits if isinstance(digits, int) and digits > 0 else 0
    if c_type == "decimal":
        return len(_decimal_options(config))
    if c_type == "unit":
        unit_options = config.get("unit_options")
        return len(unit_options) if isinstance(unit_options, list) else 0
    if c_type == "kanji":
        left = config.get("left_options")
        right = config.get("right_options")
        if isinstance(left, list) and isinstance(right, list):
            return len(left) * len(right)
        return 0
    if c_type == "okurigana":
        options = config.get("options")
        return len(options) if isinstance(options, list) else 0
    return 0


def _is_answer_only_hint(value) -> bool:
    text = unicodedata.normalize("NFKC", str(value or "")).strip()
    if not text:
        return False
    compact = re.sub(r"[\s　,，]+", "", text)
    unit_suffixes = "|".join(re.escape(s) for s in _OPTION_UNIT_SUFFIXES)
    number = r"-?(?:\d+(?:\.\d+)?|\d+/\d+)"
    return bool(re.fullmatch(rf"{number}(?:{unit_suffixes})?", compact))


def _is_answer_only_choice(question: dict, hints: list) -> bool:
    if _is_answer_only_hint(hints[0] if hints else question.get("answer")):
        return True
    q_type = question.get("question_type", "single_tier") or "single_tier"
    answer = str(question.get("answer") or "").strip()
    return (
        q_type == "single_tier"
        and bool(answer)
        and bool(hints)
        and str(hints[0]).strip() == answer
    )


def _solution_step_count(value) -> int:
    if isinstance(value, list):
        return len([item for item in value if str(item).strip()])
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return 0
        for delimiter in ("\n", "。", "；", ";"):
            parts = [part.strip() for part in stripped.split(delimiter) if part.strip()]
            if len(parts) > 1:
                return len(parts)
        return 1
    return 0


def _has_process_tier_purpose(question: dict) -> bool:
    return any(question.get(key) in PROCESS_TIER_PURPOSES for key in ("tier1_purpose", "tier2_purpose"))


def _process_gate_exempt_reason(question: dict) -> str:
    meta = question.get("meta")
    if not isinstance(meta, dict):
        return ""
    reason = meta.get("process_gate_exempt_reason")
    return reason.strip() if isinstance(reason, str) else ""


def _has_process_understanding_path(question: dict) -> bool:
    q_type = question.get("question_type", "single_tier") or "single_tier"
    if q_type == "single_tier":
        return question.get("tier1_purpose") in PROCESS_TIER_PURPOSES
    if q_type in {"two_tier", "evidence_first"}:
        return _has_process_tier_purpose(question)
    if q_type == "slot_two_tier":
        if _has_process_tier_purpose(question):
            return True
        slot_config = question.get("slot_config")
        if not isinstance(slot_config, dict):
            return False
        return any(
            isinstance(slot_config.get(tier), dict)
            and slot_config[tier].get("purpose") in PROCESS_TIER_PURPOSES
            for tier in ("tier1", "tier2")
        )
    return False


def _choice_meta_violations(question: dict) -> list[dict]:
    choice_meta = question.get("choice_meta")
    if choice_meta is None:
        return []
    if not isinstance(choice_meta, list):
        return [{
            "rule": "R23",
            "level": "reject",
            "detail": "choice_meta が配列ではない",
        }]

    violations = []
    for idx, meta in enumerate(choice_meta):
        path = f"choice_meta[{idx}]"
        if not isinstance(meta, dict):
            violations.append({
                "rule": "R23",
                "level": "reject",
                "detail": f"{path} が object ではない",
            })
            continue
        choice_text = meta.get("choice_text")
        role = meta.get("role")
        purpose = meta.get("purpose")
        step = meta.get("step")
        misconception_tag = meta.get("misconception_tag")
        if not isinstance(choice_text, str) or not choice_text.strip():
            violations.append({
                "rule": "R23",
                "level": "reject",
                "detail": f"{path}.choice_text が空、または string ではない",
            })
        if role not in ALLOWED_CHOICE_META_ROLES:
            violations.append({
                "rule": "R23",
                "level": "reject",
                "detail": f"{path}.role が不正: {role!r} (期待: correct/distractor)",
            })
        if purpose is not None and purpose not in ALLOWED_TIER_PURPOSES:
            violations.append({
                "rule": "R23",
                "level": "reject",
                "detail": (
                    f"{path}.purpose が不正: {purpose!r} "
                    f"(期待: {', '.join(sorted(ALLOWED_TIER_PURPOSES))})"
                ),
            })
        if step is not None and (not isinstance(step, int) or step < 1):
            violations.append({
                "rule": "R23",
                "level": "reject",
                "detail": f"{path}.step が不正: {step!r} (期待: 1以上の整数)",
            })
        if misconception_tag is not None and not isinstance(misconception_tag, str):
            violations.append({
                "rule": "R23",
                "level": "reject",
                "detail": f"{path}.misconception_tag が string ではない",
            })
    return violations


def _slot_config_violations(q_type: str, config: dict, correct_value: str, path: str) -> list[dict]:
    """R19: SlotPicker で実際に入力可能な slot_config か検証する。"""
    violations = []
    if not isinstance(config, dict):
        return [{
            "rule": "R19",
            "level": "reject",
            "detail": f"{path}: slot_config が object ではない",
        }]

    c_type = config.get("type")

    def reject(detail: str) -> None:
        violations.append({"rule": "R19", "level": "reject", "detail": f"{path}: {detail}"})

    if c_type == "number":
        digits = config.get("digits")
        comparable_correct_value = _strip_fixed_unit(correct_value, config.get("unit"))
        if not isinstance(digits, int) or digits <= 0:
            reject("type=number だが digits が 1以上の整数ではない")
        if not _is_int_string(comparable_correct_value):
            reject(f"type=number は整数しか入力できないが correct_value={correct_value!r}。小数は slot_decimal を使う")
        elif isinstance(digits, int) and len(str(abs(int(comparable_correct_value)))) > digits:
            reject(f"type=number の digits={digits} では correct_value={correct_value!r} を入力できない")

    elif c_type == "decimal":
        ds = config.get("digit_string")
        valid_positions = config.get("valid_positions")
        if not isinstance(ds, str) or not ds.isdigit():
            reject("type=decimal だが digit_string が数字列ではない")
        if not isinstance(valid_positions, list) or not all(isinstance(p, int) for p in valid_positions):
            reject("type=decimal だが valid_positions が整数配列ではない")
        elif isinstance(ds, str) and not all(0 < p < len(ds) for p in valid_positions):
            reject("type=decimal の valid_positions は 1..len(digit_string)-1 の範囲に限る")
        elif correct_value not in _decimal_options(config):
            reject(f"type=decimal の valid_positions では correct_value={correct_value!r} を作れない")

    elif c_type == "unit":
        fixed_value = config.get("fixed_value")
        unit_options = config.get("unit_options")
        if not isinstance(fixed_value, str):
            reject("type=unit だが fixed_value が string ではない")
        if not isinstance(unit_options, list) or not all(isinstance(u, str) for u in unit_options):
            reject("type=unit だが unit_options が string 配列ではない")
        elif isinstance(fixed_value, str) and correct_value not in {f"{fixed_value}{u}" for u in unit_options}:
            reject(f"type=unit の unit_options では correct_value={correct_value!r} を作れない")

    elif c_type == "kanji":
        left = config.get("left_options")
        right = config.get("right_options")
        if not isinstance(left, list) or not all(isinstance(x, str) for x in left):
            reject("type=kanji だが left_options が string 配列ではない")
        elif any(not x.strip() for x in left):
            reject("type=kanji の left_options に空文字は使えない")
        if not isinstance(right, list) or not all(isinstance(x, str) for x in right):
            reject("type=kanji だが right_options が string 配列ではない")
        elif any(not x.strip() for x in right):
            reject("type=kanji の right_options に空文字は使えない")
        if isinstance(left, list) and isinstance(right, list):
            composed = {f"{l}{r}" for l in left for r in right}
            if correct_value not in composed:
                reject(f"type=kanji の left/right options では correct_value={correct_value!r} を作れない")

    elif c_type == "okurigana":
        kanji = config.get("kanji")
        options = config.get("options")
        if not isinstance(kanji, str):
            reject("type=okurigana だが kanji が string ではない")
        if not isinstance(options, list) or not all(isinstance(x, str) for x in options):
            reject("type=okurigana だが options が string 配列ではない")
        elif isinstance(kanji, str) and correct_value not in {f"{kanji}{o}" for o in options}:
            reject(f"type=okurigana の options では correct_value={correct_value!r} を作れない")

    else:
        reject(f"slot_config.type が不正: {c_type!r}")

    option_count = _slot_option_count(config)
    if option_count < 2:
        reject(f"入力候補が {option_count} 個しかない。1択スロットは答えを表示してしまうため禁止")

    expected_config_type = {
        "slot_number": "number",
        "slot_decimal": "decimal",
        "slot_kanji": "kanji",
        "slot_okurigana": "okurigana",
    }.get(q_type)
    if expected_config_type and c_type != expected_config_type:
        reject(f"question_type={q_type!r} と slot_config.type={c_type!r} が不一致")

    return violations


def _is_math_question(q: dict) -> bool:
    uid = q.get("unit_id", "") or ""
    lid = q.get("lesson_id", "") or ""
    return lid.startswith("lesson-m-") or uid.startswith("math_") or uid.startswith("m-")


def _is_geometry_math_question(question: dict) -> bool:
    """算数の図形問題を広めに検出する。

    R12 回避のために「図のように」等を消しても、図形単元なら SVG 必須にする。
    """
    if not _is_math_question(question):
        return False
    unit_id = str(question.get("unit_id", "") or "")
    text = " ".join(
        str(part or "")
        for part in (
            unit_id,
            question.get("question_text", ""),
            " ".join(_parse_list_field(question.get("solution_steps") or [])),
            " ".join(_parse_list_field(question.get("common_mistakes") or [])),
        )
    )
    geometry_unit_markers = (
        "kakudo",
        "tamen",
        "zukei",
        "baibun-ouyou",
        "kiseki",
        "gyakuzan",
    )
    # 注意: 「円」単独は通貨（80円・240円など金額問題）と衝突し、消去算・差集め算で
    # R12 を誤発火させる（2026-06-06 検出）。図形としての円は「円周」「半円」「中心角」
    # 「半径」「直径」「おうぎ形」で十分検出できるため、通貨衝突する「円」単独は使わない。
    geometry_text_markers = (
        "円周",
        "おうぎ形",
        "扇形",
        "半円",
        "弧",
        "中心角",
        "半径",
        "直径",
        "三角形",
        "四角形",
        "長方形",
        "正方形",
        "台形",
        "平行四辺形",
        "多角形",
        "角度",
        "面積",
        "等積",
        "複合図形",
        "軌跡",
        "図形の移動",
    )
    return any(marker in unit_id for marker in geometry_unit_markers) or any(
        marker in text for marker in geometry_text_markers
    )


def _is_japanese_question(q: dict) -> bool:
    uid = q.get("unit_id", "") or ""
    lid = q.get("lesson_id", "") or ""
    return lid.startswith("lesson-j-") or uid.startswith("japanese_") or uid.startswith("j-") or uid.startswith("sk-")


def _is_japanese_weak_reading_question(q: dict) -> bool:
    uid = str(q.get("unit_id", "") or "")
    q_type = q.get("question_type", "single_tier") or "single_tier"
    if str(q_type).startswith("slot_"):
        return False
    weak_reading_markers = (
        "hitei",
        "naiyou",
        "inga",
        "shinjyou",
        "shinjo",
        "seikaku",
        "kijutsu",
        "kansetsu",
        "hyougen",
        "hyogen",
        "dokkai",
        "youshi",
        "youyaku",
    )
    if any(marker in uid for marker in weak_reading_markers):
        return True
    meta = q.get("meta")
    if isinstance(meta, dict):
        pattern = str(meta.get("pattern_id") or meta.get("weakness_pattern") or "")
        return any(marker in pattern for marker in weak_reading_markers)
    return False


def _normalize_qtext(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "")
    text = re.sub(r"[、。，．「」『』【】（）()〔〕\[\]{}・…ー〜～]", "", text)
    text = re.sub(r"[\s　]+", "", text)
    text = re.sub(r"[\U0001F300-\U0001FFFF]", "", text)
    return text.lower().strip()


def check_question_extended(question: dict, r10r16_config: dict, strict_process_gate: bool = False) -> list[dict]:
    _ = strict_process_gate
    violations = []
    hints = _parse_list_field(question.get("hints") or question.get("options") or [])
    question_text = question.get("question_text", "") or ""

    if _is_math_question(question):
        answer_val = _to_float_or_none(question.get("answer"))
        matched_indices = []
        if answer_val is not None and abs(answer_val) > 0.001:
            for idx in (1, 2):
                if idx >= len(hints):
                    continue
                hint_val = _to_float_or_none(hints[idx])
                if hint_val is None:
                    continue
                if (
                    abs(hint_val - answer_val * 0.5) < 0.001
                    or abs(hint_val - answer_val * 2.0) < 0.001
                    or abs(hint_val - answer_val * 0.1) < 0.001
                    or abs(hint_val - answer_val * 10.0) < 0.001
                    or (answer_val != 0 and abs(hint_val - (-answer_val)) < 0.001)
                ):
                    matched_indices.append(idx)
        if len(matched_indices) == 1:
            violations.append({
                "rule": "R10",
                "level": "warn",
                "detail": f"distractor が機械テンプレ比率に一致: hints[{matched_indices[0]}]",
            })
        elif len(matched_indices) >= 2:
            violations.append({
                "rule": "R10",
                "level": "reject",
                "detail": f"distractor が機械テンプレ比率に複数一致: {matched_indices}",
            })

    figure_svg = question.get("figure_svg") or ""
    has_svg = bool(figure_svg) and len(figure_svg.strip()) >= 10

    if _is_truthy(question.get("is_figure")) and not has_svg:
        violations.append({
            "rule": "R12",
            "level": "reject",
            "detail": "is_figure=true だが figure_svg が無い",
        })

    if _is_geometry_math_question(question) and not has_svg:
        violations.append({
            "rule": "R12",
            "level": "reject",
            "detail": "算数の図形問題だが figure_svg が無い。SVG 回避目的の文章完結化は禁止",
        })

    r12_figure_required_words = [
        "補助線", "対角線", "等積変形",
        "図のように", "次の図", "上の図", "下の図", "以下の図", "図1", "図2",
        "内部に", "内側に", "外側に",
        "影の部分", "影の三角形", "斜線部分", "斜線の部分",
        "色のついた部分", "色をつけた部分",
        "切り抜く", "切り抜いた", "切り取った", "切りとった",
        "重ねた", "重なった", "重なり", "重ねると",
        "点P", "点Q", "点M", "点N", "角ア", "角イ", "角ウ", "角エ", "角オ",
    ]
    r12_dimension_words = [
        "縦", "横", "1辺", "底辺", "高さ", "上底", "下底",
        "半径", "直径", "対角線の長さ",
    ]
    if _is_math_question(question) and not has_svg:
        for needle in r12_figure_required_words:
            if needle in question_text:
                has_dimension = any(d in question_text for d in r12_dimension_words)
                # 「△ABC型頂点ラベルのみ + 寸法あり」の例外パスは別途
                violations.append({
                    "rule": "R12",
                    "level": "reject",
                    "detail": f"figure_svg null かつ figure-required-word を含む: '{needle}'",
                })
                break
        else:
            # ABCD型頂点ラベル（3文字以上連続英大文字）検出
            if re.search(r"[A-Z]{3,}", question_text):
                has_dimension = any(d in question_text for d in r12_dimension_words)
                if not has_dimension:
                    violations.append({
                        "rule": "R12",
                        "level": "reject",
                        "detail": "figure_svg null かつ ABCD型頂点ラベル + 寸法欠落",
                    })

    r14_substrings = [
        "代表例の答え",
        "代表例。",
        "。。",
        "□cm",
        "□度",
        "□人",
        "□個",
        "□枚",
        "与えられている",
        "省略",
        "〜略〜",
        "{{",
        "}}",
        "___",
        "または",
        "あるいは",
    ]
    for needle in r14_substrings:
        if needle in question_text:
            violations.append({
                "rule": "R14",
                "level": "reject",
                "detail": f"問題文崩壊パターンを含む: {needle}",
            })
            break
    else:
        if re.search(r"（そのまま.*?か？）", question_text):
            violations.append({
                "rule": "R14",
                "level": "reject",
                "detail": "問題文崩壊パターンを含む: （そのまま.*?か？）",
            })

    exact_dummy_choices = {
        "△場合による",
        "△",
        "△不明",
        "わからない",
        "分からない",
        "その他",
        "特になし",
        "なし",
        "場合により異なる",
    }
    found_r15 = False
    for hint in hints:
        expanded = [hint]
        if isinstance(hint, str):
            stripped = hint.strip()
            try:
                parsed = json.loads(stripped)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, list):
                expanded = parsed
            elif isinstance(parsed, str):
                expanded = [parsed]
            else:
                expanded = [hint]
        for item in expanded:
            text = str(item).strip()
            if text in exact_dummy_choices or "〜の場合" in text:
                violations.append({
                    "rule": "R15",
                    "level": "reject",
                    "detail": f"ダミー選択肢を含む: {text}",
                })
                found_r15 = True
                break
        if found_r15:
            break

    # ─── R17: 志望校同型 consistency ─────────────────────
    meta = question.get("meta") or {}
    target_anchor = meta.get("target_anchor")
    match_type = meta.get("match_type")
    difficulty_from_anchor = meta.get("difficulty_from_anchor")
    q_difficulty = question.get("difficulty") or ""

    if target_anchor is not None:
        valid_match_types = {"exact", "adjacent", "none"}
        valid_difficulties = {"d2", "d3", "d4", "d5"}

        if not isinstance(target_anchor, str):
            violations.append({
                "rule": "R17",
                "level": "reject",
                "detail": "meta.target_anchor が string ではない",
            })
        if match_type not in valid_match_types:
            violations.append({
                "rule": "R17",
                "level": "reject",
                "detail": f"meta.match_type が不正: {match_type!r} (期待: exact/adjacent/none)",
            })
        if difficulty_from_anchor not in valid_difficulties:
            violations.append({
                "rule": "R17",
                "level": "reject",
                "detail": f"meta.difficulty_from_anchor が不正: {difficulty_from_anchor!r} (期待: d2/d3/d4/d5)",
            })
        if match_type == "none" and target_anchor != "none":
            violations.append({
                "rule": "R17",
                "level": "reject",
                "detail": f"match_type=none のとき target_anchor は 'none' であるべき (実際: {target_anchor!r})",
            })
        if (
            difficulty_from_anchor in valid_difficulties
            and q_difficulty
            and difficulty_from_anchor != q_difficulty
        ):
            violations.append({
                "rule": "R17",
                "level": "reject",
                "detail": (
                    f"meta.difficulty_from_anchor={difficulty_from_anchor!r} と "
                    f"問題の difficulty={q_difficulty!r} が不一致"
                ),
            })

    # ─── R18: step フィールド検証 ────────────────────────
    _SINGLE_STEP_TYPES = {
        "single_tier", "slot_number", "slot_kanji",
        "slot_decimal", "slot_okurigana",
    }
    _TWO_TIER_TYPES = {"two_tier", "evidence_first"}

    q_type = question.get("question_type", "single_tier")
    step = question.get("step")
    step_label = question.get("step_label")
    valid_step_labels = {"single", "tier1", "tier2", "slot1", "slot2"}

    for purpose_key in ("tier1_purpose", "tier2_purpose"):
        purpose = question.get(purpose_key)
        if purpose is not None and purpose not in ALLOWED_TIER_PURPOSES:
            violations.append({
                "rule": "R18",
                "level": "reject",
                "detail": (
                    f"{purpose_key} が不正: {purpose!r} "
                    f"(期待: {', '.join(sorted(ALLOWED_TIER_PURPOSES))})"
                ),
            })

    violations.extend(_choice_meta_violations(question))

    # スケッチゲート (2026-06-11): 型のみ検証（採点に影響しない advisory フィールド）
    sketch_gate = question.get("sketch_gate")
    if sketch_gate is not None and not isinstance(sketch_gate, bool):
        violations.append({
            "rule": "R18",
            "level": "reject",
            "detail": f"sketch_gate は boolean (実際: {sketch_gate!r})",
        })
    sketch_hint = question.get("sketch_hint")
    if sketch_hint is not None and not isinstance(sketch_hint, str):
        violations.append({
            "rule": "R18",
            "level": "reject",
            "detail": f"sketch_hint は string (実際: {sketch_hint!r})",
        })


    sketch_kind = question.get("sketch_kind")
    if sketch_kind is not None:
        if sketch_kind not in {"figure", "kanji"}:
            violations.append({
                "rule": "R18",
                "level": "reject",
                "detail": f"sketch_kind が不正: {sketch_kind!r} (期待: figure/kanji)",
            })
        if sketch_gate is not True:
            violations.append({
                "rule": "R18",
                "level": "reject",
                "detail": "sketch_kind がある場合は sketch_gate=true 必須",
            })
        if sketch_kind == "kanji":
            hint_text = sketch_hint if isinstance(sketch_hint, str) else ""
            question_kanji = set(re.findall(r"[\u4E00-\u9FFF]", question_text))
            for ch in re.findall(r"[\u4E00-\u9FFF]", str(question.get("answer", ""))):
                if ch not in question_kanji and ch in hint_text:
                    violations.append({
                        "rule": "R18",
                        "level": "reject",
                        "detail": f"sketch_hint に問題文未出の正解漢字が含まれる（答え漏洩）: {ch}",
                    })
                    break

    if step is not None and (not isinstance(step, int) or step < 1):
        violations.append({
            "rule": "R18",
            "level": "reject",
            "detail": f"step が不正: {step!r} (期待: 1以上の整数)",
        })
    if step_label is not None and step_label not in valid_step_labels:
        violations.append({
            "rule": "R18",
            "level": "reject",
            "detail": f"step_label が不正: {step_label!r} (期待: single/tier1/tier2/slot1/slot2)",
        })

    if q_type in _SINGLE_STEP_TYPES:
        if step is not None and step != 1:
            violations.append({
                "rule": "R18",
                "level": "reject",
                "detail": f"question_type={q_type!r}: 単一 step 問題の step は 1 固定 (実際: {step!r})",
            })
        if step_label is not None and step_label != "single":
            violations.append({
                "rule": "R18",
                "level": "reject",
                "detail": f"question_type={q_type!r}: 単一 step 問題の step_label は 'single' 固定 (実際: {step_label!r})",
            })
    elif q_type in _TWO_TIER_TYPES or q_type == "slot_two_tier":
        if step is not None or step_label is not None:
            violations.append({
                "rule": "R18",
                "level": "reject",
                "detail": (
                    f"question_type={q_type!r}: multi-step の step/step_label は "
                    "answer ログで runtime 付与するため、問題 JSON には持たせない"
                ),
            })

    if q_type in _TWO_TIER_TYPES:
        # tier 構造: hints は [tier1プロセス選択肢 x3, tier2最終答え選択肢 x3]
        hints_count = len(hints) if hints else 0
        tier2_correct_index = question.get("tier2_correct_index")
        tier1_label = question.get("tier1_label")
        tier1_purpose = question.get("tier1_purpose")
        tier2_label = question.get("tier2_label")
        tier2_purpose = question.get("tier2_purpose")
        if hints_count != 6:
            violations.append({
                "rule": "R18",
                "level": "reject",
                "detail": (
                    f"question_type={q_type!r}: hints は 6 個 "
                    "(tier1プロセス選択肢3 + tier2最終答え選択肢3) 必要 "
                    f"(実際: {hints_count} 個)"
                ),
            })
        if not tier1_label:
            violations.append({
                "rule": "R18",
                "level": "reject",
                "detail": f"question_type={q_type!r}: tier1_label が空/None",
            })
        elif tier1_label == "答えを選ぼう":
            violations.append({
                "rule": "R18",
                "level": "reject",
                "detail": f"question_type={q_type!r}: tier1_label は Step1 プロセス目的を表す必要がある",
            })
        if tier1_purpose not in PROCESS_TIER_PURPOSES:
            violations.append({
                "rule": "R18",
                "level": "reject",
                "detail": (
                    f"question_type={q_type!r}: tier1_purpose はプロセス目的必須 "
                    f"(実際: {tier1_purpose!r})"
                ),
            })
        if tier2_correct_index != 3:
            violations.append({
                "rule": "R18",
                "level": "reject",
                "detail": f"question_type={q_type!r}: tier2_correct_index は 3 固定 (実際: {tier2_correct_index!r})",
            })
        if not tier2_label:
            violations.append({
                "rule": "R18",
                "level": "reject",
                "detail": f"question_type={q_type!r}: tier2_label が空/None",
            })
        if tier2_purpose != "answer":
            violations.append({
                "rule": "R18",
                "level": "reject",
                "detail": f"question_type={q_type!r}: tier2_purpose は 'answer' 固定 (実際: {tier2_purpose!r})",
            })
        if hints_count == 6 and not _answer_matches_option(str(question.get("answer", "")), str(hints[3])):
            violations.append({
                "rule": "R18",
                "level": "reject",
                "detail": (
                    f"question_type={q_type!r}: tier2 正解 hints[3] が answer と不一致 "
                    f"(answer={question.get('answer')!r}, hints[3]={hints[3]!r})"
                ),
            })

    elif q_type == "slot_two_tier":
        # slot_config に tier1 と tier2 が両方あり、各 tier に correct_value が必要
        slot_config = question.get("slot_config") or {}
        tier1 = slot_config.get("tier1")
        tier2 = slot_config.get("tier2")
        if not tier1:
            violations.append({
                "rule": "R18",
                "level": "reject",
                "detail": "question_type=slot_two_tier: slot_config.tier1 が無い",
            })
        elif not isinstance(tier1.get("correct_value"), str):
            violations.append({
                "rule": "R18",
                "level": "reject",
                "detail": "question_type=slot_two_tier: slot_config.tier1.correct_value が無い",
            })
        if not tier2:
            violations.append({
                "rule": "R18",
                "level": "reject",
                "detail": "question_type=slot_two_tier: slot_config.tier2 が無い",
            })
        elif not isinstance(tier2.get("correct_value"), str):
            violations.append({
                "rule": "R18",
                "level": "reject",
                "detail": "question_type=slot_two_tier: slot_config.tier2.correct_value が無い",
            })

    # ─── R19: slot_config 入力可能性検証 ─────────────────
    # 実際の SlotPicker で正解値を作れない config は本番で「学習者が正答不能」になる。
    if isinstance(q_type, str) and q_type.startswith("slot_"):
        slot_config = question.get("slot_config")
        if q_type == "slot_two_tier":
            if isinstance(slot_config, dict) and slot_config.get("type") == "two_tier_slot":
                for tier_name in ("tier1", "tier2"):
                    tier = slot_config.get(tier_name)
                    correct_value = tier.get("correct_value") if isinstance(tier, dict) else None
                    if not isinstance(correct_value, str):
                        violations.append({
                            "rule": "R19",
                            "level": "reject",
                            "detail": f"slot_two_tier.{tier_name}: correct_value が string ではない",
                        })
                    else:
                        violations.extend(_slot_config_violations(q_type="", config=tier, correct_value=correct_value, path=f"slot_two_tier.{tier_name}"))
            else:
                violations.append({
                    "rule": "R19",
                    "level": "reject",
                    "detail": "slot_two_tier: slot_config.type は two_tier_slot 必須",
                })
        else:
            violations.extend(_slot_config_violations(q_type=q_type, config=slot_config, correct_value=str(question.get("answer", "")), path=q_type))

    # ─── R22: process_understanding gate ─────────────────
    # d4/d5 算数と国語読解弱点で、解説に複数手順があるのに出題本体が
    # 最終答え選択だけなら reject。2026-05-14 の d4-d5 single_tier
    # 量産を validator 段階で止める。
    process_gate_target = _is_math_question(question) or (
        _is_japanese_question(question)
        and _is_japanese_weak_reading_question(question)
    )
    if (
        process_gate_target
        and question.get("difficulty") in {"d4", "d5"}
        and not _process_gate_exempt_reason(question)
        and _solution_step_count(question.get("solution_steps")) >= 2
        and _is_answer_only_choice(question, hints)
        and not _has_process_understanding_path(question)
    ):
        violations.append({
            "rule": "R22",
            "level": "reject",
            "detail": (
                "process_understanding: d4/d5高難度問題で solution_steps は複数手順だが、"
                "出題本体が最終答え選択に寄っている。two_tier/evidence_first/"
                "slot_two_tier で strategy/formula/diagram/basis/error_diagnosis/"
                "evidence/elimination_reason/expression_effect を問うか、"
                "single_tier なら tier1_purpose にプロセス目的を明示する。"
                "R22 は reject。d4/d5 は tier 系でプロセスを問うこと。"
            ),
        })

    return violations


def batch_validate(questions: list[dict], lesson_meta_map: dict, r10r16_config: dict) -> list[dict]:
    violations = []
    questions_by_lesson = {}
    for q in questions:
        lesson_id = q.get("lesson_id", "") or ""
        questions_by_lesson.setdefault(lesson_id, []).append(q)

    for lesson_id, lesson_questions in questions_by_lesson.items():
        seen_reference_ids = {}
        seen_qtexts = {}
        for q in sorted(lesson_questions, key=lambda item: (item.get("position", 0), item.get("id", ""))):
            reference_problem_id = q.get("reference_problem_id")
            if reference_problem_id:
                if reference_problem_id in seen_reference_ids:
                    violations.append({
                        "rule": "R11",
                        "level": "reject",
                        "detail": f"reference_problem_id 重複: {reference_problem_id}",
                        "lesson_id": lesson_id,
                        "position": q.get("position", "?"),
                        "unit_id": q.get("unit_id", "") or "",
                        "answer": q.get("answer", ""),
                    })
                else:
                    seen_reference_ids[reference_problem_id] = q.get("position", "?")

            normalized_qtext = _normalize_qtext(q.get("question_text", "") or "")
            if normalized_qtext:
                if normalized_qtext in seen_qtexts:
                    violations.append({
                        "rule": "R11",
                        "level": "reject",
                        "detail": "question_text 重複（正規化後）",
                        "lesson_id": lesson_id,
                        "position": q.get("position", "?"),
                        "unit_id": q.get("unit_id", "") or "",
                        "answer": q.get("answer", ""),
                    })
                else:
                    seen_qtexts[normalized_qtext] = q.get("position", "?")

        sorted_questions = sorted(lesson_questions, key=lambda item: (item.get("position", 0), item.get("id", "")))
        current_unit = None
        run_length = 0
        warmup_units = set(r10r16_config.get("r13_warmup_exception_units", []))
        for q in sorted_questions:
            unit_id = q.get("unit_id", "") or ""
            position = q.get("position", 0)
            if unit_id == current_unit:
                run_length += 1
                if run_length >= 4:
                    is_warmup_exception = current_unit in warmup_units
                    is_within_warmup_zone = isinstance(position, int) and position <= 5
                    if not (is_warmup_exception and is_within_warmup_zone):
                        violations.append({
                            "rule": "R13",
                            "level": "reject",
                            "detail": f"同一 unit_id が {run_length} 問連続: {unit_id}",
                            "lesson_id": lesson_id,
                            "position": position,
                            "unit_id": unit_id,
                            "answer": q.get("answer", ""),
                        })
            else:
                current_unit = unit_id
                run_length = 1

        total_questions = len(sorted_questions)
        if total_questions > 0:
            unit_counts = {}
            first_by_unit = {}
            for q in sorted_questions:
                unit_id = q.get("unit_id", "") or ""
                unit_counts[unit_id] = unit_counts.get(unit_id, 0) + 1
                first_by_unit.setdefault(unit_id, q)
            top_unit, top_count = max(unit_counts.items(), key=lambda item: item[1])
            ratio = top_count / total_questions
            if ratio > 0.6:
                title = (lesson_meta_map.get(lesson_id, {}) or {}).get("title", "") or ""
                keywords = r10r16_config.get("r16_wu_lesson_title_keywords", [])
                level = "warn" if any(keyword in title for keyword in keywords) else "reject"
                ref_q = first_by_unit[top_unit]
                violations.append({
                    "rule": "R16",
                    "level": level,
                    "detail": f"unit_id '{top_unit}' が {top_count}/{total_questions} 問 ({ratio:.1%})",
                    "lesson_id": lesson_id,
                    "position": ref_q.get("position", "?"),
                    "unit_id": top_unit,
                    "answer": ref_q.get("answer", ""),
                })

    return violations


def validate_questions_extended(
    questions: list[dict],
    lesson_meta_map: dict,
    allowed_units: dict,
    r10r16_config: dict,
    strict_process_gate: bool = False,
) -> list[dict]:
    _ = allowed_units
    all_violations = []
    r10_warn_indices_by_lesson = {}

    for q in questions:
        question_violations = check_question_extended(q, r10r16_config, strict_process_gate=strict_process_gate)
        for idx, violation in enumerate(question_violations):
            enriched = {
                **violation,
                "lesson_id": q.get("lesson_id", ""),
                "position": q.get("position", "?"),
                "unit_id": q.get("unit_id", "") or "",
                "answer": q.get("answer", ""),
            }
            if violation["rule"] == "R10" and violation["level"] == "warn":
                lesson_id = enriched["lesson_id"]
                r10_warn_indices_by_lesson.setdefault(lesson_id, []).append(len(all_violations))
            all_violations.append(enriched)

    for lesson_id, indices in r10_warn_indices_by_lesson.items():
        if len(indices) >= 8:
            for idx in indices:
                all_violations[idx]["level"] = "reject"
                all_violations[idx]["detail"] += "（同一 lesson_id 内で R10 warn が8問以上のため reject に格上げ）"

    all_violations.extend(batch_validate(questions, lesson_meta_map, r10r16_config))

    ng_records = []
    warn_records = []
    for violation in all_violations:
        if violation.get("level") not in {"reject", "warn"}:
            continue
        record = {
            "lesson_id": violation.get("lesson_id", ""),
            "position": violation.get("position", "?"),
            "unit_id": violation.get("unit_id", ""),
            "answer": violation.get("answer", ""),
            "violated_rules": [{
                "rule": violation["rule"],
                "detail": violation["detail"],
            }],
        }
        if violation.get("level") == "reject":
            ng_records.append(record)
        else:
            warn_records.append(record)

    if warn_records:
        print(f"[WARN] {len(warn_records)} 件の警告（exit には影響しません）:", file=sys.stderr)
        for rec in warn_records:
            print(f"  lesson={rec['lesson_id']} pos={rec['position']} unit={rec['unit_id']} answer={rec['answer']!r}", file=sys.stderr)
            for v in rec["violated_rules"]:
                print(f"    {v['rule']}: {v['detail']}", file=sys.stderr)

    return ng_records


# ─────────────────────────────────────────────
# R24: calc_list 正本との答え照合（2026-06-10 追加）
# ─────────────────────────────────────────────

_calc_answers_cache: dict = {}


def _normalize_calc_value(value) -> str:
    text = unicodedata.normalize("NFKC", str(value)).strip()
    return re.sub(r"\s+", " ", text)


def _load_calc_answers(kai: int):
    """calc_list.md のドリル表から {(day, q): answer} を作る。ファイル不在は None。"""
    if kai in _calc_answers_cache:
        return _calc_answers_cache[kai]
    path = CALC_LIST_DIR / f"{kai}回" / "計算" / "calc_list.md"
    if not path.exists():
        _calc_answers_cache[kai] = None
        return None
    answers: dict = {}
    day = None
    for line in path.read_text(encoding="utf-8").splitlines():
        m_day = re.match(r"^#+\s*(\d+)日目", line)
        if m_day:
            day = int(m_day.group(1))
            continue
        m_row = re.match(r"^\|\s*\((\d+)\)\s*\|[^|]*\|([^|]*)\|", line)
        if m_row and day is not None:
            answers[(day, int(m_row.group(1)))] = _normalize_calc_value(m_row.group(2))
    _calc_answers_cache[kai] = answers
    return answers


def validate_calc_refs(questions: list[dict]) -> tuple[list[dict], list[dict]]:
    """meta.calc_ref を持つ問題の answer を calc_list.md 正本と機械照合する（R24）。

    calc_ref = {"kai": 33, "day": 2, "q": 5} 形式。
    返り値: (reject_records, warn_records)。calc_list.md が無い環境（教材は
    gitignore 管理のローカル資産）では warn 止まりで exit には影響させない。
    """
    rejects: list[dict] = []
    warns: list[dict] = []
    for q in questions:
        ref = (q.get("meta") or {}).get("calc_ref")
        if not ref:
            continue
        base = {
            "lesson_id": q.get("lesson_id", ""),
            "position": q.get("position", "?"),
            "unit_id": q.get("unit_id", "") or "",
            "answer": q.get("answer", ""),
        }
        if not isinstance(ref, dict) or not all(k in ref for k in ("kai", "day", "q")):
            rejects.append({**base, "violated_rules": [{
                "rule": "R24",
                "detail": f"calc_ref は {{kai, day, q}} を持つ dict が必須: {ref!r}",
            }]})
            continue
        try:
            kai = int(ref["kai"])
            day = int(ref["day"])
            qnum = int(str(ref["q"]).strip("()（）"))
        except (TypeError, ValueError):
            rejects.append({**base, "violated_rules": [{
                "rule": "R24",
                "detail": f"calc_ref の値が数値として解釈できない: {ref!r}",
            }]})
            continue
        answers = _load_calc_answers(kai)
        if answers is None:
            warns.append({**base, "violated_rules": [{
                "rule": "R24",
                "detail": f"第{kai}回 calc_list.md が無いため照合スキップ（ローカル教材資産が無い環境）",
            }]})
            continue
        expected = answers.get((day, qnum))
        if expected is None:
            if day == 7:
                warns.append({**base, "violated_rules": [{
                    "rule": "R24",
                    "detail": f"7日目（応用・図形）はテーブル形式でないため自動照合スキップ: 第{kai}回",
                }]})
            else:
                rejects.append({**base, "violated_rules": [{
                    "rule": "R24",
                    "detail": f"calc_list.md に対応行が無い: 第{kai}回 {day}日目 ({qnum})",
                }]})
            continue
        actual = _normalize_calc_value(q.get("answer", ""))
        if actual != expected:
            rejects.append({**base, "violated_rules": [{
                "rule": "R24",
                "detail": (
                    f"answer が calc_list 正本と不一致: lesson={actual!r} / "
                    f"calc_list={expected!r}（第{kai}回 {day}日目 ({qnum})）"
                ),
            }]})
    return rejects, warns


# ─────────────────────────────────────────────
# 失敗ログ書き込み
# ─────────────────────────────────────────────

def write_failure_log(ng_records: list[dict]) -> None:
    jst = timezone(timedelta(hours=9))
    now = datetime.now(jst)
    date_str = now.strftime("%Y%m%d")
    detected_at = now.isoformat()

    FAILURES_DIR.mkdir(parents=True, exist_ok=True)
    log_path = FAILURES_DIR / f"{date_str}.json"

    # 既存ログを読み込む（存在しなければ空リスト）
    existing = []
    if log_path.exists():
        try:
            existing = json.loads(log_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing = []

    for rec in ng_records:
        entry = {**rec, "detected_at": detected_at}
        existing.append(entry)

    log_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[log] 不合格ログ追記: {log_path}", file=sys.stderr)


# ─────────────────────────────────────────────
# JSON モード
# ─────────────────────────────────────────────

def run_json_mode(json_path: str, allowed_units: dict, r10r16_config: dict, strict_process_gate: bool = False) -> int:
    path = Path(json_path)
    if not path.exists():
        print(f"[error] ファイルが見つかりません: {json_path}", file=sys.stderr)
        return 1

    data = json.loads(path.read_text(encoding="utf-8"))

    # フラット形式 {lesson_id, questions: [...]} を想定
    if "questions" in data:
        questions = data["questions"]
        lesson_id = data.get("lesson_id", path.stem)
        for q in questions:
            q.setdefault("lesson_id", lesson_id)
        lesson_meta_map = {lesson_id: {"title": data.get("title", "")}}
        lesson_level_records = validate_remediation_and_blocks({**data, "id": lesson_id})
    elif isinstance(data, list):
        if all(isinstance(item, dict) and "questions" in item for item in data):
            questions = []
            lesson_level_records = []
            for lesson in data:
                lesson_questions = lesson.get("questions") if isinstance(lesson.get("questions"), list) else []
                for q in lesson_questions:
                    q.setdefault("lesson_id", lesson.get("id", ""))
                questions.extend(lesson_questions)
                lesson_level_records.extend(validate_remediation_and_blocks(lesson))
        else:
            questions = data
            lesson_level_records = []
        lesson_meta_map = {}
        for q in questions:
            lid = q.get("lesson_id", "") or ""
            if lid and lid not in lesson_meta_map:
                lesson_meta_map[lid] = {"title": q.get("title", "") or ""}
    else:
        print("[error] 不明な JSON 形式。{lesson_id, questions:[...]} または [...] を期待", file=sys.stderr)
        return 1

    ng_records = validate_questions(questions, allowed_units)
    extended_ng = validate_questions_extended(
        questions,
        lesson_meta_map,
        allowed_units,
        r10r16_config,
        strict_process_gate=strict_process_gate,
    )
    ng_records.extend(extended_ng)
    calc_rejects, calc_warns = validate_calc_refs(questions)
    if calc_warns:
        print(f"[WARN] R24: {len(calc_warns)} 件の照合スキップ（exit には影響しません）:", file=sys.stderr)
        for rec in calc_warns:
            for v in rec["violated_rules"]:
                print(f"  lesson={rec['lesson_id']} pos={rec['position']}: {v['detail']}", file=sys.stderr)
    ng_records.extend(calc_rejects)
    for violation in lesson_level_records:
        ng_records.append({
            "lesson_id": violation.get("lesson_id", ""),
            "position": violation.get("position", "?"),
            "unit_id": violation.get("unit_id", ""),
            "answer": violation.get("answer", ""),
            "violated_rules": [{"rule": violation["rule"], "detail": violation["detail"]}],
        })
    return _report(ng_records)


# ─────────────────────────────────────────────
# 結果レポート
# ─────────────────────────────────────────────

def _report(ng_records: list[dict]) -> int:
    if not ng_records:
        print("[OK] 全問題の正解肢フォーマット OK")
        return 0

    print(f"[NG] {len(ng_records)} 件の違反を検出:")
    for rec in ng_records:
        print(f"  lesson={rec['lesson_id']} pos={rec['position']} unit={rec['unit_id']}")
        print(f"    answer: {rec['answer']!r}")
        for v in rec["violated_rules"]:
            print(f"    rule{v['rule']}: {v['detail']}")

    write_failure_log(ng_records)
    return 1


# ─────────────────────────────────────────────
# エントリポイント
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="レッスン正解肢フォーマット品質チェック (validation.md §7)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
使用例:
  # JSON ファイルを検証
  python3 scripts/validate_lesson_format.py --json path/to/generated_lesson.json

終了コード: 0=合格 / 1=不合格
        """,
    )
    parser.add_argument("--json", metavar="FILE", required=True, help="検証対象の JSON ファイルパス")
    parser.add_argument(
        "--strict-process-gate",
        action="store_true",
        default=False,
        help="互換オプション。現在 R22 は常に validator で reject する",
    )

    args = parser.parse_args()

    # validation.md から許容ユニット一覧を読み込む
    try:
        allowed_units = load_allowed_units(VALIDATION_MD_PATH)
        r10r16_config = load_r10r16_config(VALIDATION_MD_PATH)
    except Exception as e:
        print(f"[error] validation 設定の読み込み失敗: {e}", file=sys.stderr)
        sys.exit(1)

    exit_code = run_json_mode(args.json, allowed_units, r10r16_config, strict_process_gate=args.strict_process_gate)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()

