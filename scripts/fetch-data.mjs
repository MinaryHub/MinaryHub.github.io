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

const SKIP_ASSET = /\.(sha256|sha512|sig|asc|blockmap|ya?ml|txt|json|cer|aab)$|checksums?/i;

// 아이콘·스크린샷: config.overrides → 이 사이트의 screenshots/<저장소>/ → 앱 저장소의 screenshots/, docs/images/ 등
const IMG = /\.(png|jpe?g|webp|gif)$/i;
const SHOT_PATH = /(^|\/)(screenshots?|docs\/(images|img|screenshots?)|\.github\/screenshots?)\/[^/]+$|(^|\/)screenshot[^/]*$/i;
const ICON_GUESS = [/(^|\/)(app[_-]?)?icon(-?(512|256))?\.png$/i, /(^|\/)logo\.png$/i, /targetsize-256_altform-unplated\.png$/i, /Square310x310Logo\.png$/i];
// 언어별 표시 이름·설명 (displayNameEn, descriptionKo …) — 페이지의 한/영 전환에서 사용
const i18nFields = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => /^(displayName|description)(En|Ko)$/.test(k)));
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
  const resolve = (p) => (/^https?:|^screenshots\//.test(p) ? p : raw(r, p));
  let icon = o.icon ? resolve(o.icon) : null;
  if (!icon) for (const re of ICON_GUESS) {
    const f = files.filter((x) => re.test(x.path) && x.size > 1500).sort((a, b) => a.size - b.size)[0];
    if (f) { icon = raw(r, f.path); break; }
  }
  let screenshots = (o.screenshots || []).map(resolve);
  // 저장소의 언어별 폴더 screenshots/en/, screenshots/ko/ — 페이지가 화면 언어에 맞는 쪽을 쓴다
  const byLang = {};
  if (!screenshots.length) for (const l of ['en', 'ko']) {
    const list = files.filter((f) => new RegExp(`^screenshots/${l}/[^/]+$`, 'i').test(f.path)).map((f) => f.path)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).slice(0, 10).map((p) => raw(r, p));
    if (list.length) byLang[l] = list;
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
async function latestRelease(name) {
  const list = ((await gh(`/repos/${ORG}/${name}/releases?per_page=30`)) || []).filter((x) => !x.draft);
  list.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
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
for (const r of repos) {
  const rel = await latestRelease(r.name);
  const o = overrides[r.name] || {};
  const media = await repoMedia(r, o);
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

await mkdir(OUT.split('/').slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(
  OUT,
  JSON.stringify({ org: ORG, generatedAt: new Date().toISOString(), repos: result }, null, 2)
);
console.log(`✓ ${result.length} repos → ${OUT} (releases: ${result.filter((r) => r.release).length})`);
