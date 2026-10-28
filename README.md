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
- 방문자가 고른 언어는 브라우저에 기억되어, 다음에 다른 언어 주소로 들어와도 고른 언어 페이지로 옮겨 줍니다.

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
