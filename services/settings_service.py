from __future__ import annotations

from typing import Any

import supabase_client as db
from .match_service import ValidationError


DEFAULT_QR_SETTINGS = {
    "first_qr_length": 0,
    "second_qr_length": 0,
}

TABLE = "app_settings"


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


def get_qr_settings() -> dict[str, int]:
    settings = dict(DEFAULT_QR_SETTINGS)

    rows = db.select(
        TABLE,
        filters={
            "settings_key": "in.(first_qr_length,second_qr_length)",
        },
    )

    for row in rows:
        key = row["settings_key"]
        if key in settings:
            try:
                settings[key] = max(0, int(row["settings_value"]))
            except (TypeError, ValueError):
                settings[key] = DEFAULT_QR_SETTINGS[key]

    return settings


def update_qr_settings(first_qr_length: Any, second_qr_length: Any) -> dict[str, int]:
    normalized_first = normalize_length_value(first_qr_length, "Lumi SN 자릿수")
    normalized_second = normalize_length_value(second_qr_length, "Solity SN 자릿수")

    for key, value in [
        ("first_qr_length", str(normalized_first)),
        ("second_qr_length", str(normalized_second)),
    ]:
        # Upsert: try update first, insert if not found
        existing = db.select(TABLE, filters={"settings_key": f"eq.{key}"}, limit=1)
        if existing:
            db.update(TABLE, f"settings_key=eq.{key}", {"settings_value": value})
        else:
            db.insert(TABLE, {"settings_key": key, "settings_value": value})

    return {
        "first_qr_length": normalized_first,
        "second_qr_length": normalized_second,
    }
