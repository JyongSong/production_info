document.addEventListener("DOMContentLoaded", () => {
    const settingsForm = document.getElementById("settingsForm");
    const firstQrLengthInput = document.getElementById("firstQrLength");
    const secondQrLengthInput = document.getElementById("secondQrLength");
    const saveSettingsButton = document.getElementById("saveSettingsButton");
    const refreshRecentButton = document.getElementById("refreshRecentButton");
    const recentTableBody = document.getElementById("recentTableBody");
    const todayCount = document.getElementById("todayCount");

    const searchForm = document.getElementById("searchForm");
    const searchFirstQrInput = document.getElementById("searchFirstQr");
    const searchSecondQrInput = document.getElementById("searchSecondQr");
    const searchDateInput = document.getElementById("searchDate");
    const resetSearchButton = document.getElementById("resetSearchButton");
    const downloadAllButton = document.getElementById("downloadAllButton");
    const downloadDateButton = document.getElementById("downloadDateButton");
    const searchSummary = document.getElementById("searchSummary");
    const searchTableBody = document.getElementById("searchTableBody");

    const editModal = document.getElementById("editModal");
    const editForm = document.getElementById("editForm");
    const editIdInput = document.getElementById("editId");
    const editFirstQrInput = document.getElementById("editFirstQr");
    const editSecondQrInput = document.getElementById("editSecondQr");
    const editOperatorNameInput = document.getElementById("editOperatorName");
    const editNoteInput = document.getElementById("editNote");
    const editMeta = document.getElementById("editMeta");
    const editMessage = document.getElementById("editMessage");
    const editSaveButton = document.getElementById("editSaveButton");
    const closeEditModalButton = document.getElementById("closeEditModalButton");
    const cancelEditButton = document.getElementById("cancelEditButton");

    const initialRecentMatches = JSON.parse(document.getElementById("initialRecentMatches").textContent);
    const initialQrSettings = JSON.parse(document.getElementById("initialQrSettings").textContent);

    let isUpdating = false;
    let isDeleting = false;
    let isSavingSettings = false;
    let recentMatches = initialRecentMatches;
    let searchResults = [];
    let searchWasRun = false;
    let qrSettings = normalizeQrSettings(initialQrSettings);

    renderTable(recentTableBody, recentMatches, "저장된 내역이 없습니다.");
    updateDownloadDateButton();
    syncSettingsInputs();

    window.qrDashboardHooks = {
        onSaveSuccess: async (data) => {
            recentMatches = data.recent_matches || [];
            renderTable(recentTableBody, recentMatches, "저장된 내역이 없습니다.");
            todayCount.textContent = data.today_count ?? "0";

            if (searchWasRun) {
                await searchMatches();
            }
        },
        onSaveError: (message) => {
            setStatus("error", message || "저장에 실패했습니다.");
        },
    };

    refreshRecentButton.addEventListener("click", async () => {
        await loadRecentMatches();
        setStatus("info", "최근 저장 내역을 새로 불러왔습니다.");
    });

    settingsForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        await saveQrSettings();
    });

    searchForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        await searchMatches();
    });

    resetSearchButton.addEventListener("click", () => {
        searchFirstQrInput.value = "";
        searchSecondQrInput.value = "";
        searchDateInput.value = "";
        searchResults = [];
        searchWasRun = false;
        updateDownloadDateButton();
        renderTable(searchTableBody, [], "검색 조건을 입력하고 조회해주세요.");
        searchSummary.textContent = "조회 조건이 초기화되었습니다.";
    });

    searchDateInput.addEventListener("change", updateDownloadDateButton);

    downloadAllButton.addEventListener("click", () => {
        window.location.href = "/download.xlsx";
    });

    downloadDateButton.addEventListener("click", () => {
        const targetDate = searchDateInput.value;
        if (!targetDate) {
            setStatus("warning", "날짜를 선택한 뒤 날짜별 다운로드를 눌러주세요.");
            return;
        }
        window.location.href = `/download.xlsx?date=${encodeURIComponent(targetDate)}`;
    });

    recentTableBody.addEventListener("click", (event) => {
        const editButton = event.target.closest("[data-edit-id]");
        const deleteButton = event.target.closest("[data-delete-id]");

        if (editButton) {
            openEditModal(Number(editButton.dataset.editId));
            return;
        }

        if (deleteButton) {
            deleteMatchRecord(Number(deleteButton.dataset.deleteId));
        }
    });

    searchTableBody.addEventListener("click", (event) => {
        const editButton = event.target.closest("[data-edit-id]");
        const deleteButton = event.target.closest("[data-delete-id]");

        if (editButton) {
            openEditModal(Number(editButton.dataset.editId));
            return;
        }

        if (deleteButton) {
            deleteMatchRecord(Number(deleteButton.dataset.deleteId));
        }
    });

    editForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        await submitEdit();
    });

    closeEditModalButton.addEventListener("click", closeEditModal);
    cancelEditButton.addEventListener("click", closeEditModal);

    editModal.addEventListener("click", (event) => {
        if (event.target === editModal) {
            closeEditModal();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !editModal.hidden) {
            closeEditModal();
        }
    });

    async function submitEdit() {
        if (isUpdating) {
            return;
        }

        const matchId = Number(editIdInput.value);
        const firstQr = editFirstQrInput.value.trim();
        const secondQr = editSecondQrInput.value.trim();
        const operatorName = editOperatorNameInput.value.trim();
        const note = editNoteInput.value.trim();

        if (!validatePair(firstQr, secondQr, setEditMessage)) {
            focusInvalidEditField(firstQr, secondQr);
            return;
        }

        isUpdating = true;
        editSaveButton.disabled = true;

        try {
            const response = await fetch(`/api/matches/${matchId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    first_qr: firstQr,
                    second_qr: secondQr,
                    operator_name: operatorName,
                    note: note,
                }),
            });

            const data = await readApiResponse(response);
            if (!response.ok) {
                setEditMessage("error", data.message || "수정에 실패했습니다.");
                return;
            }

            recentMatches = data.recent_matches || [];
            renderTable(recentTableBody, recentMatches, "저장된 내역이 없습니다.");
            todayCount.textContent = data.today_count ?? "0";
            setStatus("success", data.message || "수정이 완료되었습니다.");

            if (searchWasRun) {
                await searchMatches();
            }

            closeEditModal();
            const firstQrInput = document.getElementById("firstQr");
            if (firstQrInput) {
                firstQrInput.focus();
            }
        } catch (error) {
            setEditMessage("error", "수정 중 오류가 발생했습니다.");
        } finally {
            isUpdating = false;
            editSaveButton.disabled = false;
        }
    }

    function validatePair(firstQr, secondQr, messageSetter) {
        if (!validateSingleQr(firstQr, "Lumi SN", messageSetter)) {
            return false;
        }

        if (!validateSingleQr(secondQr, "Solity SN", messageSetter)) {
            return false;
        }

        if (firstQr === secondQr) {
            messageSetter("error", "동일한 값 2개는 한 세트로 저장할 수 없습니다.");
            return false;
        }

        return true;
    }

    function validateSingleQr(value, label, messageSetter) {
        const requiredLength = getRequiredLength(label);

        if (!value) {
            messageSetter("error", `${label}을(를) 입력해주세요.`);
            return false;
        }

        if (requiredLength > 0 && value.length !== requiredLength) {
            messageSetter("error", `${label}은(는) ${requiredLength}자리여야 합니다.`);
            return false;
        }

        if (requiredLength === 0 && value.length < 3) {
            messageSetter("error", `${label}은(는) 최소 3자 이상이어야 합니다.`);
            return false;
        }

        return true;
    }

    function focusInvalidEditField(firstQr, secondQr) {
        if (!isValidLength(firstQr, "Lumi SN")) {
            editFirstQrInput.focus();
            return;
        }

        editSecondQrInput.focus();
        editSecondQrInput.select();
    }

    async function saveQrSettings() {
        if (isSavingSettings) {
            return;
        }

        const firstQrLength = normalizeLengthValue(firstQrLengthInput.value);
        const secondQrLength = normalizeLengthValue(secondQrLengthInput.value);

        if (firstQrLength === null || secondQrLength === null) {
            setStatus("error", "자릿수는 0 이상의 숫자로 입력해주세요.");
            return;
        }

        isSavingSettings = true;
        saveSettingsButton.disabled = true;

        try {
            const response = await fetch("/api/settings", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    first_qr_length: firstQrLength,
                    second_qr_length: secondQrLength,
                }),
            });

            const data = await readApiResponse(response);
            if (!response.ok) {
                setStatus("error", data.message || "SN 자릿수 저장에 실패했습니다.");
                return;
            }

            qrSettings = normalizeQrSettings(data.settings || {});
            syncSettingsInputs();

            if (window.qrScanCore && typeof window.qrScanCore.setQrSettings === "function") {
                window.qrScanCore.setQrSettings(qrSettings);
            }

            setStatus("success", data.message || "SN 자릿수 설정이 저장되었습니다.");
        } catch (error) {
            setStatus("error", "SN 자릿수 저장 중 오류가 발생했습니다.");
        } finally {
            isSavingSettings = false;
            saveSettingsButton.disabled = false;
        }
    }

    async function deleteMatchRecord(matchId) {
        const match = findMatchById(matchId);
        const qrPreview = match ? `${match.first_qr} / ${match.second_qr}` : `${matchId}번`;

        if (isDeleting) {
            return;
        }

        if (!window.confirm(`선택한 내역을 삭제할까요?\n${qrPreview}`)) {
            return;
        }

        isDeleting = true;

        try {
            const response = await fetch(`/api/matches/${matchId}`, {
                method: "DELETE",
            });
            const data = await readApiResponse(response);

            if (!response.ok) {
                setStatus("error", data.message || "삭제에 실패했습니다.");
                return;
            }

            recentMatches = data.recent_matches || [];
            renderTable(recentTableBody, recentMatches, "저장된 내역이 없습니다.");
            todayCount.textContent = data.today_count ?? "0";
            setStatus("success", data.message || "삭제가 완료되었습니다.");

            if (searchWasRun) {
                await searchMatches();
            }

            if (!editModal.hidden && Number(editIdInput.value) === matchId) {
                closeEditModal();
            }
        } catch (error) {
            setStatus("error", "삭제 중 오류가 발생했습니다.");
        } finally {
            isDeleting = false;
        }
    }

    async function loadRecentMatches() {
        try {
            const response = await fetch("/api/recent");
            const data = await readApiResponse(response);
            recentMatches = data.recent_matches || [];
            renderTable(recentTableBody, recentMatches, "저장된 내역이 없습니다.");
            todayCount.textContent = data.today_count ?? "0";
        } catch (error) {
            setStatus("error", "최근 내역을 불러오지 못했습니다.");
        }
    }

    async function searchMatches() {
        const params = new URLSearchParams({
            first_qr: searchFirstQrInput.value.trim(),
            second_qr: searchSecondQrInput.value.trim(),
            date: searchDateInput.value,
        });

        try {
            const response = await fetch(`/api/search?${params.toString()}`);
            const data = await readApiResponse(response);

            if (!response.ok) {
                setStatus("error", data.message || "조회 중 오류가 발생했습니다.");
                return;
            }

            searchResults = data.matches || [];
            searchWasRun = true;
            renderTable(searchTableBody, searchResults, "조회 결과가 없습니다.");
            searchSummary.textContent = `조회 결과 ${data.count ?? 0}건`;
        } catch (error) {
            setStatus("error", "조회 중 오류가 발생했습니다.");
        }
    }

    function renderTable(targetBody, rows, emptyMessage) {
        targetBody.innerHTML = "";

        if (!rows.length) {
            const emptyRow = document.createElement("tr");
            emptyRow.className = "empty-row";
            emptyRow.innerHTML = `<td colspan="7">${emptyMessage}</td>`;
            targetBody.appendChild(emptyRow);
            return;
        }

        rows.forEach((row) => {
            const tr = document.createElement("tr");
            const values = [
                row.id,
                row.first_qr,
                row.second_qr,
                row.created_at,
                row.operator_name || "-",
                row.note || "-",
            ];

            values.forEach((value) => {
                const td = document.createElement("td");
                td.textContent = value;
                tr.appendChild(td);
            });

            const actionTd = document.createElement("td");
            actionTd.className = "table-action-cell";
            actionTd.innerHTML = `
                <div class="table-action-group">
                    <button class="table-action-button" type="button" data-edit-id="${row.id}">수정</button>
                    <button class="table-action-button delete-button" type="button" data-delete-id="${row.id}">삭제</button>
                </div>
            `;
            tr.appendChild(actionTd);
            targetBody.appendChild(tr);
        });
    }

    function openEditModal(matchId) {
        const match = findMatchById(matchId);
        if (!match) {
            setStatus("error", "수정할 데이터를 찾을 수 없습니다.");
            return;
        }

        editIdInput.value = String(match.id);
        editFirstQrInput.value = match.first_qr;
        editSecondQrInput.value = match.second_qr;
        editOperatorNameInput.value = match.operator_name || "";
        editNoteInput.value = match.note || "";
        editMeta.textContent = `등록일시: ${match.created_at}`;
        setEditMessage("info", "수정할 내용을 입력한 뒤 저장해주세요.");
        editModal.hidden = false;
        document.body.style.overflow = "hidden";
        editFirstQrInput.focus();
        editFirstQrInput.select();
    }

    function closeEditModal() {
        editModal.hidden = true;
        document.body.style.overflow = "";
        editForm.reset();
        setEditMessage("info", "수정할 내용을 입력한 뒤 저장해주세요.");
    }

    function findMatchById(matchId) {
        return recentMatches.find((item) => item.id === matchId)
            || searchResults.find((item) => item.id === matchId);
    }

    function setStatus(type, message) {
        if (window.qrScanCore && typeof window.qrScanCore.setStatus === "function") {
            window.qrScanCore.setStatus(type, message);
            return;
        }

        const statusMessage = document.getElementById("statusMessage");
        if (!statusMessage) {
            return;
        }
        statusMessage.className = `status-message ${type}`;
        statusMessage.textContent = message;
    }

    async function readApiResponse(response) {
        const contentType = response.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
            try {
                return await response.json();
            } catch (error) {
                return {
                    message: fallbackApiMessage(response.status, ""),
                };
            }
        }

        const text = (await response.text()).trim();
        return {
            message: fallbackApiMessage(response.status, text),
        };
    }

    function fallbackApiMessage(status, text) {
        if (status === 404 || status === 405) {
            return "서버가 최신 기능으로 다시 실행되지 않았습니다. QR 툴을 종료한 뒤 다시 실행해주세요.";
        }

        if (status >= 500) {
            return "서버 처리 중 오류가 발생했습니다. QR 툴을 다시 실행한 뒤 다시 시도해주세요.";
        }

        if (!text) {
            return "";
        }

        if (text.length > 160) {
            return `${text.slice(0, 160)}...`;
        }

        return text;
    }

    function getRequiredLength(label) {
        if (label === "Lumi SN") {
            return qrSettings.first_qr_length;
        }

        return qrSettings.second_qr_length;
    }

    function isValidLength(value, label) {
        const trimmedValue = String(value || "").trim();
        const requiredLength = getRequiredLength(label);

        if (!trimmedValue) {
            return false;
        }

        if (requiredLength > 0) {
            return trimmedValue.length === requiredLength;
        }

        return trimmedValue.length >= 3;
    }

    function normalizeLengthValue(value) {
        const text = String(value ?? "").trim();
        if (!text) {
            return 0;
        }

        const parsed = Number.parseInt(text, 10);
        if (!Number.isFinite(parsed) || parsed < 0) {
            return null;
        }

        return parsed;
    }

    function normalizeQrSettings(settings) {
        return {
            first_qr_length: normalizeLengthValue(settings.first_qr_length) ?? 0,
            second_qr_length: normalizeLengthValue(settings.second_qr_length) ?? 0,
        };
    }

    function syncSettingsInputs() {
        firstQrLengthInput.value = String(qrSettings.first_qr_length);
        secondQrLengthInput.value = String(qrSettings.second_qr_length);
    }

    function setEditMessage(type, message) {
        editMessage.className = `inline-message ${type}`;
        editMessage.textContent = message;
    }

    function updateDownloadDateButton() {
        downloadDateButton.disabled = !searchDateInput.value;
    }
});
