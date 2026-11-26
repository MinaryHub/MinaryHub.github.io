// 검색엔진용 사전 렌더링: config.json + data/repos.json + data/thinks-full.json 을 읽어 정적 페이지를 만듭니다.
// (JS를 실행하지 않는 크롤러도 내용을 읽을 수 있게, 언어·앱·글마다 주소가 따로 있게)
//
//   /                   영어 첫 페이지(Apps)   /ko/                   한국어 첫 페이지(Apps)
//   /thinks/            영어 Thinks 탭         /ko/thinks/            한국어 Thinks 탭
//   /apps/<앱>/         영어 앱 소개 페이지    /ko/apps/<앱>/         한국어 앱 소개 페이지
//   /thinks/<글>/       영어 글 읽기 페이지    /ko/thinks/<글>/       한국어 글 읽기 페이지
//
// 페이지마다 제목·설명·canonical·hreflang·OG·구조화 데이터(JSON-LD)를 따로 넣고, sitemap.xml / robots.txt 를 만듭니다.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const SITE_DIR = process.env.SITE_DIR || '_site';
const cfg = JSON.parse(await readFile('config.json', 'utf8').catch(() => '{}'));
const data = JSON.parse(await readFile('data/repos.json', 'utf8').catch(() => '{"repos":[]}'));
const changelogs = JSON.parse(await readFile('data/changelogs.json', 'utf8').catch(() => '{"apps":{}}')).apps || {};
const thinksFull = JSON.parse(await readFile('data/thinks-full.json', 'utf8').catch(() => '{"posts":[]}'));
const indexSrc = await readFile(`${SITE_DIR}/index.html`, 'utf8');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const siteUrl = (cfg.siteUrl || 'https://minaryhub.github.io').replace(/\/+$/, '') + '/';
const title = cfg.title || 'MinaryHub';
const repos = data.repos || [];
const posts = thinksFull.posts || [];
// 설치 파일 없이 웹 링크로만 쓰는 앱은 Web 탭, 나머지(다운로드·소스)는 Apps 탭 (index.html 의 isWebApp 과 동일 규칙)
const isWebApp = (r) => !!r.web && !(r.release?.assets?.length);
const dlRepos = repos.filter((r) => !isWebApp(r));
const webRepos = repos.filter(isWebApp);
const LANGS = ['en', 'ko'];
const LOCALE = { en: 'en_US', ko: 'ko_KR' };

