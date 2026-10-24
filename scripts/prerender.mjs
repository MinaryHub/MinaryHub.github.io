// 검색엔진용 사전 렌더링: config.json + data/repos.json 을 읽어
// _site/index.html 의 <head>(제목·설명·OG·구조화 데이터)와 본문 기본 내용을 정적으로 채우고,
// sitemap.xml / robots.txt 를 만듭니다. (JS를 실행하지 않는 크롤러도 내용을 읽을 수 있게)
import { readFile, writeFile } from 'node:fs/promises';

const SITE_DIR = process.env.SITE_DIR || '_site';
const cfg = JSON.parse(await readFile('config.json', 'utf8').catch(() => '{}'));
const data = JSON.parse(await readFile('data/repos.json', 'utf8').catch(() => '{"repos":[]}'));
let html = await readFile(`${SITE_DIR}/index.html`, 'utf8');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const siteUrl = (cfg.siteUrl || 'https://kimserv.com').replace(/\/+$/, '') + '/';
const title = cfg.title || 'Kimserv';
const repos = data.repos || [];
const names = repos.map((r) => r.displayName || r.name);
const description = cfg.description || cfg.tagline || `${title} 공개 프로젝트 소개 및 최신 빌드 다운로드`;
const keywords = [...new Set([title, ...(cfg.keywords || []), ...names])].join(', ');
const ogImage = siteUrl + (cfg.ogImage || 'og.png');

const osOf = (assets = []) => {
  const s = assets.map((a) => a.name.toLowerCase()).join(' ');
  return [
    /win|\.exe|\.msi|\.msix/.test(s) && 'Windows',
    /mac|darwin|\.dmg|\.pkg/.test(s) && 'macOS',
    /linux|\.appimage|\.deb|\.rpm/.test(s) && 'Linux',
    /\.apk|android/.test(s) && 'Android',
  ].filter(Boolean).join(', ');
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', '@id': siteUrl + '#website', name: title, url: siteUrl, description, inLanguage: 'ko-KR' },
    {
      '@type': 'ItemList',
      name: `${title} 프로젝트`,
      itemListElement: repos.map((r, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'SoftwareApplication',
          name: r.displayName || r.name,
          description: r.description || undefined,
          url: r.homepage || r.url,
          sameAs: r.url,
          applicationCategory: 'UtilitiesApplication',
          operatingSystem: osOf(r.release?.assets) || (r.web ? 'Web' : undefined),
          softwareVersion: r.release?.tag || undefined,
          downloadUrl: r.release?.url || undefined,
          image: r.icon ? (/^https?:/.test(r.icon) ? r.icon : siteUrl + r.icon) : undefined,
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'KRW' },
        },
      })),
    },
  ],
};

const verify = cfg.verification || {};
const head = [
  `<title>${esc(title)}</title>`,
  `<meta name="description" content="${esc(description)}">`,
  `<meta name="keywords" content="${esc(keywords)}">`,
  `<meta name="robots" content="index, follow, max-image-preview:large">`,
  `<link rel="canonical" href="${esc(siteUrl)}">`,
  `<link rel="sitemap" type="application/xml" href="${esc(siteUrl)}sitemap.xml">`,
  `<meta property="og:type" content="website">`,
  `<meta property="og:site_name" content="${esc(title)}">`,
  `<meta property="og:title" content="${esc(title)}">`,
  `<meta property="og:description" content="${esc(description)}">`,
  `<meta property="og:url" content="${esc(siteUrl)}">`,
  `<meta property="og:image" content="${esc(ogImage)}">`,
  `<meta property="og:locale" content="ko_KR">`,
  `<meta name="twitter:card" content="summary_large_image">`,
  `<meta name="twitter:title" content="${esc(title)}">`,
  `<meta name="twitter:description" content="${esc(description)}">`,
  `<meta name="twitter:image" content="${esc(ogImage)}">`,
  verify.google && `<meta name="google-site-verification" content="${esc(verify.google)}">`,
  verify.naver && `<meta name="naver-site-verification" content="${esc(verify.naver)}">`,
  verify.bing && `<meta name="msvalidate.01" content="${esc(verify.bing)}">`,
  `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
].filter(Boolean).join('\n');

// <title> + 기존 description 메타를 새 head 블록으로 교체
html = html.replace(/<title>[\s\S]*?<\/title>\s*(<meta name="description"[^>]*>)?/, head);
// 본문 제목·소개문구를 정적으로 채움
html = html.replace(/(<h1 id="title">)[\s\S]*?(<\/h1>)/, `$1${esc(title)}$2`);
html = html.replace(/(<p class="tagline" id="tagline">)[\s\S]*?(<\/p>)/, `$1${esc(cfg.tagline || '')}$2`);
// JS가 카드를 그리기 전(또는 JS 미실행 크롤러)에 보일 프로젝트 목록
if (repos.length) {
  const list = repos.map((r) =>
    `<li><a href="${esc(r.url)}"><strong>${esc(r.displayName || r.name)}</strong></a>${r.description ? ` — ${esc(r.description)}` : ''}` +
    `${r.release ? ` (<a href="${esc(r.release.url)}">${esc(r.release.tag)} 다운로드</a>)` : ''}</li>`).join('');
  html = html.replace(/<div class="state">불러오는 중…<\/div>/,
    `<div class="state"><h2 style="font-size:16px;margin:0 0 8px">${esc(title)} 프로젝트 목록</h2><ul style="text-align:left;margin:0;padding-left:20px">${list}</ul></div>`);
}
await writeFile(`${SITE_DIR}/index.html`, html);

const lastmod = (data.generatedAt || new Date().toISOString()).slice(0, 10);
await writeFile(`${SITE_DIR}/sitemap.xml`,
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  `  <url><loc>${esc(siteUrl)}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>\n</urlset>\n`);
await writeFile(`${SITE_DIR}/robots.txt`,
  `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}sitemap.xml\n`);

console.log(`✓ prerender: ${repos.length} repos, canonical ${siteUrl}`);
