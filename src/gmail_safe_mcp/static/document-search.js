const documentSearchForm = document.querySelector("#documentSearchForm");
const documentQuery = document.querySelector("#documentQuery");
const documentSearchNotice = document.querySelector("#documentSearchNotice");
const documentResults = document.querySelector("#documentResults");
const documentResultCount = document.querySelector("#documentResultCount");
const documentResultList = document.querySelector("#documentResultList");
const basePath = document.documentElement.dataset.basePath || "";
const apiPath = path => `${basePath}${path}`;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderHighlightedSnippet(container, text, query) {
  container.replaceChildren();
  const terms = [...new Set(query.split(/\s+/).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!terms.length) { container.textContent = text; return; }
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) container.append(document.createTextNode(text.slice(lastIndex, match.index)));
    const strong = document.createElement("strong");
    strong.textContent = match[0];
    container.append(strong);
    lastIndex = match.index + match[0].length;
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  if (lastIndex < text.length) container.append(document.createTextNode(text.slice(lastIndex)));
}

documentSearchForm.addEventListener("submit", async event => {
  event.preventDefault();
  const query = documentQuery.value.trim();
  if (!query) return;
  documentSearchNotice.textContent = "BM25로 문서를 검색하고 있습니다.";
  documentSearchNotice.classList.remove("error");
  documentResults.hidden = true;
  try {
    const response = await fetch(apiPath("/api/document-search"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "문서 검색에 실패했습니다.");
    documentResultList.replaceChildren();
    data.results.forEach(result => {
      const article = document.createElement("article");
      article.className = "search-result-row";
      const heading = document.createElement("h3");
      const link = document.createElement("a");
      link.href = apiPath(`/documents/${result.document_id}`);
      link.textContent = result.filename;
      heading.append(link);
      const snippet = document.createElement("p");
      renderHighlightedSnippet(snippet, result.snippet, query);
      const source = document.createElement("span");
      source.className = "result-source";
      source.textContent = `${result.source} · BM25 ${result.score}`;
      article.append(heading, snippet, source);
      documentResultList.append(article);
    });
    documentResultCount.textContent = `${data.results.length}개 결과 · 출처와 관련 문장을 함께 표시합니다.`;
    documentResults.hidden = false;
    documentSearchNotice.textContent = data.results.length ? "검색이 완료되었습니다." : "일치하는 문서가 없습니다.";
  } catch (error) {
    documentSearchNotice.textContent = error.message;
    documentSearchNotice.classList.add("error");
  }
});