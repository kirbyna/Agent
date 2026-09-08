# Gmail Safe MCP

개인 Gmail에서 발신자 또는 키워드로 메일을 검색하고, 사용자가 선택한 메일만 휴지통으로 이동하는 로컬 웹 앱 겸 MCP 서버입니다.

## 안전 원칙

- OAuth 범위는 `gmail.modify`만 사용합니다.
- 영구 삭제 API는 구현하지 않습니다.
- 검색 결과는 발신자, 제목, 날짜만 가져오며 본문은 읽지 않습니다.
- 한 번에 최대 20개만 조회하고 처리합니다.
- 최근 10분 안에 미리 본 메일 ID만 휴지통으로 이동할 수 있습니다.
- 휴지통 이동에는 `TRASH N` 확인 문구와 VS Code 도구 승인이 모두 필요합니다.
- OAuth 토큰은 macOS Keychain에 저장됩니다.

## 실행 환경

Python 3.11 이상이 필요합니다. Ubuntu 22.04 OCI 인스턴스에서는 `python3.11`과 `python3.11-venv` 패키지를 사용하세요.

## Google OAuth 준비

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 만듭니다.
2. Gmail API를 활성화합니다.
3. Google 인증 플랫폼에서 OAuth 동의 화면을 구성합니다. 개인 사용이라면 앱을 테스트 상태로 두고 본인 Gmail을 테스트 사용자로 추가합니다.
4. 데이터 액세스에 `https://www.googleapis.com/auth/gmail.modify` 범위를 추가합니다.
5. OAuth 클라이언트를 **데스크톱 앱** 유형으로 만듭니다.
6. JSON을 내려받아 저장소 밖의 개인 폴더에 보관하고 권한을 제한합니다.

```bash
mkdir -p ~/.config/gmail-safe-mcp
mv ~/Downloads/client_secret_*.json ~/.config/gmail-safe-mcp/credentials.json
chmod 600 ~/.config/gmail-safe-mcp/credentials.json
```

OAuth JSON과 토큰 파일은 `.gitignore`에 포함되어 있으므로 Git에 커밋하지 마세요.

## 웹 앱 실행

OAuth JSON을 준비한 뒤 터미널에서 실행합니다.

```bash
.venv/bin/gmail-safe-web
```

