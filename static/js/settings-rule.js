// Solity SN 형식 규칙 설정 (설정 페이지 전용)
//
// 서버가 유일한 권위이고, 이 화면은 그 설정을 읽고 쓰기만 한다.
// 저장 전 테스트는 서버의 /api/settings/preview-solity-sn 를 호출하므로
// 화면에 표시되는 판정은 생산 라인에서 실제로 일어나는 동작과 동일하다.
(function () {
    "use strict";

    document.addEventListener("DOMContentLoaded", function () {
        var lengthInput = document.getElementById("solitySnLength");
        var prefixInput = document.getElementById("solitySnPrefix");
        var suffixesInput = document.getElementById("solitySnSuffixes");
        var currentBox = document.getElementById("solityRuleCurrent");
        var statusBox = document.getElementById("solityRuleStatus");
        var saveButton = document.getElementById("saveSolityRuleButton");
        var resetButton = document.getElementById("resetSolityRuleButton");
        var testInput = document.getElementById("solityTestSn");
        var testButton = document.getElementById("solityTestButton");
        var testResult = document.getElementById("solityTestResult");

        // 이 섹션이 없는 페이지에서는 아무것도 하지 않는다.
        if (!lengthInput || !prefixInput || !suffixesInput) {
            return;
        }

        var savedRule = readInitialRule();
        var isSaving = false;

        applyRuleToInputs(savedRule);
        renderCurrentRule(savedRule);

        saveButton.addEventListener("click", saveRule);
        resetButton.addEventListener("click", function () {
            applyRuleToInputs(savedRule);
            hide(statusBox);
            hide(testResult);
        });
        testButton.addEventListener("click", runTest);
        testInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter" || event.keyCode === 13) {
                event.preventDefault();
                runTest();
            }
        });

        // -------------------------------------------------------------
        // 규칙 읽기 / 표시
        // -------------------------------------------------------------

        function readInitialRule() {
            var element = document.getElementById("initialQrSettings");
            if (!element) {
                return { length: 0, prefix: "", suffixes: [] };
            }
            try {
                var parsed = JSON.parse(element.textContent || "{}");
                return normalizeRule(parsed.solity_rule);
            } catch (error) {
                return { length: 0, prefix: "", suffixes: [] };
            }
        }

        function normalizeRule(rule) {
            rule = rule || {};
            var length = parseInt(rule.length, 10);
            return {
                length: isFinite(length) && length > 0 ? length : 0,
                prefix: String(rule.prefix || "").trim().toUpperCase(),
                suffixes: (rule.suffixes || []).map(function (item) {
                    return String(item || "").trim().toUpperCase();
                }).filter(Boolean)
            };
        }

        function applyRuleToInputs(rule) {
            lengthInput.value = rule.length ? String(rule.length) : "";
            prefixInput.value = rule.prefix;
            suffixesInput.value = rule.suffixes.join(", ");
        }

        function renderCurrentRule(rule) {
            var parts = [];
            parts.push(rule.length ? rule.length + "자리" : "자릿수 검사 안 함");
            parts.push(rule.prefix ? "'" + rule.prefix + "'로 시작" : "접두사 검사 안 함");
            if (!rule.suffixes.length) {
                parts.push("접미사 검사 안 함");
            } else if (rule.suffixes.length === 1) {
                parts.push("'" + rule.suffixes[0] + "'로 끝남");
            } else {
                parts.push(rule.suffixes.join(" / ") + " 중 하나로 끝남");
            }

            currentBox.textContent = "현재 적용 중인 규칙: " + parts.join(" · ");
            currentBox.className = isRuleEmpty(rule)
                ? "status-message warning"
                : "status-message info";
        }

        // 화면에 입력된 값(저장 전)을 서버 payload 형태로 만든다.
        function collectDraft() {
            return {
                solity_sn_length: String(lengthInput.value || "").trim(),
                solity_sn_prefix: String(prefixInput.value || "").trim(),
                solity_sn_suffixes: String(suffixesInput.value || "").trim()
            };
        }

        function isRuleEmpty(rule) {
            return !rule.length && !rule.prefix && !rule.suffixes.length;
        }

        function draftIsEmpty(draft) {
            var length = parseInt(draft.solity_sn_length, 10);
            return (
                (!isFinite(length) || length === 0) &&
                !draft.solity_sn_prefix &&
                !draft.solity_sn_suffixes
            );
        }

        // -------------------------------------------------------------
        // 저장
        // -------------------------------------------------------------

        function saveRule() {
            if (isSaving) return;

            var draft = collectDraft();
            var payload = {
                solity_sn_length: draft.solity_sn_length,
                solity_sn_prefix: draft.solity_sn_prefix,
                solity_sn_suffixes: draft.solity_sn_suffixes
            };

            // 검사를 끄는 변경은 조용히 넘어가지 않도록 한 번 더 확인한다.
            if (draftIsEmpty(draft)) {
                var confirmed = window.confirm(
                    "자릿수·접두사·접미사가 모두 비어 있습니다.\n" +
                    "이대로 저장하면 Solity SN 검사가 완전히 꺼지고, " +
                    "잘못 스캔된 SN도 그대로 저장됩니다.\n\n계속하시겠습니까?"
                );
                if (!confirmed) return;
                payload.confirm_no_check = true;
            } else if (!confirmWeakening(draft)) {
                return;
            }

            isSaving = true;
            saveButton.disabled = true;

            request("PUT", "/api/settings", payload, function (ok, data) {
                isSaving = false;
                saveButton.disabled = false;

                if (!ok) {
                    show(statusBox, "error", (data && data.message) || "규칙 저장에 실패했습니다.");
                    return;
                }

                savedRule = normalizeRule((data.settings || {}).solity_rule);
                applyRuleToInputs(savedRule);
                renderCurrentRule(savedRule);
                hide(testResult);
                show(statusBox, "success", "규칙이 저장되었습니다. 스캔 화면은 새로고침 후 적용됩니다.");
            });
        }

        // 개별 항목이 "검사함 → 검사 안 함"으로 바뀌는 경우에도 확인을 받는다.
        function confirmWeakening(draft) {
            var removed = [];
            var nextLength = parseInt(draft.solity_sn_length, 10);

            if (savedRule.length && (!isFinite(nextLength) || nextLength === 0)) {
                removed.push("자릿수");
            }
            if (savedRule.prefix && !draft.solity_sn_prefix) {
                removed.push("고정 접두사");
            }
            if (savedRule.suffixes.length && !draft.solity_sn_suffixes) {
                removed.push("고정 접미사");
            }

            if (!removed.length) return true;

            return window.confirm(
                removed.join(", ") + " 검사를 끄려고 합니다.\n" +
                "해당 항목은 더 이상 확인하지 않습니다.\n\n계속하시겠습니까?"
            );
        }

        // -------------------------------------------------------------
        // 저장 전 테스트
        // -------------------------------------------------------------

        function runTest() {
            var sn = String(testInput.value || "").trim();
            if (!sn) {
                show(testResult, "error", "테스트할 Solity SN을 입력해주세요.");
                return;
            }

            testButton.disabled = true;
            request("POST", "/api/settings/preview-solity-sn", {
                sn: sn,
                rule: collectDraft()
            }, function (ok, data) {
                testButton.disabled = false;

                if (!data) {
                    show(testResult, "error", "테스트 중 오류가 발생했습니다.");
                    return;
                }
                if (data.valid) {
                    show(testResult, "success", "통과: " + sn);
                } else {
                    show(testResult, "error", "불합격: " + (data.message || "규칙에 맞지 않습니다."));
                }
            });
        }

        // -------------------------------------------------------------
        // 유틸
        // -------------------------------------------------------------

        function request(method, url, body, callback) {
            fetch(url, {
                method: method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            }).then(function (response) {
                return response.json().then(function (data) {
                    callback(response.ok, data);
                }).catch(function () {
                    callback(false, null);
                });
            }).catch(function () {
                callback(false, null);
            });
        }

        function show(box, kind, message) {
            if (!box) return;
            box.className = "status-message " + kind;
            box.textContent = message;
            box.hidden = false;
        }

        function hide(box) {
            if (box) box.hidden = true;
        }
    });
})();
