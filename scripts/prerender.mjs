// 검색엔진용 사전 렌더링: config.json + data/repos.json 을 읽어 정적 페이지를 만듭니다.
// (JS를 실행하지 않는 크롤러도 내용을 읽을 수 있게, 언어·앱마다 주소가 따로 있게)
//
//   /                 영어 첫 페이지       /ko/                 한국어 첫 페이지
//   /apps/<앱>/       영어 앱 소개 페이지  /ko/apps/<앱>/       한국어 앱 소개 페이지
//
// 페이지마다 제목·설명·canonical·hreflang·OG·구조화 데이터(JSON-LD)를 따로 넣고, sitemap.xml / robots.txt 를 만듭니다.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const SITE_DIR = process.env.SITE_DIR || '_site';
const cfg = JSON.parse(await readFile('config.json', 'utf8').catch(() => '{}'));
const data = JSON.parse(await readFile('data/repos.json', 'utf8').catch(() => '{"repos":[]}'));
const indexSrc = await readFile(`${SITE_DIR}/index.html`, 'utf8');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const siteUrl = (cfg.siteUrl || 'https://kimserv.com').replace(/\/+$/, '') + '/';
const title = cfg.title || 'Kimserv';
const repos = data.repos || [];
const LANGS = ['en', 'ko'];
const LOCALE = { en: 'en_US', ko: 'ko_KR' };

