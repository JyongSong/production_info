from __future__ import annotations

import re
from typing import Any

import supabase_client as db
from .match_service import ValidationError


DEFAULT_QR_SETTINGS = {
    "first_qr_length": 0,
    "second_qr_length": 0,
}

# Solity SN 형식 규칙의 기본값.
# 설정값을 읽지 못했을 때 "검사 없음"이 아니라 기존 동작으로 폴백하기 위해
# 코드에 하드코딩되어 있던 값과 동일하게 둔다.
DEFAULT_SOLITY_RULE: dict[str, Any] = {
    "length": 13,
    "prefix": "AK",
    "suffixes": ["TAK", "TAS"],
}

SOLITY_LENGTH_KEY = "solity_sn_length"
SOLITY_PREFIX_KEY = "solity_sn_prefix"
SOLITY_SUFFIXES_KEY = "solity_sn_suffixes"

ALL_SETTINGS_KEYS = (
    "first_qr_length",
    "second_qr_length",
    SOLITY_LENGTH_KEY,
    SOLITY_PREFIX_KEY,
    SOLITY_SUFFIXES_KEY,
)

MAX_SUFFIX_COUNT = 10
MAX_FIXED_TEXT_LENGTH = 20
SN_CHAR_PATTERN = re.compile(r"^[A-Z0-9]+$")

TABLE = "production_app_settings"


# ---------------------------------------------------------------------------
# Raw settings access
# ---------------------------------------------------------------------------

def get_all_settings() -> dict[str, str]:
    """Fetch every known settings key in a single query.

    Callers that need more than one setting should use this and derive the
    rest, so that saving a record stays at one round trip to the database.
    """
    rows = db.select(
        TABLE,
        filters={"settings_key": f"in.({','.join(ALL_SETTINGS_KEYS)})"},
    )
    return {
        row["settings_key"]: row["settings_value"]
        for row in rows
        if row.get("settings_key") in ALL_SETTINGS_KEYS
    }


def _upsert(key: str, value: str) -> None:
    existing = db.select(TABLE, filters={"settings_key": f"eq.{key}"}, limit=1)
    if existing:
        db.update(TABLE, f"settings_key=eq.{key}", {"settings_value": value})
    else:
        db.insert(TABLE, {"settings_key": key, "settings_value": value})


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------

def normalize_length_value(value: Any, label: str) -> int:
    text = str(value or "").strip()
    if not text:
        return 0

    try:
        number = int(text)
    except ValueError as error:
        raise ValidationError(f"{label}는 숫자로 입력해주세요.") from error

    if number < 0:
        raise ValidationError(f"{label}는 0 이상이어야 합니다.")

    if number > 999:
        raise ValidationError(f"{label}는 999 이하로 입력해주세요.")

    return number


def normalize_fixed_text(value: Any, label: str) -> str:
    """Normalize a fixed prefix/suffix fragment of an SN."""
    text = str(value or "").strip().upper()
    if not text:
        return ""
    if len(text) > MAX_FIXED_TEXT_LENGTH:
        raise ValidationError(f"{label}는 {MAX_FIXED_TEXT_LENGTH}자 이하로 입력해주세요.")
    if not SN_CHAR_PATTERN.match(text):
        raise ValidationError(f"{label}는 영문 대문자와 숫자만 사용할 수 있습니다.")
    return text


def normalize_suffixes(value: Any, label: str) -> list[str]:
    """Accept 'TAK, TAS' or ['TAK', 'TAS'] and return a clean, de-duped list."""
    if isinstance(value, (list, tuple)):
        parts = [str(item) for item in value]
    else:
        parts = re.split(r"[,\s]+", str(value or ""))

    suffixes: list[str] = []
    for part in parts:
        cleaned = normalize_fixed_text(part, label)
        if cleaned and cleaned not in suffixes:
            suffixes.append(cleaned)

    if len(suffixes) > MAX_SUFFIX_COUNT:
        raise ValidationError(f"{label}는 최대 {MAX_SUFFIX_COUNT}개까지 등록할 수 있습니다.")

    return suffixes


# ---------------------------------------------------------------------------
# QR length settings
# ---------------------------------------------------------------------------

