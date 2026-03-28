from __future__ import annotations

from datetime import datetime
from io import BytesIO
import os
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from database import initialize_database
from services import (
    DuplicatePairError,
    DuplicateQRCodeError,
    DuplicateSaveError,
    InvalidLumiSnError,
    NotFoundError,
    ValidationError,
    check_lumi_sn_already_used,
    check_lumi_sn_exists,
    count_matches_by_date,
    create_match,
    delete_match,
    get_qr_settings,
    get_recent_matches,
    list_matches_for_export,
    search_matches,
    update_match,
    update_qr_settings,
)


app = Flask(__name__)
app.json.ensure_ascii = False

initialize_database()

BASE_DIR = Path(__file__).resolve().parent


def build_dashboard_payload(message: str, match: dict | None = None) -> dict:
    today = datetime.now().strftime("%Y-%m-%d")
    payload = {
        "success": True,
        "message": message,
        "recent_matches": get_recent_matches(),
        "today_count": count_matches_by_date(today),
    }
    if match is not None:
        payload["match"] = match
    return payload


def get_asset_version(relative_path: str) -> str:
    asset_path = BASE_DIR / relative_path
    if not asset_path.exists():
        return "1"
    return str(int(asset_path.stat().st_mtime))


def build_excel_file(rows: list[dict]) -> BytesIO:
    # 현장 PC에서 바로 열어도 보기 쉽도록 헤더와 폭을 함께 정리한다.
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "QR 매칭 내역"

    headers = ["번호", "Lumi SN", "Solity SN", "Production Time", "작업자명", "비고"]
    worksheet.append(headers)

    for row in rows:
        worksheet.append(
            [
                row["id"],
                row["first_qr"],
                row["second_qr"],
                row["created_at"],
                row["operator_name"],
                row["note"],
            ]
        )

    header_fill = PatternFill(fill_type="solid", start_color="123C52", end_color="123C52")
    header_font = Font(color="FFFFFF", bold=True)
    center_alignment = Alignment(horizontal="center", vertical="center")

    for cell in worksheet[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center_alignment

    column_widths = [10, 32, 32, 22, 18, 24]
    for index, width in enumerate(column_widths, start=1):
        worksheet.column_dimensions[get_column_letter(index)].width = width

    for row in worksheet.iter_rows(min_row=2, max_col=6):
        row[0].alignment = center_alignment
        row[3].alignment = center_alignment

    worksheet.freeze_panes = "A2"

    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    return output


@app.after_request
def add_no_cache_headers(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


def _common_versions() -> dict:
    return {
        "css_version": get_asset_version("static/css/style.css"),
        "js_version": get_asset_version("static/js/app.js"),
        "scan_js_version": get_asset_version("static/js/scan-core.js"),
        "sound_js_version": get_asset_version("static/js/sound.js"),
    }


@app.get("/")
def home():
    today = datetime.now().strftime("%Y-%m-%d")
    return render_template(
        "home.html",
        today_count=count_matches_by_date(today),
        today=today,
        **_common_versions(),
    )


@app.get("/scan")
def scan_page():
    today = datetime.now().strftime("%Y-%m-%d")
    return render_template(
        "scan.html",
        recent_matches=get_recent_matches(),
        today_count=count_matches_by_date(today),
        today=today,
        qr_settings=get_qr_settings(),
        **_common_versions(),
    )


@app.get("/search")
def search_page():
    return render_template("search.html", **_common_versions())


@app.get("/settings")
def settings_page():
    return render_template(
        "settings.html",
        qr_settings=get_qr_settings(),
        **_common_versions(),
    )


@app.post("/api/matches")
def save_match():
    payload = request.get_json(silent=True) or request.form

    try:
        # 스캐너 입력은 프런트엔드에서 JSON으로 보내고, 일반 폼 전송도 함께 허용한다.
        saved_match = create_match(
            first_qr=payload.get("first_qr", ""),
            second_qr=payload.get("second_qr", ""),
            operator_name=payload.get("operator_name", ""),
            note=payload.get("note", ""),
        )
        return jsonify(build_dashboard_payload("매칭이 저장되었습니다.", saved_match))
    except ValidationError as error:
        return jsonify({"success": False, "message": str(error)}), 400
    except InvalidLumiSnError as error:
        return jsonify({"success": False, "message": str(error)}), 400
    except DuplicatePairError as error:
        return jsonify({"success": False, "message": str(error)}), 409
    except DuplicateQRCodeError as error:
        return jsonify({"success": False, "message": str(error)}), 409
    except DuplicateSaveError as error:
        return jsonify({"success": False, "message": str(error)}), 409
    except Exception:
        return jsonify({"success": False, "message": "저장 중 오류가 발생했습니다."}), 500


@app.put("/api/matches/<int:match_id>")
def update_match_api(match_id: int):
    payload = request.get_json(silent=True) or request.form

    try:
        updated_match = update_match(
            match_id=match_id,
            first_qr=payload.get("first_qr", ""),
            second_qr=payload.get("second_qr", ""),
            operator_name=payload.get("operator_name", ""),
            note=payload.get("note", ""),
        )
        return jsonify(build_dashboard_payload("수정이 완료되었습니다.", updated_match))
    except NotFoundError as error:
        return jsonify({"success": False, "message": str(error)}), 404
    except ValidationError as error:
        return jsonify({"success": False, "message": str(error)}), 400
    except InvalidLumiSnError as error:
        return jsonify({"success": False, "message": str(error)}), 400
    except DuplicatePairError as error:
        return jsonify({"success": False, "message": str(error)}), 409
    except DuplicateQRCodeError as error:
        return jsonify({"success": False, "message": str(error)}), 409
    except DuplicateSaveError as error:
        return jsonify({"success": False, "message": str(error)}), 409
    except Exception:
        return jsonify({"success": False, "message": "수정 중 오류가 발생했습니다."}), 500


@app.delete("/api/matches/<int:match_id>")
def delete_match_api(match_id: int):
    try:
        delete_match(match_id)
        return jsonify(build_dashboard_payload("삭제가 완료되었습니다."))
    except NotFoundError as error:
        return jsonify({"success": False, "message": str(error)}), 404
    except Exception:
        return jsonify({"success": False, "message": "삭제 중 오류가 발생했습니다."}), 500


@app.get("/api/validate-lumi-sn")
def validate_lumi_sn_api():
    lumi_sn = (request.args.get("sn", "") or "").strip()
    if not lumi_sn:
        return jsonify({"valid": False, "message": "Lumi SN을 입력해주세요."}), 400
    if not check_lumi_sn_exists(lumi_sn):
        return jsonify({"valid": False, "message": "등록되지 않은 Lumi SN입니다."})
    if check_lumi_sn_already_used(lumi_sn):
        return jsonify({"valid": False, "message": "이미 사용된 Lumi SN입니다."})
    return jsonify({"valid": True})


@app.get("/api/settings")
def get_settings_api():
    return jsonify({"settings": get_qr_settings()})


@app.put("/api/settings")
def update_settings_api():
    payload = request.get_json(silent=True) or request.form

    try:
        settings = update_qr_settings(
            first_qr_length=payload.get("first_qr_length", 0),
            second_qr_length=payload.get("second_qr_length", 0),
        )
        return jsonify(
            {
                "success": True,
                "message": "QR 자릿수 설정이 저장되었습니다.",
                "settings": settings,
            }
        )
    except ValidationError as error:
        return jsonify({"success": False, "message": str(error)}), 400


@app.get("/api/recent")
def recent_matches_api():
    today = datetime.now().strftime("%Y-%m-%d")
    return jsonify(
        {
            "recent_matches": get_recent_matches(),
            "today_count": count_matches_by_date(today),
        }
    )


@app.get("/api/search")
def search_matches_api():
    try:
        matches = search_matches(
            first_qr=request.args.get("first_qr", ""),
            second_qr=request.args.get("second_qr", ""),
            target_date=request.args.get("date", ""),
        )
        return jsonify({"matches": matches, "count": len(matches)})
    except ValidationError as error:
        return jsonify({"success": False, "message": str(error)}), 400


@app.get("/download.xlsx")
def download_excel():
    try:
        target_date = request.args.get("date", "")
        rows = list_matches_for_export(target_date=target_date)
        excel_file = build_excel_file(rows)

        date_suffix = target_date.strip() if target_date else datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"qr_matching_{date_suffix}.xlsx"
        return send_file(
            excel_file,
            as_attachment=True,
            download_name=filename,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    except ValidationError as error:
        return jsonify({"success": False, "message": str(error)}), 400


if __name__ == "__main__":
    host = os.environ.get("QR_TOOL_HOST", "127.0.0.1")
    port = int(os.environ.get("QR_TOOL_PORT", "5055"))
    app.run(host=host, port=port, debug=False)