// 언어별 값: descriptionEn / descriptionKo 처럼 이름 뒤에 En·Ko, 없으면 기본 값
const loc = (o, k, lang) => (o && o[k + (lang === 'en' ? 'En' : 'Ko')]) || (o && o[k]) || '';
const nameOf = (r, lang) => loc(r, 'displayName', lang) || r.name;
const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const abs = (u) => (!u ? '' : /^https?:/.test(u) ? u : siteUrl + u.replace(/^\.?\//, ''));
const home = (lang) => (lang === 'ko' ? 'ko/' : '');               // 사이트 루트 기준 경로
const appPath = (r, lang) => `${home(lang)}apps/${slugOf(r.name)}/`;
const clip = (s, n = 158) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);
const fmtDate = (d, lang) => (d ? new Date(d).toLocaleDateString(lang === 'en' ? 'en-US' : 'ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const fmtSize = (b) => (b >= 1 << 30 ? (b / (1 << 30)).toFixed(1) + ' GB' : b >= 1 << 20 ? (b / (1 << 20)).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

// 언어별 스크린샷 폴더(screenshots/en, /ko)가 있으면 그 언어 것을
const shotsFor = (r, lang) => r.screenshotsByLang?.[lang] || r.screenshots || [];
const osOfAsset = (name) => {
  const n = name.toLowerCase();
  if (/\.apk$|android/.test(n)) return 'Android';
  if (/win|\.exe$|\.msi$|\.msix|\.appx/.test(n)) return 'Windows';
  if (/mac|darwin|osx|\.dmg$|\.pkg$/.test(n)) return 'macOS';
  if (/linux|\.appimage$|\.deb$|\.rpm$|\.flatpak$|\.snap$/.test(n)) return 'Linux';
  return '';
};
const osList = (r) => {
  const s = [...new Set((r.release?.assets || []).map((a) => osOfAsset(a.name)).filter(Boolean))];
  if (r.web) s.push('Web');
  return s;
};

const T = {
  en: {
    headline: loc(cfg, 'headline', 'en') || 'Free desktop & web apps',
    projects: 'Projects', allApps: 'All apps', run: 'Run in browser', noInstall: 'No install',
    source: 'Source code on GitHub', shots: 'Screenshots', downloads: 'Downloads', noBuild: 'No public build yet.',
    latest: (tag, d) => `Latest release ${tag} · ${d}`, updated: (d) => `Updated ${d}`, more: 'More apps',
    platforms: 'Platforms', shotAlt: (n, i) => `${n} screenshot ${i}`, dl: (v) => `Download ${v}`,
    kind: (r) => (r.category === 'GameApplication' ? (r.web ? 'Free browser game' : 'Free game')
      : r.release?.assets?.length ? `Free download for ${osList(r).filter((o) => o !== 'Web').join(', ')}` : r.web ? 'Free web app' : 'Open-source app'),
  },
  ko: {
    headline: loc(cfg, 'headline', 'ko') || '무료 데스크톱·웹 앱',
    projects: '프로젝트', allApps: '전체 앱', run: '웹에서 바로 실행', noInstall: '설치 없음',
    source: 'GitHub 소스 코드', shots: '스크린샷', downloads: '다운로드', noBuild: '아직 공개된 빌드가 없습니다.',
    latest: (tag, d) => `최신 릴리스 ${tag} · ${d}`, updated: (d) => `최근 업데이트 ${d}`, more: '다른 앱',
    platforms: '지원 환경', shotAlt: (n, i) => `${n} 스크린샷 ${i}`, dl: (v) => `${v} 다운로드`,
    kind: (r) => (r.category === 'GameApplication' ? (r.web ? '무료 웹 게임' : '무료 게임')
      : r.release?.assets?.length ? `${osList(r).filter((o) => o !== 'Web').join('·')} 무료 다운로드` : r.web ? '무료 웹 앱' : '오픈소스 앱'),
  },
};

const org = { '@type': 'Organization', '@id': siteUrl + '#org', name: 'MinaryHub', url: siteUrl, logo: siteUrl + 'logo.webp', sameAs: ['https://github.com/MinaryHub'] };
const website = { '@type': 'WebSite', '@id': siteUrl + '#website', name: title, url: siteUrl, inLanguage: LANGS, publisher: { '@id': siteUrl + '#org' } };

const appLd = (r, lang) => ({
  '@type': 'SoftwareApplication',
  '@id': siteUrl + appPath(r, 'en') + '#app',
  name: nameOf(r, lang),
  alternateName: LANGS.map((l) => nameOf(r, l)).find((n) => n !== nameOf(r, lang)),
  description: loc(r, 'description', lang) || undefined,
  url: siteUrl + appPath(r, lang),
  sameAs: [r.url, r.web].filter((u) => u && u !== siteUrl + appPath(r, lang)),
  applicationCategory: r.category || 'UtilitiesApplication',
  operatingSystem: osList(r).join(', ') || undefined,
  softwareVersion: r.release?.tag || undefined,
  datePublished: r.release?.publishedAt || undefined,
  dateModified: r.release?.publishedAt || r.pushedAt || undefined,
  downloadUrl: r.release?.url || undefined,
  installUrl: r.web || undefined,
  image: abs(r.icon) || undefined,
  screenshot: shotsFor(r, lang).slice(0, 5).map(abs),
  author: { '@id': siteUrl + '#org' },
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
});

// 공통 <head>: 제목·설명·canonical·hreflang·OG·트위터
function headTags({ lang, path, pageTitle, desc, image, type = 'website', alt }) {
  const url = siteUrl + path;
  const v = cfg.verification || {};
  return [
    `<title>${esc(pageTitle)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<meta name="robots" content="index, follow, max-image-preview:large">`,
    `<link rel="canonical" href="${esc(url)}">`,
    ...LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(siteUrl + alt[l])}">`),
    `<link rel="alternate" hreflang="x-default" href="${esc(siteUrl + alt.en)}">`,
    `<link rel="sitemap" type="application/xml" href="${esc(siteUrl)}sitemap.xml">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:site_name" content="${esc(title)}">`,
    `<meta property="og:title" content="${esc(pageTitle)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    `<meta property="og:locale" content="${LOCALE[lang]}">`,
    ...LANGS.filter((l) => l !== lang).map((l) => `<meta property="og:locale:alternate" content="${LOCALE[l]}">`),
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(pageTitle)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image" content="${esc(image)}">`,
    v.google && `<meta name="google-site-verification" content="${esc(v.google)}">`,
    v.naver && `<meta name="naver-site-verification" content="${esc(v.naver)}">`,
    v.bing && `<meta name="msvalidate.01" content="${esc(v.bing)}">`,
  ].filter(Boolean).join('\n');
}
// 하위 폴더 페이지가 사이트 루트 기준 상대 경로(logo.webp, screenshots/…)를 그대로 쓰도록
const baseFor = (path) => (path ? '../'.repeat(path.split('/').filter(Boolean).length) : '');

const pages = [];   // sitemap: { alt: {en, ko}, lastmod }
const ogImage = siteUrl + (cfg.ogImage || 'og.png');
const generated = (data.generatedAt || new Date().toISOString()).slice(0, 10);
// 배포마다 바뀌는 버전 — 브라우저가 예전 contact.js를 캐시에서 쓰지 않게
const ver = Date.now().toString(36);

// ── 첫 페이지 (영어 /, 한국어 /ko/) ──
for (const lang of LANGS) {
  const t = T[lang], path = home(lang);
  const tagline = loc(cfg, 'tagline', lang);
  const pageTitle = `${title} · ${t.headline}`;
  const desc = clip(tagline || `${title} — ${t.headline}`);
  const graph = [org, website, {
    '@type': 'CollectionPage', '@id': siteUrl + path + '#page', url: siteUrl + path, name: pageTitle, description: desc, inLanguage: lang,
    isPartOf: { '@id': siteUrl + '#website' },
    mainEntity: { '@type': 'ItemList', itemListElement: repos.map((r, i) => ({ '@type': 'ListItem', position: i + 1, url: siteUrl + appPath(r, lang), name: nameOf(r, lang) })) },
  }];
  let html = indexSrc
    .replace(/<html lang="[^"]*"/, `<html lang="${lang}" data-lang="${lang}" data-prerendered="1"`)
    .replace('<meta charset="utf-8">', `<meta charset="utf-8">${baseFor(path) ? `\n<base href="${baseFor(path)}">` : ''}`)
    .replace(/<title>[\s\S]*?<\/title>\s*(<meta name="description"[^>]*>)?/,
      headTags({ lang, path, pageTitle, desc, image: ogImage, alt: { en: home('en'), ko: home('ko') } }) + '\n' + ld({ '@context': 'https://schema.org', '@graph': graph }))
    .replace('<script src="contact.js" defer>', `<script src="contact.js?v=${ver}" defer>`)
    .replace(/(<h1 id="title">)[\s\S]*?(<\/h1>)/, `$1${esc(title)}$2`)
    .replace(/(<p class="tagline" id="tagline">)[\s\S]*?(<\/p>)/, `$1${esc(tagline)}$2`);
  if (repos.length) {
    // JS가 카드를 그리기 전(또는 JS 미실행 크롤러)에 보일 목록 — 앱 소개 페이지로 이어지는 내부 링크
    const list = repos.map((r) => {
      const d = loc(r, 'description', lang);
      return `<li><a href="${esc(appPath(r, lang))}"><strong>${esc(nameOf(r, lang))}</strong></a>${d ? ` — ${esc(d)}` : ''}</li>`;
    }).join('');
    html = html.replace(/<div class="state" id="loading">[^<]*<\/div>/,
      `<div class="state" id="loading"><h2 style="font-size:16px;margin:0 0 8px">${esc(title)} ${t.projects}</h2><ul style="text-align:left;margin:0;padding-left:20px">${list}</ul></div>`);
  }
  await mkdir(`${SITE_DIR}/${path}`, { recursive: true });
  await writeFile(`${SITE_DIR}/${path}index.html`, html);
}
pages.push({ alt: { en: home('en'), ko: home('ko') }, lastmod: generated, priority: '1.0' });

// ── 앱 소개 페이지 ──
const style = (indexSrc.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
const APP_CSS = `
  .top { display: flex; align-items: center; gap: 12px; padding: 28px 0 8px; }
  .top .home { display: flex; align-items: center; gap: 10px; text-decoration: none; font-weight: 700; font-size: 18px; }
  .top .logo { width: 32px; height: 32px; }
  .crumbs { font-size: 13px; color: var(--muted); margin: 12px 0 20px; }
  .crumbs a { color: var(--accent); text-decoration: none; }
  .app-head { display: flex; gap: 16px; align-items: center; }
  .app-head .app-ico { width: 72px; height: 72px; border-radius: 16px; }
  .app-head h1 { font-size: 30px; margin: 0; letter-spacing: -.02em; }
  .kind { color: var(--muted); margin: 2px 0 0; font-size: 14px; }
  .lead { font-size: 17px; margin: 20px 0; max-width: 760px; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 8px; }
  .actions .btn { display: inline-flex; }
  .facts { color: var(--muted); font-size: 13px; margin: 10px 0 0; }
  .app h2 { font-size: 18px; margin: 36px 0 12px; }
  .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .gallery a { display: block; border-radius: 10px; overflow: hidden; border: 1px solid var(--border); background: var(--surface-2); aspect-ratio: 16 / 10; }
  .gallery img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
  .files { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; max-width: 640px; }
  .others { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; padding: 0; margin: 0 0 48px; }
  .others a { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 999px;
    background: var(--surface); text-decoration: none; font-size: 14px; }
  .others img { width: 20px; height: 20px; border-radius: 5px; }
`;
// 방문·다운로드 통계(첫 페이지와 같은 방식)와, 기억한 언어가 이 페이지와 다르면 그 언어 페이지로 이동
const appScript = (lang, alt) => `<script>
(() => {
  const S = 'https://minaryhub-star.vercel.app/api/track';
  try {
    const saved = localStorage.getItem('mh-lang');
    if (saved && saved !== '${lang}' && !/[?&]lang=/.test(location.search)) { location.replace(new URL(saved === 'ko' ? '${alt.ko}' : '${alt.en}' || './', document.baseURI).href); return; }
  } catch {}
  document.querySelectorAll('.lang-sw a').forEach((a) => a.addEventListener('click', () => { try { localStorage.setItem('mh-lang', a.dataset.lang); } catch {} }));
  let vid = null, off = !!navigator.webdriver;
  try { off = off || localStorage.getItem('mh-notrack') === '1'; vid = localStorage.getItem('mh-vid');
    if (!vid) { vid = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2); localStorage.setItem('mh-vid', vid); } } catch {}
  const track = (ev) => { if (off) return; const b = JSON.stringify({ ...ev, vid });
    try { if (navigator.sendBeacon && navigator.sendBeacon(S, new Blob([b], { type: 'text/plain' }))) return; } catch {}
    fetch(S, { method: 'POST', body: b, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {}); };
  track({ type: 'visit' });
  document.addEventListener('click', (e) => { const a = e.target.closest('a.btn[data-app]'); if (a) track({ type: 'download', app: a.dataset.app, file: a.title || '' }); });
})();
</script>`;

function appPage(r, lang) {
  const t = T[lang], path = appPath(r, lang), name = nameOf(r, lang);
  const desc = loc(r, 'description', lang);
  const alt = { en: appPath(r, 'en'), ko: appPath(r, 'ko') };
  const pageTitle = `${name} — ${t.kind(r)} | ${title}`;
  const shots = shotsFor(r, lang);
  const image = abs(shots[0]) || abs(r.icon) || ogImage;
  const rel = r.release;
  const actions = [
    r.web && `<a class="btn primary" href="${esc(r.web)}" data-app="${esc(r.name)}" title="web" target="_blank" rel="noopener"><span class="l">${esc(t.run)}</span><span class="sz">${esc(t.noInstall)}</span></a>`,
    rel?.assets?.length && `<a class="btn${r.web ? '' : ' primary'}" href="#downloads"><span class="l">${esc(t.dl(rel.tag))}</span></a>`,
    `<a class="btn" href="${esc(r.url)}" rel="noopener"><span class="l">${esc(t.source)}</span></a>`,
  ].filter(Boolean).join('');
  const facts = [rel ? t.latest(rel.tag, fmtDate(rel.publishedAt, lang)) : t.updated(fmtDate(r.pushedAt, lang)),
    osList(r).length && `${t.platforms}: ${osList(r).join(', ')}`, r.language].filter(Boolean).join(' · ');
  const files = rel?.assets?.length ? `<h2 id="downloads">${esc(t.downloads)} · ${esc(rel.tag)}</h2><ul class="files">${rel.assets.map((a) =>
    `<li><a class="btn" href="${esc(a.url)}" data-app="${esc(r.name)}" title="${esc(a.name)}" rel="nofollow"><span class="l"><span class="fname">${esc(a.name)}</span></span><span class="sz">${esc([osOfAsset(a.name), fmtSize(a.size)].filter(Boolean).join(' · '))}</span></a></li>`).join('')}</ul>`
    : r.web ? '' : `<p class="norel">${esc(t.noBuild)}</p>`;
  const gallery = shots.length ? `<h2>${esc(t.shots)}</h2><div class="gallery">${shots.map((s, i) =>
    `<a href="${esc(s)}" target="_blank" rel="noopener"><img src="${esc(s)}" alt="${esc(t.shotAlt(name, i + 1))}" loading="${i ? 'lazy' : 'eager'}"></a>`).join('')}</div>` : '';
  const others = repos.filter((x) => x !== r).map((x) => `<li><a href="${esc(appPath(x, lang))}">${x.icon ? `<img src="${esc(x.icon)}" alt="" loading="lazy">` : ''}${esc(nameOf(x, lang))}</a></li>`).join('');
  const graph = [org, website, appLd(r, lang), {
    '@type': 'BreadcrumbList',
    itemListElement: [{ '@type': 'ListItem', position: 1, name: title, item: siteUrl + home(lang) }, { '@type': 'ListItem', position: 2, name, item: siteUrl + path }],
  }];
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<base href="${baseFor(path)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
${headTags({ lang, path, pageTitle, desc: clip(desc || `${name} — ${t.kind(r)}`), image, alt })}
${ld({ '@context': 'https://schema.org', '@graph': graph })}
<link rel="icon" type="image/webp" href="logo.webp">
<link rel="apple-touch-icon" href="logo.webp">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>${style}${APP_CSS}</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <a class="home" href="${home(lang) || './'}"><img class="logo" src="logo.webp" alt="" width="32" height="32">${esc(title)}</a>
    <nav class="lang-sw" aria-label="Language"><a href="${alt.en}" data-lang="en" lang="en" hreflang="en"${lang === 'en' ? ' aria-current="page"' : ''}>EN</a><a href="${alt.ko}" data-lang="ko" lang="ko" hreflang="ko"${lang === 'ko' ? ' aria-current="page"' : ''}>한국어</a></nav>
  </header>
  <nav class="crumbs" aria-label="Breadcrumb"><a href="${home(lang) || './'}">${esc(t.allApps)}</a> › ${esc(name)}</nav>
  <main class="app">
    <div class="app-head">${r.icon ? `<img class="app-ico" src="${esc(r.icon)}" alt="${esc(name)}" width="72" height="72">` : ''}<div><h1>${esc(name)}</h1><p class="kind">${esc(t.kind(r))}</p></div></div>
    <p class="lead">${esc(desc)}</p>
    <div class="actions">${actions}</div>
    <p class="facts">${esc(facts)}</p>
    ${gallery}
    ${files}
    ${others ? `<h2>${esc(t.more)}</h2><ul class="others">${others}</ul>` : ''}
  </main>
  <footer>
    <span><a href="https://github.com/MinaryHub">github.com/MinaryHub</a></span>
    <span class="foot-r"><button type="button" class="contact-link" data-contact data-app="${esc(r.name)}">${lang === 'ko' ? '문의하기' : 'Contact'}</button>
    <a class="credit" href="https://claude.ai" target="_blank" rel="noopener">Produced with Claude</a></span>
  </footer>
</div>
${appScript(lang, alt)}
<script src="contact.js?v=${ver}" defer></script>
</body>
</html>
`;
}

for (const r of repos) {
  for (const lang of LANGS) {
    const path = appPath(r, lang);
    await mkdir(`${SITE_DIR}/${path}`, { recursive: true });
    await writeFile(`${SITE_DIR}/${path}index.html`, appPage(r, lang));
  }
  pages.push({ alt: { en: appPath(r, 'en'), ko: appPath(r, 'ko') }, lastmod: (r.release?.publishedAt || r.pushedAt || generated).slice(0, 10), priority: '0.8' });
}

// ── sitemap.xml (언어별 주소를 hreflang으로 묶음) / robots.txt ──
const urls = pages.flatMap((p) => LANGS.map((lang) => `  <url>
    <loc>${esc(siteUrl + p.alt[lang])}</loc>
${LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${esc(siteUrl + p.alt[l])}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(siteUrl + p.alt.en)}"/>
    <lastmod>${p.lastmod}</lastmod>
    <priority>${p.priority}</priority>
  </url>`)).join('\n');
await writeFile(`${SITE_DIR}/sitemap.xml`,
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`);
await writeFile(`${SITE_DIR}/robots.txt`, `User-agent: *\nAllow: /\nDisallow: /stats.html\n\nSitemap: ${siteUrl}sitemap.xml\n`);

console.log(`✓ prerender: ${repos.length} apps × ${LANGS.length} languages, ${pages.length * LANGS.length} URLs, canonical ${siteUrl}`);