def get_qr_settings(raw: dict[str, str] | None = None) -> dict[str, int]:
    if raw is None:
        raw = get_all_settings()

    settings = dict(DEFAULT_QR_SETTINGS)
    for key in settings:
        if key not in raw:
            continue
        try:
            settings[key] = max(0, int(raw[key]))
        except (TypeError, ValueError):
            settings[key] = DEFAULT_QR_SETTINGS[key]

    return settings


def update_qr_settings(first_qr_length: Any = None, second_qr_length: Any = None) -> dict[str, int]:
    """Update QR length settings. A value of None leaves that key untouched."""
    current = get_qr_settings()

    if first_qr_length is None:
        normalized_first = current["first_qr_length"]
    else:
        normalized_first = normalize_length_value(first_qr_length, "Lumi SN 자릿수")

    if second_qr_length is None:
        normalized_second = current["second_qr_length"]
    else:
        normalized_second = normalize_length_value(second_qr_length, "Solity SN 자릿수")

    _upsert("first_qr_length", str(normalized_first))
    _upsert("second_qr_length", str(normalized_second))

    return {
        "first_qr_length": normalized_first,
        "second_qr_length": normalized_second,
    }


# ---------------------------------------------------------------------------
# Solity SN format rule
# ---------------------------------------------------------------------------

def get_solity_rule(raw: dict[str, str] | None = None) -> dict[str, Any]:
    """Read the Solity SN format rule, falling back per-field on bad data."""
    if raw is None:
        raw = get_all_settings()

    if SOLITY_LENGTH_KEY in raw:
        try:
            length = max(0, int(raw[SOLITY_LENGTH_KEY]))
        except (TypeError, ValueError):
            length = DEFAULT_SOLITY_RULE["length"]
    else:
        length = DEFAULT_SOLITY_RULE["length"]

    if SOLITY_PREFIX_KEY in raw:
        prefix = str(raw[SOLITY_PREFIX_KEY] or "").strip().upper()
    else:
        prefix = DEFAULT_SOLITY_RULE["prefix"]

    if SOLITY_SUFFIXES_KEY in raw:
        suffixes = [
            part.strip().upper()
            for part in re.split(r"[,\s]+", str(raw[SOLITY_SUFFIXES_KEY] or ""))
            if part.strip()
        ]
    else:
        suffixes = list(DEFAULT_SOLITY_RULE["suffixes"])

    return {"length": length, "prefix": prefix, "suffixes": suffixes}


def validate_solity_rule(rule: dict[str, Any], confirm_no_check: bool = False) -> None:
    """Reject rules that are unsatisfiable or that silently disable checking."""
    length = rule["length"]
    prefix = rule["prefix"]
    suffixes = rule["suffixes"]

    if not length and not prefix and not suffixes:
        if not confirm_no_check:
            raise ValidationError(
                "자릿수·접두사·접미사가 모두 비어 있습니다. "
                "이대로 저장하면 Solity SN 검사가 완전히 꺼집니다."
            )
        return

    if length:
        longest_suffix = max((len(item) for item in suffixes), default=0)
        required = len(prefix) + longest_suffix
        if required > length:
            raise ValidationError(
                f"접두사({len(prefix)}자)와 접미사({longest_suffix}자)의 합이 "
                f"자릿수({length}자)를 넘습니다. 어떤 SN도 통과할 수 없습니다."
            )


def update_solity_rule(
    length: Any = None,
    prefix: Any = None,
    suffixes: Any = None,
    confirm_no_check: bool = False,
) -> dict[str, Any]:
    """Update the Solity SN rule. A value of None leaves that field untouched."""
    current = get_solity_rule()

    if length is None:
        next_length = current["length"]
    else:
        next_length = normalize_length_value(length, "Solity SN 자릿수")

    if prefix is None:
        next_prefix = current["prefix"]
    else:
        next_prefix = normalize_fixed_text(prefix, "Solity SN 접두사")

    if suffixes is None:
        next_suffixes = list(current["suffixes"])
    else:
        next_suffixes = normalize_suffixes(suffixes, "Solity SN 접미사")

    rule = {"length": next_length, "prefix": next_prefix, "suffixes": next_suffixes}
    validate_solity_rule(rule, confirm_no_check=confirm_no_check)

    _upsert(SOLITY_LENGTH_KEY, str(next_length))
    _upsert(SOLITY_PREFIX_KEY, next_prefix)
    _upsert(SOLITY_SUFFIXES_KEY, ",".join(next_suffixes))

    return rule