// 언어별 값: descriptionEn / descriptionKo 처럼 이름 뒤에 En·Ko, 없으면 기본 값
const loc = (o, k, lang) => (o && o[k + (lang === 'en' ? 'En' : 'Ko')]) || (o && o[k]) || '';
const nameOf = (r, lang) => loc(r, 'displayName', lang) || r.name;
const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const abs = (u) => (!u ? '' : /^https?:/.test(u) ? u : siteUrl + u.replace(/^\.?\//, ''));
const home = (lang) => (lang === 'ko' ? 'ko/' : '');               // 사이트 루트 기준 경로
const appPath = (r, lang) => `${home(lang)}apps/${slugOf(r.name)}/`;
const thinksHome = (lang) => `${home(lang)}thinks/`;
const webHome = (lang) => `${home(lang)}web/`;
const postPathDisk = (p, lang) => `${home(lang)}thinks/${p.slug}/`;
const postPathUrl = (p, lang) => `${home(lang)}thinks/${encodeURIComponent(p.slug)}/`;
const clip = (s, n = 158) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);
const fmtDate = (d, lang) => (d ? new Date(d).toLocaleDateString(lang === 'en' ? 'en-US' : 'ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const fmtSize = (b) => (b >= 1 << 30 ? (b / (1 << 30)).toFixed(1) + ' GB' : b >= 1 << 20 ? (b / (1 << 20)).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

// 언어별 스크린샷 폴더(screenshots/en, /ko)가 있으면 그 언어 것을
const shotsFor = (r, lang) => r.screenshotsByLang?.[lang] || r.screenshots || [];
// 앱 소개 페이지의 '주요 기능' 목록: 그 언어 값, 없으면 다른 언어 값
const featuresFor = (r, lang) => (lang === 'en' ? r.featuresEn || r.featuresKo : r.featuresKo || r.featuresEn) || [];
const osOfAsset = (name) => {
  const n = name.toLowerCase();
  if (/\.apk$|android/.test(n)) return 'Android';
  if (/mac|darwin|osx|\.dmg$|\.pkg$/.test(n)) return 'macOS';   // before Windows: "darwin" contains "win"
  if (/win|\.exe$|\.msi$|\.msix|\.appx/.test(n)) return 'Windows';
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
    features: 'Features', shots: 'Screenshots', downloads: 'Downloads', noBuild: 'No public build yet.',
    latest: (tag, d) => `Latest release ${tag} · ${d}`, updated: (d) => `Updated ${d}`, more: 'More apps',
    platforms: 'Platforms', shotAlt: (n, i) => `${n} screenshot ${i}`, dl: (v) => `Download ${v}`,
    kind: (r) => (r.category === 'GameApplication' ? (r.web ? 'Free browser game' : 'Free game')
      : r.release?.assets?.length ? `Free download for ${osList(r).filter((o) => o !== 'Web').join(', ')}` : r.web ? 'Free web app' : 'Open-source app'),
    thinks: 'Thinks', web: 'Web', allPosts: 'All posts', readMin: (m) => `${m} min read`,
    pages: (n) => `~${Number(n).toLocaleString('en-US')} page${n === 1 ? '' : 's'}`,
    postUpdated: (d) => `Updated ${d}`, prevPost: 'Previous', nextPost: 'Next', morePosts: 'More posts',
    backToThinks: '← Back to Thinks', toc: 'Contents',
    changelog: 'Release notes', latestBadge: 'Latest', olderReleases: (n) => `Show ${n} older release${n === 1 ? '' : 's'}`,
  },
  ko: {
    headline: loc(cfg, 'headline', 'ko') || '무료 데스크톱·웹 앱',
    projects: '프로젝트', allApps: '전체 앱', run: '웹에서 바로 실행', noInstall: '설치 없음',
    features: '주요 기능', shots: '스크린샷', downloads: '다운로드', noBuild: '아직 공개된 빌드가 없습니다.',
    latest: (tag, d) => `최신 릴리스 ${tag} · ${d}`, updated: (d) => `최근 업데이트 ${d}`, more: '다른 앱',
    platforms: '지원 환경', shotAlt: (n, i) => `${n} 스크린샷 ${i}`, dl: (v) => `${v} 다운로드`,
    kind: (r) => (r.category === 'GameApplication' ? (r.web ? '무료 웹 게임' : '무료 게임')
      : r.release?.assets?.length ? `${osList(r).filter((o) => o !== 'Web').join('·')} 무료 다운로드` : r.web ? '무료 웹 앱' : '오픈소스 앱'),
    thinks: 'Thinks', web: '웹', allPosts: '전체 글', readMin: (m) => `약 ${m}분`,
    pages: (n) => `약 ${Number(n).toLocaleString('ko-KR')}쪽`,
    postUpdated: (d) => `${d} 수정`, prevPost: '이전 글', nextPost: '다음 글', morePosts: '다른 글',
    backToThinks: '← Thinks 목록으로', toc: '목차',
    changelog: '버전 변경 내용', latestBadge: '최신', olderReleases: (n) => `이전 버전 ${n}개 더 보기`,
  },
};

// Google asks for an organization logo of at least 112 px: logo.webp is 96 px, so the 180 px icon stands in
const org = { '@type': 'Organization', '@id': siteUrl + '#org', name: 'MinaryHub', alternateName: cfg.alternateNames || undefined, url: siteUrl, logo: siteUrl + 'apple-touch-icon.png', sameAs: ['https://github.com/MinaryHub'] };
// name / alternateName feed the "site name" Google shows above the result
const website = { '@type': 'WebSite', '@id': siteUrl + '#website', name: title, alternateName: cfg.alternateNames || undefined, url: siteUrl, inLanguage: LANGS, publisher: { '@id': siteUrl + '#org' } };

const postLangOf = (p) => {
  if (p?.lang === 'ko' || p?.lang === 'en') return p.lang;
  return /[\uAC00-\uD7A3]/.test(`${p?.title || ''} ${p?.excerpt || ''}`) ? 'ko' : 'en';
};
const postCanonicalPath = (p) => postPathUrl(p, postLangOf(p));

const appLd = (r, lang) => {
  const subtitle = loc(r, 'subtitle', lang);
  const kw = [subtitle, ...(r.topics || [])].filter(Boolean).join(', ');
  const firstAsset = r.release?.assets?.[0];
  const latestNote = (changelogs[r.name] || [])[0];
  const releaseNotes = latestNote?.body
    ? clip(latestNote.body.replace(/[#*`>\[\]()_-]+/g, ' ').replace(/\s+/g, ' ').trim(), 280)
    : undefined;
  return {
    '@type': 'SoftwareApplication',
    '@id': siteUrl + appPath(r, 'en') + '#app',
    name: nameOf(r, lang),
    alternateName: LANGS.map((l) => nameOf(r, l)).find((n) => n !== nameOf(r, lang)),
    description: loc(r, 'description', lang) || undefined,
    keywords: kw || undefined,
    url: siteUrl + appPath(r, lang),
    sameAs: [r.url, r.web].filter((u) => u && u !== siteUrl + appPath(r, lang)),
    applicationCategory: r.category || 'UtilitiesApplication',
    operatingSystem: osList(r).join(', ') || undefined,
    softwareVersion: r.release?.tag || undefined,
    releaseNotes,
    fileSize: firstAsset?.size ? fmtSize(firstAsset.size) : undefined,
    datePublished: r.release?.publishedAt || undefined,
    dateModified: r.release?.publishedAt || r.pushedAt || undefined,
    downloadUrl: r.release?.url || undefined,
    installUrl: r.web || undefined,
    image: abs(r.icon) || undefined,
    featureList: featuresFor(r, lang).length ? featuresFor(r, lang) : undefined,
    screenshot: shotsFor(r, lang).slice(0, 5).map(abs),
    author: { '@id': siteUrl + '#org' },
    publisher: { '@id': siteUrl + '#org' },
    inLanguage: lang,
    isAccessibleForFree: true,
    mainEntityOfPage: siteUrl + appPath(r, lang),
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
  };
};

// 공통 <head>: 제목·설명·canonical·hreflang·RSS·OG·트위터
function headTags({
  lang, path, canonicalPath = path, pageTitle, desc, image, type = 'website', alt,
  robots = 'index, follow, max-image-preview:large', includeHreflang = true, keywords = '', extraMeta = [],
}) {
  const url = siteUrl + path;
  const canonicalUrl = siteUrl + canonicalPath;
  const v = cfg.verification || {};
  return [
    `<title>${esc(pageTitle)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    keywords && `<meta name="keywords" content="${esc(keywords)}">`,
    `<meta name="robots" content="${esc(robots)}">`,
    `<link rel="canonical" href="${esc(canonicalUrl)}">`,
    ...(includeHreflang && alt ? [
      ...LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(siteUrl + alt[l])}">`),
      `<link rel="alternate" hreflang="x-default" href="${esc(siteUrl + alt.en)}">`,
    ] : []),
    `<link rel="alternate" type="application/rss+xml" title="${esc(title)} RSS" href="${esc(siteUrl)}rss.xml">`,
    `<link rel="sitemap" type="application/xml" href="${esc(siteUrl)}sitemap.xml">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:site_name" content="${esc(title)}">`,
    `<meta property="og:title" content="${esc(pageTitle)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(canonicalUrl)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    image === ogImage && `<meta property="og:image:width" content="1200">`,
    image === ogImage && `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(pageTitle)}">`,
    `<meta property="og:locale" content="${LOCALE[lang]}">`,
    ...(includeHreflang ? LANGS.filter((l) => l !== lang).map((l) => `<meta property="og:locale:alternate" content="${LOCALE[l]}">`) : []),
    ...extraMeta,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(pageTitle)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image" content="${esc(image)}">`,
    `<meta name="twitter:image:alt" content="${esc(pageTitle)}">`,
    `<meta name="theme-color" content="#f7f7f5" media="(prefers-color-scheme: light)">`,
    `<meta name="theme-color" content="#111113" media="(prefers-color-scheme: dark)">`,
    ...(Array.isArray(v.google) ? v.google : [v.google]).filter(Boolean).map((c) => `<meta name="google-site-verification" content="${esc(c)}">`),
    ...(Array.isArray(v.naver) ? v.naver : [v.naver]).filter(Boolean).map((c) => `<meta name="naver-site-verification" content="${esc(c)}">`),
    ...(Array.isArray(v.bing) ? v.bing : [v.bing]).filter(Boolean).map((c) => `<meta name="msvalidate.01" content="${esc(c)}">`),
  ].filter(Boolean).join('\n');
}
// 하위 폴더 페이지가 사이트 루트 기준 상대 경로(logo.webp, screenshots/…)를 그대로 쓰도록
const baseFor = (path) => (path ? '../'.repeat(path.split('/').filter(Boolean).length) : '');

const pages = [];   // sitemap: { alt: {en, ko}, singleLang?, lastmod, priority, images }
const ogImage = siteUrl + (cfg.ogImage || 'og.png');
const generated = (data.generatedAt || new Date().toISOString()).slice(0, 10);
const thinksGenerated = (thinksFull.generatedAt || data.generatedAt || new Date().toISOString()).slice(0, 10);
const siteKeywords = Array.isArray(cfg.keywords) ? cfg.keywords.join(', ') : '';
const commentsApi = (process.env.THINKS_COMMENTS_URL || cfg.thinks?.commentsApi || '').trim();
// 배포마다 바뀌는 버전 — 브라우저가 예전 contact.js를 캐시에서 쓰지 않게
const ver = Date.now().toString(36);

const appsStaticList = (lang, items = dlRepos, heading = T[lang].projects, loadingId = 'loading') => {
  if (!items.length) return '';
  const t = T[lang];
  const list = items.map((r) => {
    const d = loc(r, 'description', lang);
    return `<li><a href="${esc(appPath(r, lang))}"><strong>${esc(nameOf(r, lang))}</strong></a>${d ? ` — ${esc(d)}` : ''}</li>`;
  }).join('');
  return `<div class="state" id="${loadingId}"><h2 style="font-size:16px;margin:0 0 8px">${esc(title)} ${heading}</h2><ul style="text-align:left;margin:0;padding-left:20px">${list}</ul></div>`;
};

const thinksStaticList = (lang) => {
  if (!posts.length) return '';
  const t = T[lang];
  const list = posts.map((p) =>
    `<li><a href="${esc(postCanonicalPath(p))}"><strong>${esc(p.title)}</strong></a>${p.excerpt ? ` — ${esc(p.excerpt)}` : ''}</li>`
  ).join('');
  return `<div class="state" id="thinksLoading"><h2 style="font-size:16px;margin:0 0 8px">${esc(title)} ${t.thinks}</h2><ul style="text-align:left;margin:0;padding-left:20px">${list}</ul></div>`;
};

// ── 첫 페이지 (영어 /, 한국어 /ko/) — Apps 탭 기본 ──
for (const lang of LANGS) {
  const t = T[lang], path = home(lang);
  const tagline = loc(cfg, 'tagline', lang);
  const pageTitle = `${title} · ${t.headline}`;
  const desc = clip(tagline || `${title} — ${t.headline}`);
  const graph = [org, website, {
    '@type': 'CollectionPage', '@id': siteUrl + path + '#page', url: siteUrl + path, name: pageTitle, description: desc, inLanguage: lang,
    isPartOf: { '@id': siteUrl + '#website' },
    mainEntity: { '@type': 'ItemList', itemListElement: dlRepos.map((r, i) => ({ '@type': 'ListItem', position: i + 1, url: siteUrl + appPath(r, lang), name: nameOf(r, lang) })) },
  }];
  let html = indexSrc
    .replace(/<html lang="[^"]*"/, `<html lang="${lang}" data-lang="${lang}" data-tab="apps" data-prerendered="1"`)
    .replace('<meta charset="utf-8">', `<meta charset="utf-8">${baseFor(path) ? `\n<base href="${baseFor(path)}">` : ''}`)
    .replace(/<title>[\s\S]*?<\/title>\s*(<meta name="description"[^>]*>)?/,
      headTags({ lang, path, pageTitle, desc, image: ogImage, alt: { en: home('en'), ko: home('ko') }, keywords: siteKeywords }) + '\n' + ld({ '@context': 'https://schema.org', '@graph': graph }))
    .replace('<script src="contact.js" defer>', `<script src="contact.js?v=${ver}" defer>`)
    .replace(/(<h1 id="title">)[\s\S]*?(<\/h1>)/, `$1${esc(title)}$2`)
    .replace(/(<p class="tagline" id="tagline">)[\s\S]*?(<\/p>)/, `$1${esc(tagline)}$2`);
  if (dlRepos.length) html = html.replace(/<div class="state" id="loading">[^<]*<\/div>/, appsStaticList(lang));
  if (webRepos.length) html = html.replace(/<div class="state" id="webLoading">[^<]*<\/div>/, appsStaticList(lang, webRepos, T[lang].web, 'webLoading'));
  if (posts.length) html = html.replace(/<div class="state" id="thinksLoading">[^<]*<\/div>/, thinksStaticList(lang));
  await mkdir(`${SITE_DIR}/${path}`, { recursive: true });
  await writeFile(`${SITE_DIR}/${path}index.html`, html);
}
pages.push({ alt: { en: home('en'), ko: home('ko') }, lastmod: generated, priority: '1.0' });

// ── Thinks 탭 첫 페이지 (영어 /thinks/, 한국어 /ko/thinks/) ──
for (const lang of LANGS) {
  const t = T[lang], path = thinksHome(lang);
  const tagline = loc(cfg.thinks, 'tagline', lang) || loc(cfg, 'tagline', lang);
  const pageTitle = lang === 'ko'
    ? `Thinks — 기술 에세이·생각·단행본 아카이브 | ${title}`
    : `Thinks — Essays, Technical Notes & Books | ${title}`;
  const desc = clip(
    lang === 'ko'
      ? `${tagline ? tagline + ' — ' : ''}AI·소프트웨어·개발에 대한 에세이와 단행본을 웹에서 바로 읽을 수 있는 ${title} Thinks 아카이브입니다.`
      : `${tagline ? tagline + ' — ' : ''}Read essays, technical notes, and long-form books on AI and software directly in the browser on ${title} Thinks.`,
  );
  const thinksKeywords = lang === 'ko'
    ? 'MinaryHub, Thinks, 기술 에세이, AI, 단행본, 소프트웨어 개발, 아카이브'
    : 'MinaryHub, Thinks, essays, AI, books, software engineering, archive';
  const graph = [org, website, {
    '@type': 'CollectionPage', '@id': siteUrl + path + '#page', url: siteUrl + path, name: pageTitle, description: desc, inLanguage: lang,
    isPartOf: { '@id': siteUrl + '#website' },
    mainEntity: { '@type': 'ItemList', itemListElement: posts.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: siteUrl + postCanonicalPath(p), name: p.title })) },
  }];
  let html = indexSrc
    .replace(/<html lang="[^"]*"/, `<html lang="${lang}" data-lang="${lang}" data-tab="thinks" data-prerendered="1"`)
    .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<base href="${baseFor(path)}">`)
    .replace(/<title>[\s\S]*?<\/title>\s*(<meta name="description"[^>]*>)?/,
      headTags({ lang, path, pageTitle, desc, image: ogImage, alt: { en: thinksHome('en'), ko: thinksHome('ko') }, keywords: thinksKeywords }) + '\n' + ld({ '@context': 'https://schema.org', '@graph': graph }))
    .replace('<script src="contact.js" defer>', `<script src="contact.js?v=${ver}" defer>`)
    .replace(/(<h1 id="title">)[\s\S]*?(<\/h1>)/, `$1${esc(title)}$2`)
    .replace(/(<p class="tagline" id="tagline">)[\s\S]*?(<\/p>)/, `$1${esc(tagline)}$2`)
    .replace('id="tabApps" data-tab="apps" aria-controls="panelApps" aria-selected="true"',
      'id="tabApps" data-tab="apps" aria-controls="panelApps" aria-selected="false"')
    .replace('id="tabThinks" data-tab="thinks" aria-controls="panelThinks" aria-selected="false"',
      'id="tabThinks" data-tab="thinks" aria-controls="panelThinks" aria-selected="true"')
    .replace('<section id="panelApps" role="tabpanel" aria-labelledby="tabApps">',
      '<section id="panelApps" role="tabpanel" aria-labelledby="tabApps" hidden>')
    .replace('<section id="panelThinks" role="tabpanel" aria-labelledby="tabThinks" hidden>',
      '<section id="panelThinks" role="tabpanel" aria-labelledby="tabThinks">');
  if (dlRepos.length) html = html.replace(/<div class="state" id="loading">[^<]*<\/div>/, appsStaticList(lang));
  if (webRepos.length) html = html.replace(/<div class="state" id="webLoading">[^<]*<\/div>/, appsStaticList(lang, webRepos, T[lang].web, 'webLoading'));
  if (posts.length) html = html.replace(/<div class="state" id="thinksLoading">[^<]*<\/div>/, thinksStaticList(lang));
  await mkdir(`${SITE_DIR}/${path}`, { recursive: true });
  await writeFile(`${SITE_DIR}/${path}index.html`, html);
}
pages.push({ alt: { en: thinksHome('en'), ko: thinksHome('ko') }, lastmod: thinksGenerated, priority: '0.9' });

// ── Web 탭 첫 페이지 (영어 /web/, 한국어 /ko/web/) ──
for (const lang of LANGS) {
  const t = T[lang], path = webHome(lang);
  const tagline = loc(cfg, 'tagline', lang);
  const pageTitle = lang === 'ko'
    ? `무료 3D 웹 앱 · 시뮬레이션 모음 (설치 없음) | ${title}`
    : `Free Browser & 3D Web Apps (No Install) | ${title}`;
  const webNames = webRepos.slice(0, 5).map((r) => nameOf(r, lang)).join(', ');
  const desc = clip(
    lang === 'ko'
      ? `설치 없이 브라우저에서 바로 실행하는 무료 웹 앱 모음${webNames ? ` — ${webNames} 등` : ''}. PC와 모바일에서 바로 사용할 수 있습니다.`
      : `Free interactive web apps and 3D simulations you can run right in your browser with no install${webNames ? ` — including ${webNames}` : ''}.`,
  );
  const webKeywords = lang === 'ko'
    ? 'MinaryHub, 무료 웹 앱, 3D 시뮬레이션, 풍동 실험, 실시간 지구본, 브라우저 앱, 설치 없음'
    : 'MinaryHub, free web apps, 3D simulations, wind tunnel CFD, live 3D globe, browser apps, no install';
  const graph = [org, website, {
    '@type': 'CollectionPage', '@id': siteUrl + path + '#page', url: siteUrl + path, name: pageTitle, description: desc, inLanguage: lang,
    isPartOf: { '@id': siteUrl + '#website' },
    mainEntity: { '@type': 'ItemList', itemListElement: webRepos.map((r, i) => ({ '@type': 'ListItem', position: i + 1, url: siteUrl + appPath(r, lang), name: nameOf(r, lang) })) },
  }];
  let html = indexSrc
    .replace(/<html lang="[^"]*"/, `<html lang="${lang}" data-lang="${lang}" data-tab="web" data-prerendered="1"`)
    .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<base href="${baseFor(path)}">`)
    .replace(/<title>[\s\S]*?<\/title>\s*(<meta name="description"[^>]*>)?/,
      headTags({ lang, path, pageTitle, desc, image: ogImage, alt: { en: webHome('en'), ko: webHome('ko') }, keywords: webKeywords }) + '\n' + ld({ '@context': 'https://schema.org', '@graph': graph }))
    .replace('<script src="contact.js" defer>', `<script src="contact.js?v=${ver}" defer>`)
    .replace(/(<h1 id="title">)[\s\S]*?(<\/h1>)/, `$1${esc(title)}$2`)
    .replace(/(<p class="tagline" id="tagline">)[\s\S]*?(<\/p>)/, `$1${esc(tagline)}$2`)
    .replace('id="tabApps" data-tab="apps" aria-controls="panelApps" aria-selected="true"',
      'id="tabApps" data-tab="apps" aria-controls="panelApps" aria-selected="false"')
    .replace('id="tabWeb" data-tab="web" aria-controls="panelWeb" aria-selected="false"',
      'id="tabWeb" data-tab="web" aria-controls="panelWeb" aria-selected="true"')
    .replace('<section id="panelApps" role="tabpanel" aria-labelledby="tabApps">',
      '<section id="panelApps" role="tabpanel" aria-labelledby="tabApps" hidden>')
    .replace('<section id="panelWeb" role="tabpanel" aria-labelledby="tabWeb" hidden>',
      '<section id="panelWeb" role="tabpanel" aria-labelledby="tabWeb">');
  if (dlRepos.length) html = html.replace(/<div class="state" id="loading">[^<]*<\/div>/, appsStaticList(lang));
  if (webRepos.length) html = html.replace(/<div class="state" id="webLoading">[^<]*<\/div>/, appsStaticList(lang, webRepos, t.web, 'webLoading'));
  if (posts.length) html = html.replace(/<div class="state" id="thinksLoading">[^<]*<\/div>/, thinksStaticList(lang));
  await mkdir(`${SITE_DIR}/${path}`, { recursive: true });
  await writeFile(`${SITE_DIR}/${path}index.html`, html);
}
if (webRepos.length) pages.push({ alt: { en: webHome('en'), ko: webHome('ko') }, lastmod: generated, priority: '0.9' });

