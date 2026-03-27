(function () {
    function ready(callback) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", callback);
            return;
        }
        callback();
    }

    ready(function () {
        var scanForm = document.getElementById("scanForm");
        var firstQrInput = document.getElementById("firstQr");
        var secondQrInput = document.getElementById("secondQr");
        var operatorNameInput = document.getElementById("operatorName");
        var noteInput = document.getElementById("note");
        var saveButton = document.getElementById("saveButton");
        var resetButton = document.getElementById("resetButton");
        var statusMessage = document.getElementById("statusMessage");
        var recentTableBody = document.getElementById("recentTableBody");
        var todayCount = document.getElementById("todayCount");
        var initialQrSettingsElement = document.getElementById("initialQrSettings");

        var MIN_QR_LENGTH = 3;
        var FIRST_QR_TIMEOUT_MS = 15000;
        var OPERATOR_STORAGE_KEY = "qr-matching-operator-name";
        var isSaving = false;
        var firstQrTimer = null;
        var qrSettings = parseInitialSettings(initialQrSettingsElement);

        if (!scanForm || !firstQrInput || !secondQrInput || !statusMessage) {
            return;
        }

        scanForm.noValidate = true;

        restoreOperatorName();
        firstQrInput.focus();

        firstQrInput.addEventListener("input", function () {
            restartFirstQrTimer();
        });

        secondQrInput.addEventListener("input", function () {
            if (trimValue(secondQrInput.value)) {
                clearFirstQrTimer();
            }
        });

        firstQrInput.onkeydown = handleFirstQrEnter;
        firstQrInput.addEventListener("keydown", handleFirstQrEnter, true);

        secondQrInput.onkeydown = handleSecondQrEnter;
        secondQrInput.addEventListener("keydown", handleSecondQrEnter, true);

        scanForm.onsubmit = handleScanSubmit;
        scanForm.addEventListener("submit", handleScanSubmit, true);

        document.addEventListener("keydown", function (event) {
            if (document.activeElement === firstQrInput) {
                handleFirstQrEnter(event);
                return;
            }

            if (document.activeElement === secondQrInput) {
                handleSecondQrEnter(event);
            }
        }, true);

        function handleFirstQrEnter(event) {
            if (!isEnterKey(event)) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") {
                event.stopImmediatePropagation();
            }

            if (!validateSingleQr(trimValue(firstQrInput.value), "Lumi SN")) {
                firstQrInput.focus();
                return;
            }

            clearFirstQrTimer();
            secondQrInput.focus();
            secondQrInput.select();
            setStatus("info", "Solity SN을 스캔해주세요.");
        }

        function handleSecondQrEnter(event) {
            if (!isEnterKey(event)) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") {
                event.stopImmediatePropagation();
            }
            submitMatch();
        }

        function handleScanSubmit(event) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") {
                event.stopImmediatePropagation();
            }

            if (!trimValue(secondQrInput.value) && validateSingleQr(trimValue(firstQrInput.value), "Lumi SN")) {
                clearFirstQrTimer();
                secondQrInput.focus();
                secondQrInput.select();
                setStatus("info", "Solity SN을 스캔해주세요.");
                return;
            }

            submitMatch();
        }

        if (resetButton) {
            resetButton.addEventListener("click", function () {
                resetScanInputs(true, true);
                setStatus("warning", "입력값을 초기화했습니다.");
            });
        }

        if (operatorNameInput) {
            operatorNameInput.addEventListener("input", function () {
                try {
                    localStorage.setItem(OPERATOR_STORAGE_KEY, operatorNameInput.value);
                } catch (error) {
                    // Ignore local storage failures and keep scanning flow working.
                }
            });
        }

        window.qrScanCore = {
            setStatus: setStatus,
            renderRecentTable: renderRecentTable,
            resetScanInputs: resetScanInputs,
            getQrSettings: function () {
                return cloneSettings(qrSettings);
            },
            setQrSettings: function (nextSettings) {
                qrSettings = normalizeSettings(nextSettings);
            }
        };

        function submitMatch() {
            var firstQr = trimValue(firstQrInput.value);
            var secondQr = trimValue(secondQrInput.value);
            var operatorName = operatorNameInput ? trimValue(operatorNameInput.value) : "";
            var note = noteInput ? trimValue(noteInput.value) : "";

            if (isSaving) {
                return;
            }

            if (!validatePair(firstQr, secondQr)) {
                focusInvalidField(firstQr, secondQr);
                return;
            }

            isSaving = true;
            if (saveButton) {
                saveButton.disabled = true;
            }

            var xhr = new XMLHttpRequest();
            xhr.open("POST", "/api/matches", true);
            xhr.setRequestHeader("Content-Type", "application/json");

            xhr.onreadystatechange = function () {
                var data;

                if (xhr.readyState !== 4) {
                    return;
                }

                isSaving = false;
                if (saveButton) {
                    saveButton.disabled = false;
                }

                try {
                    data = JSON.parse(xhr.responseText || "{}");
                } catch (error) {
                    data = {};
                }

                if (xhr.status < 200 || xhr.status >= 300) {
                    setStatus("error", data.message || "저장에 실패했습니다.");
                    if (window.qrDashboardHooks && typeof window.qrDashboardHooks.onSaveError === "function") {
                        window.qrDashboardHooks.onSaveError(data.message || "저장에 실패했습니다.");
                    }
                    return;
                }

                setStatus("success", data.message || "매칭이 저장되었습니다.");
                if (typeof data.today_count !== "undefined" && todayCount) {
                    todayCount.textContent = String(data.today_count);
                }
                if (Array.isArray(data.recent_matches)) {
                    renderRecentTable(data.recent_matches);
                }
                resetScanInputs(true, true);

                if (window.qrDashboardHooks && typeof window.qrDashboardHooks.onSaveSuccess === "function") {
                    window.qrDashboardHooks.onSaveSuccess(data);
                }
            };

            xhr.onerror = function () {
                isSaving = false;
                if (saveButton) {
                    saveButton.disabled = false;
                }
                setStatus("error", "저장 중 오류가 발생했습니다.");
            };

            xhr.send(JSON.stringify({
                first_qr: firstQr,
                second_qr: secondQr,
                operator_name: operatorName,
                note: note
            }));
        }

        function renderRecentTable(rows) {
            var i;
            var row;
            var tr;
            var values;
            var j;
            var td;
            var actionTd;

            if (!recentTableBody) {
                return;
            }

            recentTableBody.innerHTML = "";

            if (!rows || !rows.length) {
                recentTableBody.innerHTML = '<tr class="empty-row"><td colspan="7">저장된 내역이 없습니다.</td></tr>';
                return;
            }

            for (i = 0; i < rows.length; i += 1) {
                row = rows[i];
                tr = document.createElement("tr");
                values = [
                    row.id,
                    row.first_qr,
                    row.second_qr,
                    row.created_at,
                    row.operator_name || "-",
                    row.note || "-"
                ];

                for (j = 0; j < values.length; j += 1) {
                    td = document.createElement("td");
                    td.textContent = values[j];
                    tr.appendChild(td);
                }

                actionTd = document.createElement("td");
                actionTd.className = "table-action-cell";
                actionTd.innerHTML =
                    '<div class="table-action-group">'
                    + '<button class="table-action-button" type="button" data-edit-id="' + row.id + '">수정</button>'
                    + '<button class="table-action-button delete-button" type="button" data-delete-id="' + row.id + '">삭제</button>'
                    + "</div>";
                tr.appendChild(actionTd);
                recentTableBody.appendChild(tr);
            }
        }

        function validatePair(firstQr, secondQr) {
            if (!validateSingleQr(firstQr, "Lumi SN")) {
                return false;
            }

            if (!validateSingleQr(secondQr, "Solity SN")) {
                return false;
            }

            if (firstQr === secondQr) {
                setStatus("error", "동일한 값 2개는 한 세트로 저장할 수 없습니다.");
                return false;
            }

            return true;
        }

        function validateSingleQr(value, label) {
            var requiredLength = getRequiredLength(label);

            if (!value) {
                setStatus("error", label + "을(를) 입력해주세요.");
                return false;
            }

            if (requiredLength > 0 && value.length !== requiredLength) {
                setStatus("error", label + "은(는) " + requiredLength + "자리여야 합니다.");
                return false;
            }

            if (requiredLength === 0 && value.length < MIN_QR_LENGTH) {
                setStatus("error", label + "은(는) 최소 " + MIN_QR_LENGTH + "자 이상이어야 합니다.");
                return false;
            }

            return true;
        }

        function focusInvalidField(firstQr, secondQr) {
            if (!isValidLength(firstQr, "Lumi SN")) {
                firstQrInput.focus();
                firstQrInput.select();
                return;
            }

            if (!isValidLength(secondQr, "Solity SN")) {
                secondQrInput.focus();
                secondQrInput.select();
            }
        }

        function resetScanInputs(keepOperatorName, focusFirst) {
            clearFirstQrTimer();
            firstQrInput.value = "";
            secondQrInput.value = "";

            if (noteInput) {
                noteInput.value = "";
            }

            if (!keepOperatorName && operatorNameInput) {
                operatorNameInput.value = "";
                try {
                    localStorage.removeItem(OPERATOR_STORAGE_KEY);
                } catch (error) {
                    // Ignore local storage failures and keep scanning flow working.
                }
            }

            if (focusFirst) {
                firstQrInput.focus();
            }
        }

        function restartFirstQrTimer() {
            clearFirstQrTimer();

            if (!trimValue(firstQrInput.value) || trimValue(secondQrInput.value)) {
                return;
            }

            firstQrTimer = window.setTimeout(function () {
                if (!trimValue(firstQrInput.value) || trimValue(secondQrInput.value)) {
                    return;
                }

                resetScanInputs(true, true);
                setStatus("warning", "Lumi SN 입력 후 지연되어 자동 초기화했습니다.");
            }, FIRST_QR_TIMEOUT_MS);
        }

        function clearFirstQrTimer() {
            if (firstQrTimer) {
                window.clearTimeout(firstQrTimer);
                firstQrTimer = null;
            }
        }

        function setStatus(type, message) {
            statusMessage.className = "status-message " + type;
            statusMessage.textContent = message;
        }

        function trimValue(value) {
            return String(value || "").replace(/^\s+|\s+$/g, "");
        }

        function getRequiredLength(label) {
            if (label === "Lumi SN") {
                return qrSettings.first_qr_length;
            }

            return qrSettings.second_qr_length;
        }

        function isValidLength(value, label) {
            var trimmedValue = trimValue(value);
            var requiredLength = getRequiredLength(label);

            if (!trimmedValue) {
                return false;
            }

            if (requiredLength > 0) {
                return trimmedValue.length === requiredLength;
            }

            return trimmedValue.length >= MIN_QR_LENGTH;
        }

        function isEnterKey(event) {
            return event.key === "Enter" || event.keyCode === 13 || event.which === 13;
        }

        function parseInitialSettings(element) {
            if (!element) {
                return cloneSettings({
                    first_qr_length: 0,
                    second_qr_length: 0
                });
            }

            try {
                return normalizeSettings(JSON.parse(element.textContent || "{}"));
            } catch (error) {
                return cloneSettings({
                    first_qr_length: 0,
                    second_qr_length: 0
                });
            }
        }

        function normalizeSettings(settings) {
            return {
                first_qr_length: sanitizeLength(settings && settings.first_qr_length),
                second_qr_length: sanitizeLength(settings && settings.second_qr_length)
            };
        }

        function cloneSettings(settings) {
            return {
                first_qr_length: settings.first_qr_length,
                second_qr_length: settings.second_qr_length
            };
        }

        function sanitizeLength(value) {
            var number = parseInt(value, 10);
            if (isNaN(number) || number < 0) {
                return 0;
            }
            return number;
        }

        function restoreOperatorName() {
            if (!operatorNameInput) {
                return;
            }

            try {
                var savedOperatorName = localStorage.getItem(OPERATOR_STORAGE_KEY);
                if (savedOperatorName) {
                    operatorNameInput.value = savedOperatorName;
                }
            } catch (error) {
                // Ignore local storage failures and keep scanning flow working.
            }
        }
    });
}());
