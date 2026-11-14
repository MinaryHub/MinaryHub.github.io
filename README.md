# MinaryHub.github.io

MinaryHub 공개 저장소를 소개하고 최신 빌드를 내려받는 페이지입니다. → https://minaryhub.github.io

## 동작 방식

- `.github/workflows/pages.yml`이 **3시간마다 / main 푸시 시 / 수동 실행 시** `scripts/fetch-data.mjs`를 돌려
  조직의 공개 저장소와 각 저장소의 최신 릴리스를 `data/repos.json`으로 만들고 Pages에 배포합니다.
- 방문자 브라우저는 이 JSON만 읽으므로 **GitHub API 60회 제한에 걸리지 않습니다.**
  (JSON이 없을 때만 API를 직접 호출하며, 결과를 30분간 캐시합니다.)
- 방문자의 OS를 감지해 맞는 파일을 파란 버튼으로 먼저 보여 주고, 나머지는 "다른 플랫폼"에 접어 둡니다.
- 새 public 저장소를 만들거나 릴리스를 올리면 다음 갱신 때 자동으로 반영됩니다.

## 처음 설정 (1회)

1. 조직에 **public** 저장소 `MinaryHub.github.io`를 만들고 이 폴더의 파일을 그대로 푸시합니다.
2. 저장소 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 바꿉니다.
3. **Actions** 탭에서 `Build & Deploy Pages` → **Run workflow**로 첫 배포를 합니다.

## 설정 (`config.json`)

```json
{
  "title": "MinaryHub",
  "tagline": "페이지 상단 소개 문구",
  "hide": ["linkboard-device-sim"],
  "order": ["HanEng", "Kerminal.Release"],
  "overrides": {
    "Kerminal.Release": { "displayName": "Kerminal", "description": "설명 덮어쓰기" }
  }
}
```

| 키 | 의미 |
|---|---|
| `hide` | 목록에서 숨길 저장소 이름 (`.github`, 이 저장소는 자동 제외) |
| `order` | 맨 앞에 고정할 순서. 나머지는 "릴리스 있음 → 최신순" |
| `overrides` | 표시 이름·설명·홈페이지·아이콘·스크린샷·`web`(웹 앱 주소) 덮어쓰기 |
| `apps` | GitHub 공개 저장소 없이 직접 등록하는 앱 (웹 앱, 비공개 저장소의 앱 등) |
| `taglineEn` | 영어 화면의 소개 문구 (`tagline`은 한국어) |

### 한/영 전환

페이지 오른쪽 위 **EN / 한국어** 버튼으로 바꿉니다. 기본은 영어이고, 고른 언어는 브라우저에 기억됩니다.
주소에 `?lang=ko` / `?lang=en`을 붙여 바로 열 수도 있습니다.

`overrides`와 `apps` 항목에 언어별 값을 넣으면 그 언어에서 우선 쓰입니다. 없으면 기본 값(GitHub 설명 등)을 그대로 보여 줍니다.

```json
"DoNotDisturb": {
  "displayName": "방해 금지 모드",
  "displayNameEn": "Do Not Disturb",
  "descriptionEn": "English description",
  "descriptionKo": "한국어 설명 (GitHub 설명이 영어일 때)"
}
```

### 저장소 없이 앱 추가하기 (`apps`)

```json
"apps": [
  {
    "name": "Dotty",
    "description": "앱 설명",
    "web": "https://apps.kimserv.com/dotty/",
    "icon": "icons/dotty.png",
    "language": "Dart",
    "topics": ["flutter"],
    "updated": "2026-10-24"
  }
]
```

- `web`이 있으면 카드에 **웹에서 바로 실행** 버튼이 나옵니다.
- `icon`·`screenshots`는 URL 또는 이 저장소 안의 경로(`icons/`, `screenshots/<이름>/`)를 씁니다.
- `updated`는 정렬(릴리스 없는 항목 사이 최신순)에 쓰입니다. GitHub 별 버튼은 표시되지 않습니다.

저장소 설명/토픽은 각 저장소의 About(⚙)에서 고치면 자동 반영됩니다.

## 스크린샷

카드의 스크린샷은 아래 순서로 정합니다.

1. `config.json` `overrides.<저장소>.screenshots` (직접 고른 목록 — 이것만은 페이지가 바꾸지 않음)
2. **앱 저장소의 `screenshots/` 폴더** — 방문자가 페이지를 열 때마다 GitHub에서 다시 읽으므로(10분 캐시)
   이미지를 올리거나 바꾸면 사이트를 다시 배포하지 않아도 바로 반영됩니다. 파일 이름 순서대로 보입니다.
   `screenshots/en/`, `screenshots/ko/`가 있으면 화면 언어에 맞는 폴더를 씁니다.