// ── 앱 소개 페이지 ──
const style = (indexSrc.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
const APP_CSS = `
  .top { display: flex; align-items: center; gap: 12px; padding: 28px 0 8px; }
  .top .home { display: flex; align-items: center; gap: 10px; text-decoration: none; font-weight: 700; font-size: 18px; }
  .top .logo { width: 32px; height: 32px; }
  .top-nav { display: flex; align-items: center; gap: 4px; margin-left: 12px; }
  .top-nav a { font-size: 14px; font-weight: 500; color: var(--muted); text-decoration: none;
    padding: 5px 10px; border-radius: 8px; transition: color .18s, background .18s; }
  .top-nav a:hover { color: var(--text); background: var(--surface-2); }
  .top-nav a[aria-current="section"] { color: var(--text); font-weight: 700; }
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
  .features { margin: 0; padding-left: 20px; max-width: 760px; display: grid; gap: 8px; }
  .features li::marker { color: var(--accent); }
  .app h2 { font-size: 18px; margin: 36px 0 12px; }
  .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .gallery a { display: block; border-radius: 10px; overflow: hidden; border: 1px solid var(--border); background: var(--surface-2); aspect-ratio: 16 / 10; }
  .gallery img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
  .files { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; max-width: 640px; }
  .changelog { display: grid; gap: 10px; max-width: 760px; }
  .rel-note { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
  .rel-note > summary { cursor: pointer; padding: 12px 16px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; list-style: none; }
  .rel-note > summary::-webkit-details-marker { display: none; }
  .rel-note > summary::before { content: "▸"; color: var(--muted); font-size: 12px; width: 12px; }
  .rel-note[open] > summary::before { content: "▾"; }
  .rel-tag { font: 600 14.5px "JetBrains Mono", monospace; color: var(--text); }
  .rel-badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
  .rel-badge.pre { background: var(--surface-2); color: #c98a12; }
  .rel-date { margin-left: auto; font-size: 12.5px; color: var(--muted); }
  .rel-note-body { padding: 4px 16px 16px 36px; border-top: 1px solid var(--border); font-size: 14.5px; line-height: 1.65; color: var(--text); }
  .rel-note-body h3, .rel-note-body h4 { font-size: 14px; font-weight: 600; margin: 14px 0 6px; color: var(--text); }
  .rel-note-body h3:first-child, .rel-note-body h4:first-child { margin-top: 8px; }
  .rel-note-body p { margin: 8px 0; }
  .rel-note-body ul { margin: 6px 0 8px; padding-left: 18px; display: grid; gap: 5px; }
  .rel-note-body ul ul { margin: 4px 0 2px; }
  .rel-note-body li::marker { color: var(--muted); }
  .rel-note-body code { font: 12.5px "JetBrains Mono", monospace; background: var(--surface-2); padding: 1px 5px; border-radius: 5px; }
  .rel-note-body a { color: var(--accent); text-decoration: none; }
  .rel-note-body a:hover { text-decoration: underline; }
  .rel-more > summary { cursor: pointer; font-size: 13.5px; color: var(--accent); padding: 6px 2px; list-style: none; }
  .rel-more > summary::-webkit-details-marker { display: none; }
  .rel-more[open] > summary { margin-bottom: 10px; }
  .rel-more-list { display: grid; gap: 10px; }
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

function renderReleaseInline(raw) {
  const codes = [];
  let s = String(raw || '').replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(`<code>${esc(c)}</code>`);
    return `\x00C${codes.length - 1}\x00`;
  });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => `<a href="${url}" target="_blank" rel="noopener">${label}</a>`);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  return s.replace(/\x00C(\d+)\x00/g, (_, i) => codes[Number(i)]);
}

function renderReleaseMd(md, tag) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let listOpen = false;
  let subOpen = false;
  let para = [];
  const flushPara = () => {
    if (!para.length) return;
    out.push(`<p>${renderReleaseInline(para.join(' '))}</p>`);
    para = [];
  };
  const closeLists = () => {
    if (subOpen) { out.push('</ul></li>'); subOpen = false; }
    else if (listOpen && out.length && out[out.length - 1].startsWith('<li')) out[out.length - 1] += '</li>';
    if (listOpen) { out.push('</ul>'); listOpen = false; }
  };
  let seenContent = false;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    const trimmed = line.trim();
    if (!trimmed) {
      flushPara();
      continue;
    }
    // 맨 첫 줄이 릴리스 태그 제목(예: "## v0.6.0 — ...")과 중복이면 요약 헤더와 겹치므로 건너뜀
    const hMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (hMatch) {
      flushPara();
      closeLists();
      const text = hMatch[2].trim();
      if (!seenContent && tag && text.toLowerCase().includes(String(tag).toLowerCase().replace(/^v/, ''))) {
        seenContent = true;
        continue;
      }
      seenContent = true;
      const lvl = hMatch[1].length <= 2 ? 'h3' : 'h4';
      out.push(`<${lvl}>${renderReleaseInline(text)}</${lvl}>`);
      continue;
    }
    const liMatch = line.match(/^(\s*)[-*•]\s+(.+)$/);
    if (liMatch) {
      flushPara();
      seenContent = true;
      const indent = liMatch[1].length;
      const content = renderReleaseInline(liMatch[2].trim());
      if (indent >= 2 && listOpen) {
        if (!subOpen) { out.push('<ul>'); subOpen = true; }
        out.push(`<li>${content}</li>`);
      } else {
        if (subOpen) { out.push('</ul></li>'); subOpen = false; }
        else if (listOpen && out.length && out[out.length - 1].startsWith('<li')) out[out.length - 1] += '</li>';
        if (!listOpen) { out.push('<ul>'); listOpen = true; }
        out.push(`<li>${content}`);
      }
      continue;
    }
    // 불릿 항목의 줄바꿈 이어쓰기 (2칸 이상 들여쓰기)
    if (listOpen && /^\s{2,}/.test(line)) {
      const target = out.length - 1;
      if (subOpen && out[target]?.endsWith('</li>')) {
        out[target] = out[target].slice(0, -5) + ' ' + renderReleaseInline(trimmed) + '</li>';
      } else if (out[target]?.startsWith('<li')) {
        out[target] += ' ' + renderReleaseInline(trimmed);
      }
      continue;
    }
    closeLists();
    seenContent = true;
    para.push(trimmed);
  }
  flushPara();
  closeLists();
  return out.join('\n');
}

function changelogHtml(r, lang) {
  const list = changelogs[r.name] || [];
  if (!list.length) return '';
  const t = T[lang];
  const renderItem = (v, idx) => {
    const body = renderReleaseMd(v.body, v.tag);
    if (!body) return '';
    return `<details class="rel-note"${idx === 0 ? ' open' : ''}>
      <summary><span class="rel-tag">${esc(v.tag)}</span>${idx === 0 ? `<span class="rel-badge">${esc(t.latestBadge)}</span>` : ''}${v.prerelease ? '<span class="rel-badge pre">pre</span>' : ''}${v.publishedAt ? `<span class="rel-date">${esc(fmtDate(v.publishedAt, lang))}</span>` : ''}</summary>
      <div class="rel-note-body">${body}</div>
    </details>`;
  };
  const items = list.map(renderItem).filter(Boolean);
  if (!items.length) return '';
  const SHOWN = 5;
  const head = items.slice(0, SHOWN).join('');
  const rest = items.slice(SHOWN);
  const more = rest.length
    ? `<details class="rel-more"><summary>${esc(t.olderReleases(rest.length))}</summary><div class="rel-more-list">${rest.join('')}</div></details>`
    : '';
  return `<h2 id="changelog">${esc(t.changelog)}</h2><div class="changelog">${head}${more}</div>`;
}

function appPage(r, lang) {
  const t = T[lang], path = appPath(r, lang), name = nameOf(r, lang);
  const desc = loc(r, 'description', lang);
  const subtitle = loc(r, 'subtitle', lang);
  const alt = { en: appPath(r, 'en'), ko: appPath(r, 'ko') };
  const kindText = t.kind(r);
  const fullTitle = subtitle ? `${name} — ${subtitle} · ${kindText} | ${title}` : `${name} — ${kindText} | ${title}`;
  const pageTitle = fullTitle.length <= 72 ? fullTitle : (subtitle ? `${name} — ${subtitle} | ${title}` : `${name} — ${kindText} | ${title}`);
  const appKeywords = [name, subtitle, ...(r.topics || [])].filter(Boolean).join(', ');
  // A very short description (e.g. a few words from the repo's About box) is filled out with the first feature.
  const first = featuresFor(r, lang)[0];
  const metaDesc = clip(
    desc && desc.length >= 40 ? desc : [desc, first].filter(Boolean).join(desc ? ' — ' : '') || `${name} — ${subtitle || kindText}`,
  );
  const shots = shotsFor(r, lang);
  // Share previews: prefer PNG/JPEG/GIF, then WebP screenshot/icon before falling back to site og.png.
  const common = (u) => /\.(png|jpe?g|gif)(\?|$)/i.test(u || '');
  const imgOk = (u) => /\.(png|jpe?g|gif|webp)(\?|$)/i.test(u || '');
  const image = abs(shots.find(common) || shots.find(imgOk)) || (imgOk(r.icon) ? abs(r.icon) : '') || ogImage;
  const rel = r.release;
  const actions = [
    r.web && `<a class="btn primary" href="${esc(r.web)}" data-app="${esc(r.name)}" title="web" target="_blank" rel="noopener"><span class="l">${esc(t.run)}</span><span class="sz">${esc(t.noInstall)}</span></a>`,
    rel?.assets?.length && `<a class="btn${r.web ? '' : ' primary'}" href="${path}#downloads"><span class="l">${esc(t.dl(rel.tag))}</span></a>`,
  ].filter(Boolean).join('');
  const facts = [rel ? t.latest(rel.tag, fmtDate(rel.publishedAt, lang)) : t.updated(fmtDate(r.pushedAt, lang)),
    osList(r).length && `${t.platforms}: ${osList(r).join(', ')}`, r.language].filter(Boolean).join(' · ');
  const files = rel?.assets?.length ? `<h2 id="downloads">${esc(t.downloads)} · ${esc(rel.tag)}</h2><ul class="files">${rel.assets.map((a) =>
    `<li><a class="btn" href="${esc(a.url)}" data-app="${esc(r.name)}" title="${esc(a.name)}" rel="nofollow"><span class="l"><span class="fname">${esc(a.name)}</span></span><span class="sz">${esc([osOfAsset(a.name), fmtSize(a.size)].filter(Boolean).join(' · '))}</span></a></li>`).join('')}</ul>`
    : r.web ? '' : `<p class="norel">${esc(t.noBuild)}</p>`;
  const changelog = changelogHtml(r, lang);
  // 'Head — body' items show their head in bold.
  const featureItems = featuresFor(r, lang).map((f) => {
    const [head, ...rest] = String(f).split(' — ');
    return rest.length ? `<li><strong>${esc(head)}</strong> — ${esc(rest.join(' — '))}</li>` : `<li>${esc(f)}</li>`;
  });
  const featuresHtml = featureItems.length
    ? `<h2>${esc(t.features)}</h2><ul class="features">${featureItems.join('')}</ul>` : '';
  const gallery = shots.length ? `<h2>${esc(t.shots)}</h2><div class="gallery">${shots.map((s, i) =>
    `<a href="${esc(s)}" target="_blank" rel="noopener"><img src="${esc(s)}" alt="${esc(t.shotAlt(name, i + 1))}" loading="${i ? 'lazy' : 'eager'}"></a>`).join('')}</div>` : '';
  const others = repos.filter((x) => x !== r).map((x) => `<li><a href="${esc(appPath(x, lang))}">${x.icon ? `<img src="${esc(x.icon)}" alt="" loading="lazy">` : ''}${esc(nameOf(x, lang))}</a></li>`).join('');
  const webApp = isWebApp(r);
  const crumbsLd = webApp
    ? [
        { '@type': 'ListItem', position: 1, name: title, item: siteUrl + home(lang) },
        { '@type': 'ListItem', position: 2, name: t.web, item: siteUrl + webHome(lang) },
        { '@type': 'ListItem', position: 3, name, item: siteUrl + path },
      ]
    : [
        { '@type': 'ListItem', position: 1, name: title, item: siteUrl + home(lang) },
        { '@type': 'ListItem', position: 2, name, item: siteUrl + path },
      ];
  const graph = [org, website, appLd(r, lang), { '@type': 'BreadcrumbList', itemListElement: crumbsLd }];
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<base href="${baseFor(path)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
${headTags({ lang, path, pageTitle, desc: metaDesc, image, alt, keywords: appKeywords })}
${ld({ '@context': 'https://schema.org', '@graph': graph })}
<link rel="icon" type="image/webp" href="logo.webp">
<link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>${style}${APP_CSS}</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <a class="home" href="${home(lang) || './'}"><img class="logo" src="logo.webp" alt="" width="32" height="32">${esc(title)}</a>
    <nav class="top-nav" aria-label="Sections">
      <a href="${home(lang) || './'}"${webApp ? '' : ' aria-current="section"'}>Apps</a>
      ${webRepos.length ? `<a href="${webHome(lang)}"${webApp ? ' aria-current="section"' : ''}>${esc(t.web)}</a>` : ''}
      <a href="${thinksHome(lang)}">${esc(t.thinks)}</a>
    </nav>
    <nav class="lang-sw" aria-label="Language"><a href="${alt.en}" data-lang="en" lang="en" hreflang="en"${lang === 'en' ? ' aria-current="page"' : ''}>EN</a><a href="${alt.ko}" data-lang="ko" lang="ko" hreflang="ko"${lang === 'ko' ? ' aria-current="page"' : ''}>한국어</a></nav>
  </header>
  <nav class="crumbs" aria-label="Breadcrumb"><a href="${webApp ? webHome(lang) : (home(lang) || './')}">${esc(webApp ? t.web : t.allApps)}</a> › ${esc(name)}</nav>
  <main class="app">
    <div class="app-head">${r.icon ? `<img class="app-ico" src="${esc(r.icon)}" alt="${esc(name)}" width="72" height="72">` : ''}<div><h1>${esc(name)}</h1><p class="kind">${esc(subtitle ? `${subtitle} · ${kindText}` : kindText)}</p></div></div>
    ${desc ? `<p class="lead">${esc(desc)}</p>` : ''}
    <div class="actions">${actions}</div>
    <p class="facts">${esc(facts)}</p>
    ${featuresHtml}
    ${gallery}
    ${files}
    ${changelog}
    ${others ? `<h2>${esc(t.more)}</h2><ul class="others">${others}</ul>` : ''}
  </main>
  <footer>
    <span></span>
    <span class="foot-r"><button type="button" class="contact-link" data-contact data-app="${esc(r.name)}">${lang === 'ko' ? '문의하기' : 'Contact'}</button>
    <span class="credit">Produced with <a href="https://claude.ai" target="_blank" rel="noopener">Claude</a> and <a href="https://gemini.google.com" target="_blank" rel="noopener">Gemini</a></span></span>
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
  pages.push({
    alt: { en: appPath(r, 'en'), ko: appPath(r, 'ko') },
    lastmod: (r.release?.publishedAt || r.pushedAt || generated).slice(0, 10),
    priority: '0.8',
    images: Object.fromEntries(LANGS.map((l) => [l, shotsFor(r, l).slice(0, 5).map(abs)])),
  });
}

// ── Thinks 글 읽기 페이지 (/thinks/<slug>/, /ko/thinks/<slug>/) ──
const POST_CSS = `
  html { scroll-behavior: smooth; }
  .post-layout { padding-bottom: 56px; }
  .post-layout.has-toc { display: grid; grid-template-columns: minmax(0, 740px) 240px; gap: 48px; align-items: start; }
  .article-wrap { max-width: 740px; min-width: 0; }
  .article-head { margin: 8px 0 28px; padding-bottom: 24px; border-bottom: 1px solid var(--border); }
  .article-head h1 { font-size: clamp(26px, 4vw, 34px); line-height: 1.3; letter-spacing: -.02em;
    margin: 0 0 14px; word-break: keep-all; }
  .article-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    font-size: 14px; color: var(--muted); }
  .article-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; font-size: 12px; }
  .prose h2, .prose h3, .prose h4 { scroll-margin-top: 24px; }

  /* 목차 — 데스크톱 오른쪽 고정 사이드바 */
  .toc-side { position: sticky; top: 28px; max-height: calc(100vh - 56px); overflow-y: auto;
    padding: 4px 0 4px 16px; border-left: 1px solid var(--border); scrollbar-width: thin; }
  .toc-head { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
    color: var(--muted); margin: 0 0 10px; }
  .toc-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
  .toc-link { display: block; padding: 4px 8px; border-radius: 6px; font-size: 13.5px; line-height: 1.45;
    color: var(--muted); text-decoration: none; word-break: keep-all;
    transition: color .15s, background .15s; }
  .toc-link:hover { color: var(--text); background: var(--surface-2); }
  .toc-link.on { color: var(--accent); font-weight: 600; background: var(--accent-soft); }
  .toc-d1 .toc-link { padding-left: 18px; font-size: 13px; }
  .toc-d2 .toc-link { padding-left: 30px; font-size: 12.5px; }

  /* 목차 — 모바일·태블릿 접이식 박스 */
  .toc-mobile { display: none; margin: 0 0 28px; padding: 14px 18px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
  .toc-mobile summary { cursor: pointer; font-size: 14px; font-weight: 700; color: var(--text);
    list-style: none; display: flex; align-items: center; justify-content: space-between; }
  .toc-mobile summary::-webkit-details-marker { display: none; }
  .toc-mobile summary::after { content: "▾"; font-size: 12px; color: var(--muted); transition: transform .18s; }
  .toc-mobile[open] summary::after { transform: rotate(180deg); }
  .toc-mobile .toc-list { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }

  @media (max-width: 1020px) {
    .post-layout.has-toc { display: block; }
    .toc-side { display: none; }
    .toc-mobile { display: block; }
  }

  .post-nav { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;
    margin-top: 48px; padding-top: 28px; border-top: 1px solid var(--border); }
  .post-nav a { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px;
    border: 1px solid var(--border); border-radius: 12px; background: var(--surface);
    text-decoration: none; transition: border-color .18s; }
  .post-nav a:hover { border-color: var(--accent); }
  .post-nav .pn-lbl { font-size: 12px; color: var(--muted); }
  .post-nav .pn-ttl { font-size: 15px; font-weight: 600; color: var(--text); line-height: 1.4; }
  .post-nav a.pn-next { text-align: right; }
  .back-link { display: inline-block; margin-top: 28px; font-size: 14px; color: var(--accent); text-decoration: none; }
  .back-link:hover { text-decoration: underline; }

  /* 글 하단 피드백 · 댓글 (comments.js) */
  .comments { margin-top: 48px; padding-top: 32px; border-top: 1px solid var(--border); }
  .cm-head h2 { font-size: 20px; margin: 0 0 6px; display: flex; align-items: center; gap: 8px; }
  .cm-cnt { font: 600 12px "JetBrains Mono", monospace; padding: 2px 8px; border-radius: 999px;
    background: var(--accent-soft); color: var(--accent); }
  .cm-sub { font-size: 14px; color: var(--muted); margin: 0 0 18px; }
  .cm-form { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 18px; display: grid; gap: 12px; box-shadow: var(--shadow); }
  .cm-types { display: flex; flex-wrap: wrap; gap: 8px; }
  .cm-type { cursor: pointer; }
  .cm-type input { position: absolute; opacity: 0; pointer-events: none; }
  .cm-type span { display: inline-block; padding: 5px 12px; border-radius: 999px; font-size: 13px;
    border: 1px solid var(--border); background: var(--surface-2); color: var(--muted); transition: all .15s; }
  .cm-type input:checked + span { background: var(--text); color: var(--bg); border-color: var(--text); font-weight: 500; }
  .cm-type input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }
  .cm-name, .cm-msg { font: inherit; font-size: 14.5px; color: var(--text); background: var(--bg);
    border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; width: 100%; }
  .cm-msg { resize: vertical; min-height: 96px; line-height: 1.6; }
  .cm-form .hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
  .cm-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .cm-status { font-size: 13.5px; color: var(--muted); }
  .cm-status.err { color: #d14343; }
  .cm-status.ok { color: var(--ok); }
  .cm-btn { cursor: pointer; font: inherit; font-size: 14px; }
  .cm-btn:disabled { opacity: .6; cursor: progress; }
  .cm-list { display: grid; gap: 12px; margin-top: 20px; }
  .cm-empty { font-size: 14px; color: var(--muted); text-align: center; padding: 24px 0; margin: 0; }
  .cm-item { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; }
  .cm-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; color: var(--muted); margin-bottom: 8px; }
  .cm-author { color: var(--text); font-weight: 600; font-size: 14px; }
  .cm-badge { font-size: 11.5px; padding: 2px 8px; border-radius: 999px; background: var(--surface-2); color: var(--muted); }
  .cm-body { margin: 0; font-size: 14.5px; line-height: 1.65; white-space: pre-wrap; word-break: break-word; }
