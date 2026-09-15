# iOS 빌드 가이드 (Mac 전용)

이 저장소는 Linux 컨테이너에서 개발되어 Capacitor로 iOS 프로젝트(`ios/`)까지
생성해뒀지만, 실제 컴파일·시뮬레이터/실기기 실행은 **Xcode가 설치된 Mac에서만**
가능합니다. 아래 순서대로 진행하세요.

## 0. 준비물

- macOS + Xcode (App Store에서 설치, 무료)
- Apple ID (무료 계정으로도 시뮬레이터 실행/실기기 임시 설치까지는 가능)
- 실제 App Store 배포에는 Apple Developer Program 가입 필요 (연 $99)
- Node.js 20+ (`node -v`로 확인)

## 1. 저장소 클론 후 의존성 설치

```bash
git clone <이 저장소 URL>
cd spider-solitaire
npm install
```

## 2. 웹 빌드 → iOS 프로젝트에 동기화

웹 코드(`src/`, `index.html`)를 수정할 때마다 아래 명령으로 iOS 프로젝트에 반영해야
Xcode에서 최신 내용이 보입니다.

```bash
npm run cap:sync
```

내부적으로 `vite build`(→ `dist/`) 후 `cap sync ios`(→ `ios/App/App/public/`)를
실행합니다.

## 3. Xcode에서 열기

```bash
npm run cap:open
```

또는 Finder에서 `ios/App/App.xcodeproj`를 더블클릭.

Capacitor 8은 CocoaPods 대신 **Swift Package Manager**를 쓰므로 `pod install`이
필요 없습니다 — Xcode가 열리면서 자동으로 패키지를 resolve합니다.

## 4. Bundle ID / 서명 설정

`capacitor.config.ts`의 `appId`를 `com.kirbyna.spidersolitaire`로 임시 지정해뒀습니다.
**App Store에 올리려면 본인 소유의 고유한 역도메인 ID로 바꿔야 합니다** (예:
`com.yourname.spidersolitaire`). 변경 후 `npm run cap:sync`로 다시 반영하세요.

Xcode에서:
1. 좌측 네비게이터에서 `App` 프로젝트 선택 → `Signing & Capabilities` 탭
2. `Team`에 본인 Apple ID 선택 (Xcode → Settings → Accounts에서 먼저 로그인)
3. Bundle Identifier가 위에서 설정한 appId와 일치하는지 확인

## 5. 시뮬레이터/실기기 실행

상단 기기 선택 드롭다운에서 iPhone 시뮬레이터 선택 후 ▶ 실행.
실기기 테스트는 케이블 연결 후 같은 방식으로 기기를 선택하면 됩니다 (무료 계정은
7일마다 재서명 필요).

## 6. 아직 안 되어 있는 것 (배포 전 필수)

- **앱 아이콘**: `ios/App/App/Assets.xcassets/AppIcon.appiconset`가 비어 있습니다.
  1024×1024 아이콘 이미지를 준비해 Xcode의 Assets 편집기로 채워야 합니다.
- **스플래시 화면**: `Splash.imageset`도 기본값(빈 화면)입니다. 원하면 로고/배경을 추가하세요.
- **개인정보처리방침 URL**: App Store Connect 제출 시 필요 (로컬 저장만 쓰고
  서버로 데이터를 보내지 않는 앱이라 내용은 간단하게 작성 가능).
- **스크린샷**: 심사 제출용 기기별 스크린샷 (Xcode 시뮬레이터에서 캡처 가능).
- **TestFlight**: Xcode → Product → Archive → Distribute App → TestFlight 업로드.

## 참고: 왜 Linux에서 여기까지만 했나

`npx cap add ios`는 순수 Node.js로 템플릿을 복사하는 작업이라 Linux에서도
실행됐지만, 실제 컴파일(`xcodebuild`)은 Xcode 툴체인이 필요해 macOS 전용입니다.
이 저장소의 `ios/` 폴더 구조와 `capacitor.config.json` 연동은 이미 검증됐으니,
Mac에서는 위 3~5단계만 따라가면 됩니다.
