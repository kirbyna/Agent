const searchForm = document.querySelector("#searchForm");
const notice = document.querySelector("#notice");
const resultsSection = document.querySelector("#resultsSection");
const resultBody = document.querySelector("#resultBody");
const resultCount = document.querySelector("#resultCount");
const selectAll = document.querySelector("#selectAll");
const trashButton = document.querySelector("#trashButton");
const confirmDialog = document.querySelector("#confirmDialog");
const confirmForm = document.querySelector("#confirmForm");
const confirmation = document.querySelector("#confirmation");
const connectButton = document.querySelector("#connectButton");
const disconnectButton = document.querySelector("#disconnectButton");
const setupDialog = document.querySelector("#setupDialog");
const setupForm = document.querySelector("#setupForm");
const setupNotice = document.querySelector("#setupNotice");
const logoutDialog = document.querySelector("#logoutDialog");
const logoutForm = document.querySelector("#logoutForm");
let previewToken = "";

function selectedIds() {
  return [...document.querySelectorAll(".message-check:checked")].map(input => input.value);
}

function updateSelection() {
  const checks = [...document.querySelectorAll(".message-check")];
  const count = selectedIds().length;
  trashButton.disabled = count === 0;
  trashButton.textContent = count ? `선택 ${count}개 휴지통으로` : "선택 항목 휴지통으로";
  selectAll.checked = checks.length > 0 && count === checks.length;
  selectAll.indeterminate = count > 0 && count < checks.length;
}

function setNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle("error", isError);
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}

searchForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const keyword = document.querySelector("#keyword").value.trim();
  const sender = document.querySelector("#sender").value.trim();
  if (!keyword && !sender) return setNotice("키워드 또는 발송인 이메일을 입력하세요.", true);
  setNotice("메일을 검색하고 있습니다.");
  resultBody.replaceChildren();
  resultsSection.hidden = true;
  try {
    const data = await postJson("/api/search", { keyword, sender });
    previewToken = data.preview_token;
    searchForm.reset();
    data.messages.forEach(message => {
      const row = document.createElement("tr");
      const checkCell = document.createElement("td");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "message-check";
      check.value = message.id;
      check.setAttribute("aria-label", `${message.subject || "제목 없음"} 선택`);
      check.addEventListener("change", updateSelection);
      checkCell.append(check);
      row.append(checkCell);
      [message.from, message.subject || "(제목 없음)", message.date].forEach(value => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      });
      resultBody.append(row);
    });
    resultCount.textContent = `${data.count}개 메일 · 미리보기는 10분간 유효`;
    resultsSection.hidden = false;
    updateSelection();
    setNotice(data.count ? "검색이 완료되었습니다." : "조건에 맞는 메일이 없습니다.");
  } catch (error) {
    setNotice(error.message, true);
  }
});

selectAll?.addEventListener("change", () => {
  document.querySelectorAll(".message-check").forEach(check => { check.checked = selectAll.checked; });
  updateSelection();
});

trashButton?.addEventListener("click", () => {
  const count = selectedIds().length;
  document.querySelector("#selectedCount").textContent = `${count}개`;
  document.querySelector("#confirmPhrase").textContent = `TRASH ${count}`;
  confirmation.value = "";
  confirmDialog.showModal();
});

confirmForm?.addEventListener("submit", async event => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  const messageIds = selectedIds();
  const expected = `TRASH ${messageIds.length}`;
  if (confirmation.value !== expected) return confirmation.setCustomValidity(`${expected}을 정확히 입력하세요.`), confirmation.reportValidity();
  confirmation.setCustomValidity("");
  try {
    const data = await postJson("/api/trash", {
      preview_token: previewToken,
      message_ids: messageIds,
      confirmation: confirmation.value
    });
    confirmDialog.close();
    messageIds.forEach(id => document.querySelector(`.message-check[value="${CSS.escape(id)}"]`)?.closest("tr")?.remove());
    resultCount.textContent = `${resultBody.children.length}개 메일`;
    updateSelection();
    setNotice(`${data.count}개 메일을 휴지통으로 이동했습니다.`);
  } catch (error) {
    confirmDialog.close();
    setNotice(error.message, true);
  }
});

confirmation?.addEventListener("input", () => confirmation.setCustomValidity(""));

connectButton?.addEventListener("click", async () => {
  setNotice("Google 로그인 페이지로 이동하는 중입니다.");
  try {
    const data = await postJson("/api/connect");
    window.location.assign(data.authorization_url);
  } catch (error) {
    if (error.message.includes("GMAIL_OAUTH_CLIENT_FILE")) {
      setNotice("먼저 Google OAuth JSON을 등록하세요.", true);
      setupDialog.showModal();
    } else {
      setNotice(error.message, true);
    }
  }
});

disconnectButton?.addEventListener("click", () => logoutDialog.showModal());

logoutForm?.addEventListener("submit", async event => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  try {
    await postJson("/api/disconnect");
    logoutDialog.close();
    window.location.assign("/");
  } catch (error) {
    logoutDialog.close();
    setNotice(error.message, true);
  }
});

const oauthResult = new URLSearchParams(window.location.search).get("oauth");
if (oauthResult === "connected") setNotice("Gmail 로그인이 완료되었습니다.");
if (oauthResult === "denied") setNotice("Google 로그인이 취소되었습니다.", true);
if (oauthResult === "expired") setNotice("로그인 요청이 만료되었습니다. 다시 로그인하세요.", true);
if (oauthResult === "failed") setNotice("Google 로그인 처리에 실패했습니다. OAuth 설정을 확인하세요.", true);

document.querySelector("#cancelSetup")?.addEventListener("click", () => setupDialog.close());

setupForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const formData = new FormData(setupForm);
  setupNotice.textContent = "OAuth 파일을 확인하고 있습니다.";
  setupNotice.classList.remove("error");
  try {
    const uploadResponse = await fetch("/api/oauth-client", { method: "POST", body: formData });
    const uploadData = await uploadResponse.json();
    if (!uploadResponse.ok) throw new Error(uploadData.error || "OAuth 파일을 등록하지 못했습니다.");
    setupNotice.textContent = "등록 완료. Google 로그인 창을 여는 중입니다.";
    const data = await postJson("/api/connect");
    window.location.assign(data.authorization_url);
  } catch (error) {
    setupNotice.textContent = error.message;
    setupNotice.classList.add("error");
  }
});