`;

const decodeEntities = (s) =>
  String(s ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

function extractToc(rawHtml) {
  const rawItems = [];
  let seq = 0;
  const html = String(rawHtml || '').replace(/<(h[2-4])\b([^>]*)>([\s\S]*?)<\/\1>/gi, (full, tag, attrs, inner) => {
    const text = decodeEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!text) return full;
    const id = `sec-${++seq}`;
    const level = Number(tag[1]);
    rawItems.push({ id, level, text });
    const cleanedAttrs = attrs.replace(/\s+id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    return `<${tag.toLowerCase()} id="${id}"${cleanedAttrs}>${inner}</${tag.toLowerCase()}>`;
  });
  const minLevel = rawItems.length ? Math.min(...rawItems.map((x) => x.level)) : 2;
  const toc = rawItems.map((x) => ({ id: x.id, depth: Math.min(2, x.level - minLevel), text: x.text }));
  return { html, toc };
}

const postTocScript = () => `<script>
(() => {
  const links = [...document.querySelectorAll('.toc-side .toc-link')];
  if (!links.length) return;
  const items = links.map((a) => ({ a, el: document.getElementById(a.dataset.id) })).filter((x) => x.el);
  if (!items.length) return;
  let active = null;
  const setOn = (id) => {
    if (active === id) return;
    active = id;
    links.forEach((a) => {
      const on = a.dataset.id === id;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    });
    const cur = links.find((a) => a.dataset.id === id);
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  };
  const update = () => {
    let cur = items[0].el.id;
    const y = window.scrollY + 96;
    for (const it of items) {
      if (it.el.getBoundingClientRect().top + window.scrollY <= y) cur = it.el.id;
      else break;
    }
    setOn(cur);
  };
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; update(); });
  }, { passive: true });
  update();
})();
</script>`;

const postLightboxScript = (closeLabel) => `<script>
(() => {
  const imgs = [...document.querySelectorAll('.prose img')];
  if (!imgs.length) return;
  const lb = document.createElement('div');
  lb.id = 'lb'; lb.hidden = true;
  lb.innerHTML = '<button class="lb-x" aria-label="${esc(closeLabel)}">×</button><img alt="">';
  document.body.appendChild(lb);
  imgs.forEach((im) => im.addEventListener('click', () => {
    lb.querySelector('img').src = im.currentSrc || im.src;
    lb.querySelector('img').alt = im.alt || '';
    lb.hidden = false;
  }));
  lb.addEventListener('click', (e) => { if (e.target === lb || e.target.closest('.lb-x')) lb.hidden = true; });
  document.addEventListener('keydown', (e) => { if (!lb.hidden && e.key === 'Escape') lb.hidden = true; });
})();
</script>`;

const SYSTEM_FONTS = new Set([
  'arial', 'georgia', 'times new roman', 'times', 'verdana', 'tahoma', 'trebuchet ms',
  'courier new', 'courier', 'comic sans ms', 'impact', 'calibri', 'cambria', 'helvetica',
  'segoe ui', 'malgun gothic', '맑은 고딕', 'gulim', '굴림', 'dotum', '돋움', 'batang', '바탕',
  'gungsuh', '궁서', 'apple sd gothic neo', 'sans-serif', 'serif', 'monospace',
  'noto sans kr', 'jetbrains mono',
]);
const MULTI_WEIGHT_GFONTS = new Set([
  'noto serif kr', 'nanum myeongjo', 'nanum gothic', 'gowun batang', 'hahmlet',
  'ibm plex sans kr', 'gothic a1', 'merriweather', 'lora', 'playfair display',
  'roboto', 'roboto serif', 'roboto slab', 'open sans', 'lato', 'montserrat',
  'source serif 4', 'source sans 3', 'pt serif', 'eb garamond', 'libre baskerville',
  'inter', 'crimson pro', 'spectral', 'bitter', 'nunito', 'raleway', 'poppins',
  'oswald', 'ubuntu', 'lexend', 'cormorant garamond', 'work sans', 'dm sans', 'plus jakarta sans',
]);
const safeFontName = (f) => {
  const s = String(f || '').trim().replace(/\s+/g, ' ');
  return s && s.length <= 60 && /^[a-zA-Z0-9\s\-_가-힣]+$/.test(s) ? s : '';
};
const postFontStack = (font) => {
  const f = safeFontName(font);
  if (!f) return '';
  const isSerif = /serif|myeongjo|batang|명조|바탕|garamond|georgia|baskerville|lora|merriweather|song myung|hahmlet|times|cambria/i.test(f);
  const fallback = isSerif ? '"Noto Serif KR", Georgia, serif' : '"Noto Sans KR", system-ui, -apple-system, sans-serif';
  return `'${f}', ${fallback}`;
};
const FONT_ALIASES = {
  'noto serif cjk kr': 'Noto Serif KR',
  'noto sans cjk kr': 'Noto Sans KR',
};
const postFontLinks = (fonts) => {
  const list = [...new Set((fonts || []).map(safeFontName).filter(Boolean).map((f) => FONT_ALIASES[f.toLowerCase()] || f))];
  return list
    .filter((f) => !SYSTEM_FONTS.has(f.toLowerCase()) && !/[가-힣]/.test(f))
    .map((f) => {
      const param = encodeURIComponent(f).replace(/%20/g, '+');
      const w = MULTI_WEIGHT_GFONTS.has(f.toLowerCase()) ? ':wght@400;700' : '';
      return `<link href="https://fonts.googleapis.com/css2?family=${param}${w}&display=swap" rel="stylesheet">`;
    })
    .join('\n');
};

function postPage(p, idx, lang, prepared) {
  const t = T[lang];
  const pathUrl = postPathUrl(p, lang);
  const pathDisk = postPathDisk(p, lang);
  const alt = { en: postPathUrl(p, 'en'), ko: postPathUrl(p, 'ko') };
  const pageTitle = `${p.title} · ${t.thinks} | ${title}`;
  const desc = clip(p.excerpt || p.title);
  const imgOk = (u) => /\.(png|jpe?g|gif|webp)(\?|$)/i.test(u || '');
  const image = (imgOk(p.cover) ? abs(p.cover) : '') || ogImage;
  const extraMeta = [
    p.publishedAt && `<meta property="article:published_time" content="${esc(p.publishedAt)}">`,
    p.updatedAt && `<meta property="article:modified_time" content="${esc(p.updatedAt)}">`,
  ].filter(Boolean);

  const pubDay = p.publishedAt ? p.publishedAt.slice(0, 10) : '';
  const updDay = p.updatedAt ? p.updatedAt.slice(0, 10) : '';
  const metaParts = [
    p.publishedAt && `<time datetime="${esc(p.publishedAt)}">${esc(fmtDate(p.publishedAt, lang))}</time>`,
    updDay && pubDay && updDay > pubDay && `<span>${esc(t.postUpdated(fmtDate(p.updatedAt, lang)))}</span>`,
    p.pageCount && `<span>${esc(t.pages(p.pageCount))}</span>`,
    p.readingMinutes && `<span>${esc(t.readMin(p.readingMinutes))}</span>`,
  ].filter(Boolean).join(' · ');

  const tagsHtml = (p.tags || []).length
    ? `<div class="article-tags">${p.tags.map((tg) => `<span class="tag">${esc(tg)}</span>`).join('')}</div>`
    : '';

  const { html: bodyHtml, toc } = prepared;
  const hasToc = toc.length > 0;
  // <base href> 가 있으므로 앵커 링크는 현재 페이지 경로를 앞에 붙여 홈으로 튀지 않게 한다
  const tocItemsHtml = toc
    .map((item) => `<li class="toc-d${item.depth}"><a class="toc-link" href="${esc(pathUrl)}#${item.id}" data-id="${item.id}">${esc(item.text)}</a></li>`)
    .join('');
  const tocMobileHtml = hasToc
    ? `<details class="toc-mobile"${toc.length <= 8 ? ' open' : ''}><summary>${esc(t.toc)} (${toc.length})</summary><ul class="toc-list">${tocItemsHtml}</ul></details>`
    : '';
  const tocSideHtml = hasToc
    ? `<aside class="toc-side" aria-label="${esc(t.toc)}"><p class="toc-head">${esc(t.toc)}</p><ul class="toc-list">${tocItemsHtml}</ul></aside>`
    : '';

  // 최신순 정렬이므로 idx + 1 이 이전 글(더 오래된 글), idx - 1 이 다음 글(더 최신 글)
  const prev = posts[idx + 1] || null;
  const next = posts[idx - 1] || null;
  const navHtml = (prev || next)
    ? `<nav class="post-nav" aria-label="Post navigation">
        ${prev ? `<a href="${esc(postPathUrl(prev, lang))}"><span class="pn-lbl">← ${esc(t.prevPost)}</span><span class="pn-ttl">${esc(prev.title)}</span></a>` : '<span></span>'}
        ${next ? `<a class="pn-next" href="${esc(postPathUrl(next, lang))}"><span class="pn-lbl">${esc(t.nextPost)} →</span><span class="pn-ttl">${esc(next.title)}</span></a>` : ''}
      </nav>`
    : '';

  const postLang = postLangOf(p);
  const canonicalPath = postPathUrl(p, postLang);
  const isCanonical = lang === postLang;
  const robots = isCanonical ? 'index, follow, max-image-preview:large' : 'noindex, follow';
  const fontStack = postFontStack(p.font);
  const extraFontLinks = postFontLinks([p.font, ...(p.fonts || [])]);
  const fontCss = fontStack
    ? `\n  .article-wrap article { --post-font: ${fontStack}; }\n  .article-wrap article .article-head h1, .article-wrap article .prose { font-family: var(--post-font); }`
    : '';

  const blogLd = {
    '@type': 'BlogPosting',
    '@id': siteUrl + canonicalPath + '#post',
    headline: p.title,
    description: desc,
    url: siteUrl + canonicalPath,
    mainEntityOfPage: siteUrl + canonicalPath,
    datePublished: p.publishedAt || undefined,
    dateModified: p.updatedAt || p.publishedAt || undefined,
    image: image,
    articleSection: p.tags?.[0] || undefined,
    keywords: (p.tags || []).length ? p.tags.join(', ') : undefined,
    wordCount: p.wordCount || undefined,
    timeRequired: p.readingMinutes ? `PT${p.readingMinutes}M` : undefined,
    author: { '@id': siteUrl + '#org' },
    publisher: { '@id': siteUrl + '#org' },
    inLanguage: postLang,
  };
  const graph = [org, website, blogLd, {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: title, item: siteUrl + home(lang) },
      { '@type': 'ListItem', position: 2, name: t.thinks, item: siteUrl + thinksHome(lang) },
      { '@type': 'ListItem', position: 3, name: p.title, item: siteUrl + canonicalPath },
    ],
  }];

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<base href="${baseFor(pathDisk)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
${headTags({
    lang: postLang, path: pathUrl, canonicalPath, pageTitle, desc, image, type: 'article', alt,
    robots, includeHreflang: false, keywords: (p.tags || []).join(', '), extraMeta,
  })}
${ld({ '@context': 'https://schema.org', '@graph': graph })}
<link rel="icon" type="image/webp" href="logo.webp">
<link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
${extraFontLinks}
<style>${style}${APP_CSS}${POST_CSS}${fontCss}</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <a class="home" href="${home(lang) || './'}"><img class="logo" src="logo.webp" alt="" width="32" height="32">${esc(title)}</a>
    <nav class="top-nav" aria-label="Sections">
      <a href="${home(lang) || './'}">Apps</a>
      ${webRepos.length ? `<a href="${webHome(lang)}">${esc(t.web)}</a>` : ''}
      <a href="${thinksHome(lang)}" aria-current="section">${esc(t.thinks)}</a>
    </nav>
    <nav class="lang-sw" aria-label="Language"><a href="${alt.en}" data-lang="en" lang="en" hreflang="en"${lang === 'en' ? ' aria-current="page"' : ''}>EN</a><a href="${alt.ko}" data-lang="ko" lang="ko" hreflang="ko"${lang === 'ko' ? ' aria-current="page"' : ''}>한국어</a></nav>
  </header>
  <nav class="crumbs" aria-label="Breadcrumb"><a href="${thinksHome(lang)}">${esc(t.thinks)}</a> › ${esc(p.title)}</nav>
  <div class="post-layout${hasToc ? ' has-toc' : ''}">
    <main class="article-wrap">
      <article lang="${postLang}">
        <div class="article-head">
          <h1>${esc(p.title)}</h1>
          ${metaParts ? `<div class="article-meta">${metaParts}</div>` : ''}
          ${tagsHtml}
        </div>
        ${tocMobileHtml}
        <div class="prose">${bodyHtml}</div>
      </article>
      ${commentsApi ? `<section class="comments" id="comments" data-api="${esc(commentsApi)}" data-slug="${esc(p.slug)}" data-title="${esc(p.title)}"></section>` : ''}
      ${navHtml}
      <a class="back-link" href="${thinksHome(lang)}">${esc(t.backToThinks)}</a>
    </main>
    ${tocSideHtml}
  </div>
  <footer>
    <span></span>
    <span class="foot-r"><button type="button" class="contact-link" data-contact>${lang === 'ko' ? '문의하기' : 'Contact'}</button>
    <span class="credit">Produced with <a href="https://claude.ai" target="_blank" rel="noopener">Claude</a> and <a href="https://gemini.google.com" target="_blank" rel="noopener">Gemini</a></span></span>
  </footer>
</div>
${appScript(lang, alt)}
${hasToc ? postTocScript() : ''}
${postLightboxScript(lang === 'ko' ? '닫기' : 'Close')}
${commentsApi ? `<script src="comments.js?v=${ver}" defer></script>` : ''}
<script src="contact.js?v=${ver}" defer></script>
</body>
</html>
`;
}

