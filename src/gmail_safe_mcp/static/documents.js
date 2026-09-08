const documentForm = document.querySelector("#documentForm");
const documentNotice = document.querySelector("#documentNotice");
const workspace = document.querySelector("#extractionWorkspace");
const jsonEditor = document.querySelector("#extractedJson");
const extractedTable = document.querySelector("#extractedTable");
const enrichmentResult = document.querySelector("#enrichmentResult");
const metaTable = document.querySelector("#metaTable");
const copilotTokenDialog = document.querySelector("#copilotTokenDialog");
const basePath = document.documentElement.dataset.basePath || "";
const apiPath = path => `${basePath}${path}`;
let draft = null;
let generatedMeta = null;

const basicFieldLabels = {
  document_type: "문서 유형",
  title: "제목",
  date: "날짜",
  amount_candidates: "금액 후보",
  emails: "이메일",
  phone: "전화번호",
  ocr_line_count: "인식 문장 수"
};

function setDocumentNotice(message, isError = false, state = "progress") {
  documentNotice.textContent = message;
  documentNotice.classList.toggle("error", isError);
  documentNotice.classList.toggle("is-progress", !isError && state === "progress");
  documentNotice.classList.toggle("is-complete", !isError && state === "complete");
}

function flatten(value, prefix = "") {
  if (Array.isArray(value)) return [[prefix, value.join(", ")]];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => flatten(item, prefix ? `${prefix}.${key}` : key));
  }
  return [[prefix, value ?? ""]];
}

function renderTable(container, value, labels = {}) {
  container.replaceChildren();
  flatten(value).forEach(([key, item]) => {
    const row = document.createElement("div");
    const label = document.createElement("strong");
    const content = document.createElement("span");
    label.textContent = labels[key] || key;
    content.textContent = String(item);
    row.append(label, content);
    container.append(row);
  });
}

function renderBasicTable(value) {
  const basic = Object.fromEntries(
    Object.keys(basicFieldLabels).filter(key => value[key] !== undefined).map(key => [key, value[key]])
  );
  renderTable(extractedTable, basic, basicFieldLabels);
}

async function responseJson(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}

documentForm.addEventListener("submit", async event => {
  event.preventDefault();
  const formData = new FormData(documentForm);
  setDocumentNotice("Vision OCR로 문서를 분석하고 있습니다.");
  workspace.hidden = true;
  try {
    const data = await responseJson(await fetch(apiPath("/api/documents/extract"), { method: "POST", body: formData }));
    draft = data;
    generatedMeta = null;
    setDocumentNotice("요약을 생성하고 있습니다.");
    const summaryData = await responseJson(await fetch(apiPath("/api/documents/summary"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ original_name: data.original_name, extracted: data.extracted })
    }));
    setDocumentNotice("META를 생성하고 있습니다.");
    const metaData = await responseJson(await fetch(apiPath("/api/documents/meta"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ original_name: data.original_name, extracted: { ...data.extracted, summary: summaryData.summary } })
    }));
    generatedMeta = metaData.meta;
    data.extracted.summary = summaryData.summary;
    jsonEditor.value = JSON.stringify(data.extracted, null, 2);
    renderBasicTable(data.extracted);
    document.querySelector("#summaryText").textContent = summaryData.summary;
    renderTable(metaTable, metaData.meta);
    enrichmentResult.hidden = false;
    document.querySelector("#originalName").textContent = data.original_name;
    const isPdf = data.mime_type === "application/pdf";
    const pdfPreview = document.querySelector("#pdfPreview");
    const imagePreview = document.querySelector("#imagePreview");
    pdfPreview.hidden = !isPdf;
    imagePreview.hidden = isPdf;
    if (isPdf) pdfPreview.src = data.preview_url;
    else imagePreview.src = data.preview_url;
    workspace.hidden = false;
    setDocumentNotice("OCR, 요약 및 META 생성이 완료되었습니다. 내용을 확인한 뒤 저장하세요.", false, "complete");
  } catch (error) {
    setDocumentNotice(error.message, true);
  }
});

jsonEditor.addEventListener("input", () => {
  try { renderBasicTable(JSON.parse(jsonEditor.value)); } catch { /* Keep the last valid table while editing. */ }
});

document.querySelector("#saveDocument").addEventListener("click", async () => {
  try {
    const extracted = JSON.parse(jsonEditor.value);
    if (!extracted || Array.isArray(extracted) || typeof extracted !== "object") throw new Error("JSON 객체를 입력하세요.");
    if (!generatedMeta) throw new Error("먼저 OCR 후 자동 생성된 요약과 META를 확인하세요.");
    setDocumentNotice("DB에 저장하고 있습니다.");
    await responseJson(await fetch(apiPath("/api/documents"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        draft_id: draft.draft_id,
        original_name: draft.original_name,
        extracted: { ...extracted, ...(document.querySelector("#summaryText").textContent ? { summary: document.querySelector("#summaryText").textContent } : {}) },
        meta: generatedMeta
      })
    }));
    window.location.reload();
  } catch (error) {
    setDocumentNotice(error instanceof SyntaxError ? "JSON 형식을 확인하세요." : error.message, true);
  }
});

document.querySelectorAll(".meta-button").forEach(button => button.addEventListener("click", async () => {
  button.disabled = true;
  button.textContent = "생성 중";
  try {
    await responseJson(await fetch(apiPath(`/api/documents/${button.dataset.documentId}/meta`), { method: "POST" }));
    window.location.reload();
  } catch (error) {
    button.disabled = false;
    button.textContent = "META 생성";
    setDocumentNotice(error.message, true);
  }
}));

document.querySelectorAll(".delete-document").forEach(button => button.addEventListener("click", async () => {
  if (!window.confirm(`'${button.dataset.documentName}' 문서를 삭제할까요? 원본 파일과 DB 기록이 함께 삭제됩니다.`)) return;
  try {
    const response = await fetch(apiPath(`/api/documents/${button.dataset.documentId}`), { method: "DELETE" });
    await responseJson(response);
    button.closest(".document-row").remove();
  } catch (error) {
    setDocumentNotice(error.message, true);
  }
}));

document.querySelector("#copilotTokenButton").addEventListener("click", () => copilotTokenDialog.showModal());
document.querySelector("#cancelCopilotToken").addEventListener("click", () => copilotTokenDialog.close());
document.querySelector("#copilotTokenForm").addEventListener("submit", async event => {
  event.preventDefault();
  const notice = document.querySelector("#copilotTokenNotice");
  try {
    await responseJson(await fetch(apiPath("/api/copilot-token"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: document.querySelector("#copilotToken").value })
    }));
    copilotTokenDialog.close();
    window.location.reload();
  } catch (error) {
    notice.textContent = error.message;
    notice.classList.add("error");
  }
});