3. 이 사이트의 `screenshots/<저장소>/`, 저장소의 `docs/images/` 등, README 이미지 (배포 때 수집)

## 앱 소개 페이지의 '주요 기능'

`overrides.<앱>`(또는 `apps` 항목)에 `featuresEn`·`featuresKo`로 목록을 적으면 앱 소개 페이지(`/apps/<앱>/`)에
"Features / 주요 기능" 목록이 나옵니다. 항목을 `"제목 — 설명"` 모양으로 쓰면 제목이 굵게 보입니다.
검색엔진용 정보(`featureList`)에도 같이 들어갑니다. 목록이 없는 앱은 이 부분이 생략됩니다.

```json
"Dotty": {
  "featuresEn": ["Scenes in order — Build a show from as many scenes as you like…"],
  "featuresKo": ["장면을 순서대로 — 장면을 원하는 만큼 만들면 차례로 재생하고…"]
}
```

## 검색엔진 최적화 (배포 때 자동)

`scripts/prerender.mjs`가 배포 때마다 언어·앱별 정적 페이지를 만듭니다.

| 주소 | 내용 |
|---|---|
| `/`, `/ko/` | 첫 페이지 (영어 / 한국어) |
| `/apps/<앱>/`, `/ko/apps/<앱>/` | 앱 소개 페이지: 설명·실행/다운로드 버튼·스크린샷·다운로드 파일·다른 앱 |

- 페이지마다 제목·설명·canonical·hreflang(en/ko/x-default)·OG/트위터 카드(첫 스크린샷)·구조화 데이터
  (Organization, WebSite, SoftwareApplication, BreadcrumbList)를 넣고, `sitemap.xml`에 언어 짝과 함께 올립니다.
- 첫 페이지 제목 뒤에 붙는 한 줄은 `headline` / `headlineEn`, 앱 분류는 `overrides.<앱>.category`
  (schema.org `applicationCategory`: `GameApplication`, `DeveloperApplication`, `SecurityApplication` …)
- 공유 미리보기 이미지는 앱의 첫 PNG/JPEG 스크린샷 → PNG 아이콘 → 사이트 기본 이미지(`og.png`) 순으로 고릅니다
  (WebP는 일부 메신저가 읽지 못해 건너뜁니다). 사이트맵에는 앱 스크린샷도 이미지 정보로 들어갑니다.
- 앱 설명이 너무 짧으면(40자 미만) 검색 설명에 첫 번째 주요 기능을 이어 붙입니다.
- 없는 주소는 `404.html`(검색 제외)이 홈으로 안내합니다. 아이콘은 `favicon-32.png`, `apple-touch-icon.png`(PNG)도 함께 씁니다.
- 사이트 이름은 구조화 데이터의 `name`(`title`)과 `alternateName`(`config.json`의 `alternateNames`, 예: "MinaryHub 공작소")로 알립니다. 조직 로고는 112px 이상이어야 해서 180px `apple-touch-icon.png`를 씁니다.
- 주소(`siteUrl`)를 바꾸면 대표 주소·사이트맵·hreflang·공유 미리보기가 모두 따라 바뀝니다. 바꾼 뒤에는 새 주소로 Search Console·서치어드바이저를 다시 등록하고
  (소유 확인 코드는 `config.json`의 `verification.google` / `naver` / `bing`에 넣으면 `<meta>`로 들어갑니다), 아래 사이트맵을 제출합니다.
- 옛 주소(kimserv.com)에서 새 주소로의 자동 이동(301)은 GitHub Pages로는 만들 수 없습니다. 옛 주소의 검색 가치를 넘기려면 옛 도메인을
  리다이렉트가 되는 곳(예: Vercel 프로젝트의 `redirects`)에 연결해 새 주소로 301 이동시키세요.
- 배포 후 Google Search Console·네이버 서치어드바이저에 `https://minaryhub.github.io/sitemap.xml`을 한 번 등록해 두세요.
- 방문자가 고른 언어는 브라우저에 기억되어, 다음에 다른 언어 주소로 들어와도 고른 언어 페이지로 옮겨 줍니다.

## 통계 페이지 (`/stats.html`, 검색 제외)

