// MinaryHub 공개 저장소 + 최신 릴리스 정보를 수집해 data/repos.json 으로 저장합니다.
// GitHub Actions 에서 GITHUB_TOKEN 으로 실행됩니다. (로컬: GITHUB_TOKEN=... node scripts/fetch-data.mjs)
import { readFile, writeFile, mkdir } from 'node:fs/promises';

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
  const rel = await gh(`/repos/${ORG}/${r.name}/releases/latest`);
  const o = overrides[r.name] || {};
  result.push({
    name: r.name,
    displayName: o.displayName || r.name,
    description: o.description ?? r.description ?? '',
    url: r.html_url,
    homepage: o.homepage || r.homepage || '',
    language: r.language,
    topics: r.topics || [],
    stars: r.stargazers_count,
    pushedAt: r.pushed_at,
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