let totalTocHeadings = 0;
for (let i = 0; i < posts.length; i++) {
  const p = posts[i];
  const prepared = extractToc(p.html || '');
  totalTocHeadings += prepared.toc.length;
  for (const lang of LANGS) {
    const dirPath = postPathDisk(p, lang);
    await mkdir(`${SITE_DIR}/${dirPath}`, { recursive: true });
    await writeFile(`${SITE_DIR}/${dirPath}index.html`, postPage(p, i, lang, prepared));
  }
  const pLang = postLangOf(p);
  pages.push({
    singleLang: pLang,
    loc: postPathUrl(p, pLang),
    lastmod: (p.updatedAt || p.publishedAt || thinksGenerated).slice(0, 10),
    priority: '0.8',
    images: p.cover ? { [pLang]: [abs(p.cover)] } : undefined,
  });
}

// ── sitemap.xml (다국어 페이지는 hreflang 묶음, 단일 언어 글은 대표 URL 1개만) / robots.txt ──
const urlEntries = pages.flatMap((p) => {
  if (p.singleLang) {
    return [`  <url>
    <loc>${esc(siteUrl + p.loc)}</loc>
    <lastmod>${p.lastmod}</lastmod>
    <priority>${p.priority}</priority>${(p.images?.[p.singleLang] || []).map((u) => `
    <image:image><image:loc>${esc(u)}</image:loc></image:image>`).join('')}
  </url>`];
  }
  return LANGS.map((lang) => `  <url>
    <loc>${esc(siteUrl + p.alt[lang])}</loc>
${LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${esc(siteUrl + p.alt[l])}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(siteUrl + p.alt.en)}"/>
    <lastmod>${p.lastmod}</lastmod>
    <priority>${p.priority}</priority>${(p.images?.[lang] || []).map((u) => `
    <image:image><image:loc>${esc(u)}</image:loc></image:image>`).join('')}
  </url>`);
});
await writeFile(`${SITE_DIR}/sitemap.xml`,
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urlEntries.join('\n')}\n</urlset>\n`);
await writeFile(`${SITE_DIR}/robots.txt`, `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}sitemap.xml\n`);

// ── RSS 2.0 피드 (/rss.xml) — 네이버 서치어드바이저 RSS 제출 및 피드 구독용 ──
const rssItems = [
  ...posts.map((p) => ({
    title: p.title,
    link: siteUrl + postCanonicalPath(p),
    guid: siteUrl + postCanonicalPath(p),
    pubDate: new Date(p.publishedAt || thinksFull.generatedAt || Date.now()),
    desc: p.excerpt || p.title,
    categories: ['Thinks', ...(p.tags || [])],
  })),
  ...repos.map((r) => ({
    title: `${nameOf(r, 'ko')}${loc(r, 'subtitle', 'ko') ? ` — ${loc(r, 'subtitle', 'ko')}` : ''}`,
    link: siteUrl + appPath(r, 'ko'),
    guid: `${siteUrl}${appPath(r, 'ko')}#${r.release?.tag || 'latest'}`,
    pubDate: new Date(r.release?.publishedAt || r.pushedAt || data.generatedAt || Date.now()),
    desc: loc(r, 'description', 'ko') || loc(r, 'description', 'en') || nameOf(r, 'ko'),
    categories: ['Apps', ...(r.topics || []).slice(0, 4)],
  })),
].sort((a, b) => b.pubDate - a.pubDate).slice(0, 50);