- **다운로드 수의 기준은 GitHub 릴리스 파일의 누적 다운로드**입니다(위쪽 "다운로드 (누적)", "앱별 다운로드", 버전별 표). 사이트를 거치지 않은 직접 링크·앱의 자동 업데이트 다운로드를 포함합니다. 이 사이트의 버튼을 거친 다운로드는 그 일부라서 따로 더하지 않습니다(이중 집계 방지).
- 방문자·방문·국가와 "사이트 경유 클릭"(다운로드·웹 실행 버튼을 누른 횟수, 기간 선택 적용)은 `minaryhub-star` 서버가 모읍니다. 릴리스 정보를 불러오지 못하면 사이트 클릭을 다운로드 수로 대신 보여 줍니다.
- **메인 페이지의 앱 카드**도 같은 GitHub 누적 값을 오른쪽 아래에 **⬇ 숫자**로 보여 줍니다(마우스를 올리면 설명). `data/downloads.json`에서 읽고,
  릴리스 파일이 없는 웹 앱이나 불러오지 못했을 때는 숨깁니다. 사이트 클릭은 메인 페이지에 쓰지 않고 통계 페이지에서만 보여 줍니다.
- **앱 버전별 다운로드**는 GitHub 릴리스 파일의 누적 `download_count`입니다. 배포 때 `scripts/fetch-data.mjs`가
  릴리스 전체를 읽어 `data/downloads.json`을 만들고(1시간마다 갱신), 통계 페이지가 앱별 합계 → 버전별 합계·플랫폼별(Windows·macOS·Linux·Android)
  → 파일별 수로 보여 줍니다. 사이트 밖에서 받은 것과 앱의 자동 업데이트 다운로드도 포함되고, 체크섬·`latest.json` 같은
  부가 파일은 뺍니다. GitHub는 누적 값만 알려 주므로 기간 선택(7일·30일…)은 이 표에 적용되지 않습니다.
- 버전 표에는 **사이트 클릭**(선택한 기간의 서버 집계)도 나란히 나옵니다. 클릭한 파일 이름을 릴리스 파일과 맞춰 버전에 대응시키고,
  앱별 합계는 위쪽 "사이트 경유 클릭"과 같은 값이 되도록 맞춥니다(릴리스에 없는 파일, "웹에서 바로 실행" 클릭은 별도 줄).
  같은 파일 이름을 쓰는 버전(예: 포터블 exe)의 클릭은 가장 최신 버전에 합쳐 ≈로 표시합니다. 서버가 버전을 기록하지 않아서 생기는 근사입니다.
- 버전이 많은 앱(예: 커밋마다 릴리스를 만드는 앱)은 최근 10개만 먼저 보이고 "이전 버전 N개 더 보기"로 펼칩니다.

## 문의하기

하단 **Contact / 문의하기**를 누르면 문의 창이 열리고(`contact.js`), 내용은 `minaryhub-star` 서버의 `/api/contact`가
Brevo로 보냅니다. 받는 메일 주소와 Brevo 키는 그 서버의 Vercel 환경 변수(`CONTACT_TO`, `BREVO_API_KEY`, `CONTACT_FROM`)에만
있어 사이트에는 드러나지 않습니다. 받은 메일에서 답장하면 방문자에게 갑니다.

## 릴리스 파일 이름 규칙 (권장)

OS·아키텍처를 파일명에 넣으면 버튼이 자동 분류됩니다.

```
앱이름-win-x64.zip / .exe / .msi
앱이름-macos-arm64.dmg / 앱이름-macos-universal.dmg
앱이름-linux-x64.AppImage / .deb / .tar.gz
```

`.sha256`, `.sig`, `.blockmap`, `latest.yml` 같은 부가 파일은 자동으로 숨겨집니다.

## (선택) 릴리스 직후 즉시 갱신

기본은 최대 3시간 지연입니다. 릴리스와 동시에 반영하려면 각 앱 저장소의 릴리스 워크플로 마지막에 추가합니다.

```yaml
      - name: Refresh MinaryHub site
        run: |
          gh api repos/MinaryHub/MinaryHub.github.io/dispatches \
            -f event_type=release-published
        env:
          GH_TOKEN: ${{ secrets.SITE_DISPATCH_TOKEN }}
```

`SITE_DISPATCH_TOKEN`은 `MinaryHub.github.io` 저장소에 **Contents: Read and write** 권한만 준 fine-grained PAT입니다
(조직 Secrets에 한 번 등록하면 모든 저장소에서 사용 가능).

## 로컬 미리보기

```bash
GITHUB_TOKEN=$(gh auth token) node scripts/fetch-data.mjs
python3 -m http.server 8000   # → http://localhost:8000
```
