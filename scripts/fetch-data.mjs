// MinaryHub 공개 저장소 + 최신 릴리스 정보를 수집해 data/repos.json 으로 저장합니다.
// GitHub Actions 에서 GITHUB_TOKEN 으로 실행됩니다. (로컬: GITHUB_TOKEN=... node scripts/fetch-data.mjs)
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';

const ORG = process.env.ORG || 'MinaryHub';
const OUT = process.env.OUT || 'data/repos.json';
const token = process.env.GITHUB_TOKEN;

const config = JSON.parse(await readFile('config.json', 'utf8').catch(() => '{}'));
const hidden = new Set((config.hide || []).map((s) => s.toLowerCase()));
const overrides = config.overrides || {};
const order = (config.order || []).map((s) => s.toLowerCase());

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function listRepos() {
  const all = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`/orgs/${ORG}/repos?type=public&per_page=100&page=${page}`);
    if (!batch || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

const SKIP_ASSET = /\.(sha256|sha512|sig|asc|blockmap|ya?ml|txt|json|cer|aab)$|checksums?|sha\d+sums?/i;

// 아이콘·스크린샷: config.overrides → 이 사이트의 screenshots/<저장소>/ → 앱 저장소의 screenshots/, docs/images/ 등
const IMG = /\.(png|jpe?g|webp|gif)$/i;
const SHOT_PATH = /(^|\/)(screenshots?|docs\/(images|img|screenshots?)|\.github\/screenshots?)\/[^/]+$|(^|\/)screenshot[^/]*$/i;
const ICON_GUESS = [/(^|\/)(app[_-]?)?icon(-?(512|256))?\.png$/i, /(^|\/)logo\.png$/i, /targetsize-256_altform-unplated\.png$/i, /Square310x310Logo\.png$/i];
// 언어별 표시 이름·설명 (displayNameEn, descriptionKo …) — 페이지의 한/영 전환에서 사용
// (featuresEn / featuresKo: 앱 소개 페이지의 '주요 기능' 목록)
const i18nFields = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => /^(displayName|description|features)(En|Ko)$/.test(k)));
const raw = (r, p) => `https://raw.githubusercontent.com/${ORG}/${r.name}/${r.default_branch}/${p.split('/').map(encodeURIComponent).join('/')}`;

async function localShots(name) {
  try {
    const dir = `screenshots/${name}`;
    return (await readdir(dir)).filter((f) => IMG.test(f)).sort().map((f) => `${dir}/${encodeURIComponent(f)}`);
  } catch { return []; }
}