브라우저에서 [http://127.0.0.1:8765](http://127.0.0.1:8765)를 엽니다. 서버는 이 Mac에서만 접근 가능한 주소로 실행됩니다.

1. 오른쪽 위 `로그인`을 누르고 Google 로그인을 승인합니다.
2. 키워드 또는 발송인 이메일을 입력하고 `메일 확인`을 누릅니다.
3. 결과 왼쪽 체크박스로 메일을 선택합니다.
4. `선택 항목 휴지통으로`를 누릅니다.
5. 화면에 표시된 `TRASH N` 문구를 입력해 최종 확인합니다.

상단 `Agent 관리`에서 VS Code에 등록된 Agent 목록을 볼 수 있습니다. `Gmail Cleaner`의 `실행` 버튼은 메일 정리 화면을 엽니다. 다른 Agent는 보안을 위해 웹에서 임의 실행하지 않습니다.

## 문서 Vision OCR

상단 `문서 추출` 또는 Agent 관리의 `문서 Vision OCR`을 선택합니다.

1. PDF, JPG, JPEG 또는 PNG 파일을 선택하고 `Vision OCR 실행`을 누릅니다. PDF는 최대 10페이지까지 Copilot Vision에 페이지 순서대로 전달됩니다.
2. 왼쪽 원본과 오른쪽 추출 표 및 JSON을 비교합니다.
2. OCR 완료 후 요약과 META가 자동 생성됩니다.
3. 왼쪽 원본과 오른쪽 기본 정보, 요약, META 및 JSON을 확인하고 필요한 경우 JSON을 수정합니다.
4. `DB에 저장`을 눌러 확인한 내용과 META를 저장합니다.

저장목록에서 문서 제목 또는 `상세 보기`를 누르면 상세 화면으로 이동합니다. 왼쪽에는 저장된 원본, 오른쪽에는 기본 추출 내용, 저장된 요약과 META JSON 및 내용 JSON 편집기가 표시됩니다. `내용 및 META 저장`으로 수정 내용을 반영하고, `JSON 편집`을 누르면 새 문서를 추출·편집하는 화면으로 돌아갑니다.

원본과 SQLite DB는 `~/Library/Application Support/GmailSafe`에 저장됩니다. 파일은 최대 15MB, PDF는 최대 10페이지까지 처리합니다. PDF 각 페이지는 임시 PNG로 변환되어 Copilot Vision 모델에 함께 전달되고 처리 후 임시 파일은 삭제됩니다. OCR, 요약, META는 GitHub Copilot SDK가 처리하며 이미지와 OCR 요청이 Copilot 서비스로 전송됩니다. 문서 화면의 `Copilot PAT 설정`에 GitHub Copilot 사용 권한이 있는 `github_pat_` Fine-grained PAT를 입력하면 macOS Keychain에 저장됩니다. PAT는 브라우저나 저장소에 노출하지 마세요.

## VS Code Agent로 연결하기

1. VS Code를 다시 로드합니다.
2. 명령 팔레트에서 `MCP: List Servers`를 실행하고 `gmailSafe`를 시작합니다.
3. 처음 시작할 때 OAuth JSON 경로로 `~/.config/gmail-safe-mcp/credentials.json`을 입력합니다.
4. Chat의 Agent 선택 메뉴에서 `Gmail Cleaner`를 선택합니다.
5. `Gmail에 연결해 줘`라고 요청하고 브라우저에서 Google 로그인을 승인합니다.

## Agent 사용 예

```text
sender@example.com이 보낸 메일을 찾아줘
제목에 invoice가 포함된 메일을 찾아줘
목록의 2번과 4번을 휴지통으로 이동해 줘
TRASH 2
```

마지막 도구 승인 창에서 대상 ID와 개수를 확인한 뒤 허용하세요. 휴지통의 메일은 Gmail에서 복구할 수 있습니다.

## 관리

- Agent 목록 및 편집: `Chat: Open Customizations` 또는 `/agents`
- MCP 시작, 중지 및 로그: `MCP: List Servers`
- MCP 설정: `MCP: Open User Configuration`
- Gmail 연결 해제: Agent에게 `Gmail 연결을 해제해 줘` 요청
- 개발 테스트: `.venv/bin/python -m unittest discover -s tests -v`

## 문서 BM25 검색

상단 `문서 검색` 또는 Agent 관리의 `문서 BM25 검색`을 선택합니다. 검색 대상은 파일명, OCR 원문, 추출 JSON, 요약, META이며 결과에는 관련 snippet, BM25 점수, 문서 ID와 출처가 표시됩니다. 한국어는 `kiwipiepy` Kiwi 형태소 분석으로 명사·동사·형용사와 영문·숫자를 추출한 뒤 BM25에 입력합니다.

현재 데이터 구조는 RAG 확장을 고려해 다음처럼 분리되어 있습니다.

```text
documents
	id, original_name, extracted_json, meta_json, search_text, content_hash, schema_version
		1:N
document_chunks
	id, document_id, chunk_index, page_number, text, embedding_json, embedding_model
```

현재 BM25는 문서마다 통합 텍스트 1개 chunk를 사용합니다. 다음 단계에서는 `document_chunks`를 페이지/문단 단위로 나누고 `embedding_json`과 `embedding_model`을 채운 뒤, BM25 후보 검색과 embedding 유사도 검색을 결합합니다. 모든 결과는 `document_id`, `chunk_index`, `page_number`를 통해 원본 출처로 연결합니다. 즉 Kiwi 토큰화는 lexical 검색 단계에만 사용되고, RAG의 embedding 원문은 chunk의 `text`를 그대로 사용합니다.

## OCI 문서 웹 데모

Gmail Agent를 제외하고 문서 추출과 문서 검색만 OCI에서 제공하려면 앱을 `/agent` 하위 경로로 실행합니다. OCI VM에서 저장소를 받은 뒤 의존성을 설치하고 최신 소스가 사용되도록 editable 설치를 수행합니다.

```bash
.venv/bin/pip install -e .
export APP_BASE_PATH=/agent
export DOCUMENT_ONLY=1
export HOST=127.0.0.1
export PORT=8765
export COPILOT_GITHUB_TOKEN='github_pat_...'
.venv/bin/python -m gmail_safe_mcp.web
```

Nginx 설정은 `deploy/gmail-safe-agent.nginx.conf`를 사용합니다. 이 설정을 `/etc/nginx/conf.d/gmail-safe-agent.conf`에 복사한 뒤 `sudo nginx -t && sudo systemctl reload nginx`를 실행하면 다음 주소로 접근할 수 있습니다.

```text
http://OCI_PUBLIC_IP/agent/
http://OCI_PUBLIC_IP/agent/documents
http://OCI_PUBLIC_IP/agent/document-search
```

OCI 보안 목록과 VM 방화벽에서는 HTTP 80을 허용해야 합니다. 외부 공개 운영 시에는 공인 IP 대신 도메인과 HTTPS를 사용하세요. PAT는 저장소나 채팅에 기록하지 말고 OCI Vault 또는 프로세스 환경변수로만 주입합니다.

웹 데모에서는 Copilot SDK 호출을 `streaming=False`로 실행하므로 중간 응답을 화면에 출력하지 않고 최종 JSON 결과만 반환합니다. VS Code Chat의 도구 승인 창을 매번 건너뛰는 `Bypass Approvals` 또는 `Autopilot`은 이 웹 서버와 별개의 기능이며, 모든 도구를 승인할 수 있으므로 사용하지 않는 편이 안전합니다.

## 자동 승인

개발 중에는 Chat의 권한 선택기에서 현재 세션에 한해 안전한 파일 편집과 테스트 명령을 승인할 수 있습니다. `Bypass Approvals` 또는 `Autopilot`은 모든 도구 호출을 승인하므로 Gmail Agent에는 사용하지 마세요. 특히 `trash_selected_mail`은 항상 수동 승인을 유지하세요.

MCP 샌드박스를 켜면 해당 서버의 도구 호출이 자동 승인됩니다. 이 서버는 macOS Keychain과 Google OAuth 브라우저 흐름을 사용하고 파괴적 도구를 포함하므로 MCP 샌드박스를 의도적으로 활성화하지 않았습니다.