const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(title)}</title>
  <link>${esc(siteUrl)}</link>
  <description>${esc(loc(cfg, 'tagline', 'ko') || loc(cfg, 'tagline', 'en') || title)}</description>
  <language>ko</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
  <atom:link href="${esc(siteUrl)}rss.xml" rel="self" type="application/rss+xml"/>
${rssItems.map((it) => `  <item>
    <title>${esc(it.title)}</title>
    <link>${esc(it.link)}</link>
    <guid isPermaLink="${it.guid === it.link ? 'true' : 'false'}">${esc(it.guid)}</guid>
    <pubDate>${it.pubDate.toUTCString()}</pubDate>
    <description>${esc(it.desc)}</description>${it.categories.map((c) => `
    <category>${esc(c)}</category>`).join('')}
  </item>`).join('\n')}
</channel>
</rss>
`;
await writeFile(`${SITE_DIR}/rss.xml`, rssXml);

// ── AI 검색(GEO)용 /llms.txt ──
const llmsLines = [
  `# ${title}`,
  '',
  `> ${loc(cfg, 'tagline', 'en')}`,
  `> ${loc(cfg, 'tagline', 'ko')}`,
  '',
  `- Site (EN): ${siteUrl}`,
  `- Site (KO): ${siteUrl}ko/`,
  ...(webRepos.length ? [`- Web apps (EN/KO): ${siteUrl}web/ · ${siteUrl}ko/web/`] : []),
  `- Thinks (EN/KO): ${siteUrl}thinks/ · ${siteUrl}ko/thinks/`,
  `- Sitemap: ${siteUrl}sitemap.xml`,
  `- RSS Feed: ${siteUrl}rss.xml`,
  '',
  '## Apps',
  '',
  ...repos.map((r) => {
    const subEn = loc(r, 'subtitle', 'en');
    const subKo = loc(r, 'subtitle', 'ko');
    const descEn = loc(r, 'description', 'en');
    const descKo = loc(r, 'description', 'ko');
    const os = osList(r).join(', ');
    return [
      `### ${nameOf(r, 'en')}${nameOf(r, 'ko') !== nameOf(r, 'en') ? ` (${nameOf(r, 'ko')})` : ''}`,
      `- EN: ${siteUrl}${appPath(r, 'en')}`,
      `- KO: ${siteUrl}${appPath(r, 'ko')}`,
      os && `- Platforms: ${os}${r.release?.tag ? ` (Latest: ${r.release.tag})` : ''}`,
      (subEn || descEn) && `- Summary (EN): ${[subEn, descEn].filter(Boolean).join(' — ')}`,
      (subKo || descKo) && `- 요약 (KO): ${[subKo, descKo].filter(Boolean).join(' — ')}`,
      '',
    ].filter((x) => x !== false && x !== undefined).join('\n');
  }),
  ...(posts.length ? [
    '## Thinks (Essays & Books)',
    '',
    ...posts.map((p) => {
      const url = siteUrl + postCanonicalPath(p);
      return [
        `- [${p.title}](${url})${p.tags?.length ? ` [${p.tags.join(', ')}]` : ''}`,
        p.excerpt ? `  ${p.excerpt}` : '',
      ].filter(Boolean).join('\n');
    }),
    '',
  ] : []),
];
await writeFile(`${SITE_DIR}/llms.txt`, llmsLines.join('\n'));

// ── 404.html (GitHub Pages가 없는 주소에서 보여 줌) — 검색에 넣지 않고 홈으로 안내 ──
await writeFile(`${SITE_DIR}/404.html`, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<base href="/">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found · ${esc(title)}</title>
<meta name="robots" content="noindex">
<link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">
<style>${style}
  .nf { text-align: center; padding: 120px 0 80px; }
  .nf h1 { font-size: 28px; margin: 0 0 12px; }
  .nf p { color: var(--muted); margin: 6px 0; }
  .nf a { color: var(--accent); }
</style>
</head>
<body>
<div class="wrap"><main class="nf">
  <h1>Page not found</h1>
  <p>That page doesn't exist. <a href="./">Apps</a> · <a href="thinks/">Thinks</a></p>
  <p lang="ko">페이지를 찾을 수 없습니다. <a href="ko/">Apps</a> · <a href="ko/thinks/">Thinks</a></p>
</main></div>
</body>
</html>
`);

console.log(`✓ prerender: ${repos.length} apps + ${posts.length} thinks posts (toc headings: ${totalTocHeadings}), ${urlEntries.length} sitemap URLs, rss.xml (${rssItems.length} items), llms.txt, canonical ${siteUrl}`);
