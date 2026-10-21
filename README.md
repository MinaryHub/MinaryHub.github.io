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
| `overrides` | 표시 이름·설명·홈페이지 덮어쓰기 |

저장소 설명/토픽은 각 저장소의 About(⚙)에서 고치면 자동 반영됩니다.

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