// 마지막 대안: README에 넣어 둔 이미지(배지·아이콘 제외)
const BADGE = /shields\.io|badge|badgen|img\.shields|codecov|github\.com\/[^/]+\/[^/]+\/(actions|workflows)|icon|logo/i;
async function readmeImages(r) {
  const md = (await gh(`/repos/${ORG}/${r.name}/readme`))?.content;
  if (!md) return [];
  const text = Buffer.from(md, 'base64').toString('utf8');
  const urls = [...text.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)|<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1] || m[2]);
  return [...new Set(urls)].filter((u) => !BADGE.test(u) && (IMG.test(u.split(/[?#]/)[0]) || /user-attachments|githubusercontent/.test(u)))
    .map((u) => /^https?:/.test(u) ? u.replace(/github\.com\/([^/]+\/[^/]+)\/blob\//, 'raw.githubusercontent.com/$1/') : raw(r, u.replace(/^\.?\//, '')))
    .slice(0, 10);
}

async function repoMedia(r, o) {
  const tree = (await gh(`/repos/${ORG}/${r.name}/git/trees/${r.default_branch}?recursive=1`))?.tree || [];
  const files = tree.filter((f) => f.type === 'blob' && IMG.test(f.path) && !/node_modules|tests?\/|fixtures|goldens/i.test(f.path));
  // https 주소, 이 사이트 안의 파일(screenshots/, icons/)은 그대로, 나머지는 앱 저장소 안의 경로
  const resolve = (p) => (/^https?:|^(screenshots|icons)\//.test(p) ? p : raw(r, p));
  let icon = o.icon ? resolve(o.icon) : null;
  if (!icon) for (const re of ICON_GUESS) {
    const f = files.filter((x) => re.test(x.path) && x.size > 1500).sort((a, b) => a.size - b.size)[0];
    if (f) { icon = raw(r, f.path); break; }
  }
  let screenshots = (o.screenshots || []).map(resolve);
  // 저장소의 언어별 폴더 screenshots/en/, screenshots/ko/ — 페이지가 화면 언어에 맞는 쪽을 쓴다
  const byLang = {};
  const NUM = (a, b) => a.localeCompare(b, 'en', { numeric: true });
  // 폴더 안에 하위 폴더(desktop-1920x1080/, android-phone-…/)로 나뉜 경우: 데스크톱 1920x1080 → 데스크톱 → 가장 많은 묶음 순으로 한 묶음만 쓴다
  const pickSet = (paths) => {
    const flat = paths.filter((p) => !p.includes('/')).filter((p) => !/feature-graphic|icon/i.test(p));
    if (flat.length) return flat.sort(NUM);
    const groups = {};
    for (const p of paths) { const g = p.split('/')[0]; (groups[g] ||= []).push(p); }
    const names = Object.keys(groups).filter((g) => groups[g].some((p) => !/feature-graphic|icon/i.test(p)));
    const best = names.find((g) => /1920x1080/.test(g)) || names.find((g) => /desktop/i.test(g)) || names.sort((a, b) => groups[b].length - groups[a].length)[0];
    return best ? groups[best].sort(NUM) : [];
  };
  if (!screenshots.length) {
    const under = files.map((f) => f.path).filter((p) => /^screenshots\//i.test(p)).map((p) => p.slice('screenshots/'.length));
    const langs = ['en', 'ko'];
    for (const l of langs) {
      const own = under.filter((p) => p.toLowerCase().startsWith(l + '/')).map((p) => p.slice(l.length + 1));
      // 영어 폴더가 따로 없으면 screenshots/ 바로 아래(언어 폴더가 아닌 것)를 영어 기본 세트로 본다
      const list = pickSet(l === 'en' && !own.length ? under.filter((p) => !langs.some((x) => p.toLowerCase().startsWith(x + '/'))) : own)
        .slice(0, 10).map((p) => raw(r, `screenshots/${l === 'en' && !own.length ? '' : l + '/'}${p}`));
      if (list.length) byLang[l] = list;
    }
  }
  if (!screenshots.length) screenshots = await localShots(r.name);
  if (!screenshots.length) screenshots = byLang.en || byLang.ko || [];
  if (!screenshots.length) screenshots = files.filter((f) => SHOT_PATH.test(f.path)).map((f) => f.path).sort().slice(0, 10).map((p) => raw(r, p));
  if (!screenshots.length) screenshots = await readmeImages(r);
  // shotsFixed: config에서 직접 고른 목록 → 페이지가 저장소 screenshots/ 폴더를 다시 읽어 바꾸지 않음
  return { icon, screenshots, ...(Object.keys(byLang).length ? { screenshotsByLang: byLang } : {}), shotsFixed: !!(o.screenshots || []).length };
}

// GitHub의 "Latest" 표시(releases/latest)는 수동 지정·--latest=false 등으로 어긋날 수 있으므로
// 발행일 기준 가장 최근 정식 릴리스를 직접 고른다 (정식이 없으면 최신 프리릴리스)
// 릴리스 전체(최신순). 최신 릴리스 고르기와 버전별 다운로드 통계(data/downloads.json)가 함께 쓴다
async function releasesOf(name) {
  const list = ((await gh(`/repos/${ORG}/${name}/releases?per_page=100`)) || []).filter((x) => !x.draft);
  list.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
  return list;
}
function pickLatest(list) {
  // 설치 파일이 붙은 정식 릴리스를 우선 (파일 없는 릴리스·빌드 중인 릴리스는 건너뜀)
  const hasFiles = (x) => (x.assets || []).some((a) => !SKIP_ASSET.test(a.name));
  return list.find((x) => !x.prerelease && hasFiles(x)) || list.find((x) => !x.prerelease) || list[0] || null;
}

const repos = (await listRepos()).filter(
  (r) =>
    !r.private &&
    !r.fork &&
    !r.archived &&
    !hidden.has(r.name.toLowerCase()) &&
    r.name.toLowerCase() !== '.github' &&
    r.name.toLowerCase() !== `${ORG.toLowerCase()}.github.io`
);

const result = [];
const downloads = [];   // 앱별·버전별 누적 다운로드 (GitHub 릴리스 파일의 download_count)
for (const r of repos) {
  const all = await releasesOf(r.name);
  const rel = pickLatest(all);
  const o = overrides[r.name] || {};
  const media = await repoMedia(r, o);
  const versions = all.map((x) => {
    const assets = (x.assets || []).filter((a) => !SKIP_ASSET.test(a.name))
      .map((a) => ({ name: a.name, size: a.size, downloads: a.download_count || 0 }));
    return { tag: x.tag_name, name: x.name || x.tag_name, publishedAt: x.published_at, prerelease: !!x.prerelease,
      url: x.html_url, total: assets.reduce((n, a) => n + a.downloads, 0), assets };
  });
  if (versions.length) downloads.push({ name: r.name, displayName: o.displayName || r.name, url: r.html_url,
    total: versions.reduce((n, v) => n + v.total, 0), releases: versions });
  result.push({
    name: r.name,
    displayName: o.displayName || r.name,
    description: o.description ?? r.description ?? '',
    url: r.html_url,
    homepage: o.homepage || r.homepage || '',
    web: o.web || '',
    ...i18nFields(o),
    branch: r.default_branch,
    category: o.category || undefined,   // schema.org applicationCategory (검색엔진용 앱 소개 페이지)
    language: r.language,
    topics: r.topics || [],
    stars: r.stargazers_count,
    pushedAt: r.pushed_at,
    ...media,
    release: rel && {
      tag: rel.tag_name,
      name: rel.name || rel.tag_name,
      url: rel.html_url,
      publishedAt: rel.published_at,
      prerelease: rel.prerelease,
      assets: (rel.assets || [])
        .filter((a) => !SKIP_ASSET.test(a.name))
        .map((a) => ({
          name: a.name,
          size: a.size,
          downloads: a.download_count,
          url: a.browser_download_url,
        })),
    },
  });
}

// config.apps: GitHub 공개 저장소 없이 직접 등록하는 앱 (웹 앱, 비공개 저장소의 앱 등)
for (const a of config.apps || []) {
  if (!a.name || hidden.has(a.name.toLowerCase()) || result.some((r) => r.name.toLowerCase() === a.name.toLowerCase())) continue;
  result.push({
    name: a.name,
    displayName: a.displayName || a.name,
    description: a.description || '',
    url: a.url || a.web || a.homepage || '',
    homepage: a.homepage || a.web || '',
    web: a.web || '',
    ...i18nFields(a),
    category: a.category || undefined,
    language: a.language || null,
    topics: a.topics || [],
    stars: null,
    pushedAt: a.updated ? new Date(a.updated).toISOString() : new Date().toISOString(),
    external: true,
    icon: a.icon || null,
    screenshots: a.screenshots || [],
    release: null,
  });
}

result.sort((a, b) => {
  const ia = order.indexOf(a.name.toLowerCase());
  const ib = order.indexOf(b.name.toLowerCase());
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
  if (!!a.release !== !!b.release) return a.release ? -1 : 1; // 릴리스 있는 것 먼저
  const da = a.release?.publishedAt || a.pushedAt;
  const db = b.release?.publishedAt || b.pushedAt;
  return new Date(db) - new Date(da);
});

const generatedAt = new Date().toISOString();
await mkdir(OUT.split('/').slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(OUT, JSON.stringify({ org: ORG, generatedAt, repos: result }, null, 2));
// 통계 페이지용: 체크섬·업데이트 정보 같은 부가 파일은 사용자가 받은 것이 아니므로 뺀다
const DL_OUT = OUT.replace(/[^/]*$/, 'downloads.json');
await writeFile(DL_OUT, JSON.stringify({ org: ORG, generatedAt, apps: downloads }, null, 2));
console.log(`✓ ${result.length} repos → ${OUT} (releases: ${result.filter((r) => r.release).length}), downloads → ${DL_OUT}`);
