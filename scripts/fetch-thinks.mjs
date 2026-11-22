// Google Drive (Apps Script 웹 앱)에서 Thinks 글을 수집해 data/thinks.json 및 data/thinks-full.json 으로 저장합니다.
// GitHub Actions 에서 THINKS_FEED_URL (선택: THINKS_FEED_TOKEN) 환경 변수로 실행됩니다.
// 로컬 테스트: THINKS_FEED_URL="https://script.google.com/macros/s/.../exec" node scripts/fetch-thinks.mjs
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const OUT_INDEX = process.env.THINKS_OUT || 'data/thinks.json';
const OUT_FULL = OUT_INDEX.replace(/[^/]*$/, 'thinks-full.json');
const ASSETS_DIR = process.env.THINKS_ASSETS_DIR || 'data/thinks-assets';

const config = JSON.parse(await readFile('config.json', 'utf8').catch(() => '{}'));
const thinksCfg = config.thinks || {};
const feedUrl = (process.env.THINKS_FEED_URL || thinksCfg.feedUrl || '').trim();
const feedToken = (process.env.THINKS_FEED_TOKEN || '').trim();

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

// ── Frontmatter 파싱 (.md / .txt) ──
function parseFrontmatter(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    meta[kv[1].toLowerCase()] = val;
  }
  return { meta, body: m[2] };
}

function parseTags(raw) {
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  if (!raw) return [];
  const cleaned = String(raw).replace(/^\[|\]$/g, '');
  return cleaned
    .split(/[,，]/)
    .map((t) => t.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function uniqueTags(list) {
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const k = String(t || '').trim();
    if (!k) continue;
    const low = k.toLowerCase();
    if (!seen.has(low)) {
      seen.add(low);
      out.push(k);
    }
  }
  return out;
}

// ── 경량 Markdown → HTML 변환기 (외부 의존성 없음) ──
function renderInlineMd(str) {
  const tokens = [];
  const hold = (html) => {
    const id = `\u0000${tokens.length}\u0000`;
    tokens.push(html);
    return id;
  };
  let s = esc(str);
  // 인라인 코드 먼저 보호
  s = s.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${code}</code>`));
  // 이미지 ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, alt, url) => {
    const safeUrl = sanitizeUrl(url.replace(/&amp;/g, '&'));
    if (!safeUrl) return alt;
    return hold(`<img src="${esc(safeUrl)}" alt="${alt}" loading="lazy">`);
  });
  // 링크 [label](url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const safeUrl = sanitizeUrl(url.replace(/&amp;/g, '&'));
    if (!safeUrl) return label;
    const ext = /^https?:\/\//i.test(safeUrl) ? ' target="_blank" rel="noopener"' : '';
    return hold(`<a href="${esc(safeUrl)}"${ext}>${label}</a>`);
  });
  // 굵게 / 기울임 / 취소선
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  // 토큰 복원
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]);
}

function markdownToHtml(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 빈 줄
    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code block
    const fence = line.match(/^```([\w-]*)\s*$/);
    if (fence) {
      const lang = fence[1] ? ` class="lang-${esc(fence[1])}"` : '';
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      out.push(`<pre><code${lang}>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // Horizontal rule
    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // Heading (# ~ ###### → h2 ~ h4 로 매핑하여 본문 h1 중복 방지)
    const hm = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (hm) {
      const level = hm[1].length;
      const tag = level <= 2 ? 'h2' : level === 3 ? 'h3' : 'h4';
      out.push(`<${tag}>${renderInlineMd(hm[2])}</${tag}>`);
      i++;
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const qLines = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        qLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${markdownToHtml(qLines.join('\n'))}</blockquote>`);
      continue;
    }

    // GFM Table
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])
    ) {
      const splitRow = (r) =>
        r
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());
      const head = splitRow(line);
      i += 2;
      const bodyRows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        bodyRows.push(splitRow(lines[i]));
        i++;
      }
      const thead = `<thead><tr>${head.map((c) => `<th>${renderInlineMd(c)}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${bodyRows
        .map((r) => `<tr>${r.map((c) => `<td>${renderInlineMd(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody>`;
      out.push(`<div class="tbl-wrap"><table>${thead}${tbody}</table></div>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      out.push(`<ul>${items.map((x) => `<li>${renderInlineMd(x)}</li>`).join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out.push(`<ol>${items.map((x) => `<li>${renderInlineMd(x)}</li>`).join('')}</ol>`);
      continue;
    }

    // Paragraph
    const pLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*(?:[-*_]\s*){3,}$/.test(lines[i])
    ) {
      pLines.push(lines[i]);
      i++;
    }
    out.push(`<p>${pLines.map(renderInlineMd).join('<br>')}</p>`);
  }

  return out.join('\n');
}

function plainTextToHtml(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => `<p>${esc(b).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

// ── HTML 안전화 (스크립트·위험 속성·javascript: URL 차단) ──
function sanitizeUrl(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/^(https?:\/\/|mailto:|thinks\/assets\/|\.?\/)/i.test(u)) return u;
  return '';
}

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'code', 'pre',
  'ul', 'ol', 'li', 'blockquote', 'a', 'img',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'figure', 'figcaption',
]);

function sanitizeHtml(html) {
  let s = String(html || '');
  // script/style/iframe 등 위험 블록 통째 제거
  s = s.replace(/<(script|style|iframe|object|embed|form|input|button)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<(script|style|iframe|object|embed|input|meta|link)\b[^>]*\/?>/gi, '');
  // 허용된 태그와 안전한 속성만 남김
  s = s.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (_, slash, rawTag, rawAttrs) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (slash) return `</${tag}>`;

    const attrs = [];
    const attrRe = /([a-zA-Z0-9-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m;
    while ((m = attrRe.exec(rawAttrs))) {
      const name = m[1].toLowerCase();
      const val = m[2] ?? m[3] ?? m[4] ?? '';
      if (name.startsWith('on') || name === 'style') continue;
      if (tag === 'a' && name === 'href') {
        const safe = sanitizeUrl(val);
        if (safe) {
          attrs.push(`href="${esc(safe)}"`);
          if (/^https?:\/\//i.test(safe)) attrs.push('target="_blank"', 'rel="noopener"');
        }
      } else if (tag === 'img' && name === 'src') {
        const safe = sanitizeUrl(val);
        if (safe) attrs.push(`src="${esc(safe)}"`);
      } else if (tag === 'img' && (name === 'alt' || name === 'loading' || name === 'data-img-id')) {
        attrs.push(`${name}="${esc(val)}"`);
      } else if (tag === 'div' && name === 'class' && val === 'tbl-wrap') {
        attrs.push('class="tbl-wrap"');
      } else if (tag === 'code' && name === 'class' && /^lang-[a-zA-Z0-9-]+$/.test(val)) {
        attrs.push(`class="${esc(val)}"`);
      }
    }
    if (tag === 'img' && !attrs.some((a) => a.startsWith('loading='))) {
      attrs.push('loading="lazy"');
    }
    return `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
  });
  return s;
}

// ── 슬러그·요약·읽기 시간 계산 ──
function makeSlug(raw, fallbackId, used) {
  let base = String(raw || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  if (!base) {
    base = 'post-' + String(fallbackId || Date.now().toString(36)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase();
  }
  let slug = base;
  let n = 2;
  while (used.has(slug)) {
    slug = `${base}-${n++}`;
  }
  used.add(slug);
  return slug;
}

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<pre[\s\S]*?<\/pre>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function clipText(str, max = 165) {
  const s = String(str || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

function estimateReadingMinutes(text) {
  const s = String(text || '');
  // 한글/CJK 글자 수(분당 ~420자) + 영문/숫자 단어 수(분당 ~220단어)
  const cjk = (s.match(/[\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/g) || []).length;
  const latinWords = (s.replace(/[\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/g, ' ').match(/[a-zA-Z0-9]+/g) || []).length;
  const mins = cjk / 420 + latinWords / 220;
  return Math.max(1, Math.round(mins));
}

function parseDateIso(val, fallback) {
  if (!val) return fallback;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

// ── 피드 가져오기 ──
async function fetchDriveFeed() {
  if (!feedUrl) return { configured: false, posts: [] };
  const url = new URL(feedUrl);
  if (feedToken) url.searchParams.set('token', feedToken);
  const res = await fetch(url.href, {
    headers: { Accept: 'application/json' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Apps Script HTTP ${res.status}`);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('Apps Script returned non-JSON (check Web App access is set to "Anyone")');
  }
  if (json.error) throw new Error(`Apps Script error: ${json.error}`);
  return { configured: true, posts: Array.isArray(json.posts) ? json.posts : [] };
}

async function main() {
  const generatedAt = new Date().toISOString();
  let drivePosts = [];
  let configured = false;

  if (feedUrl) {
    try {
      const fetched = await fetchDriveFeed();
      configured = fetched.configured;
      drivePosts = fetched.posts;
    } catch (err) {
      console.warn(`⚠ Thinks feed fetch failed (${err.message}) — continuing with fallback/empty list`);
    }
  } else {
    console.log('ℹ THINKS_FEED_URL not set — skipping Google Drive fetch');
  }

  // config.json 의 thinkers.posts(선택적 정적/테스트 글)와 합침
  const configPosts = Array.isArray(thinksCfg.posts) ? thinksCfg.posts : [];
  const combinedRaw = [...drivePosts, ...configPosts];

  await rm(ASSETS_DIR, { recursive: true, force: true });
  const usedSlugs = new Set();
  const fullPosts = [];

  for (const item of combinedRaw) {
    if (!item) continue;
    const format = item.format || (item.html ? 'html' : item.markdown ? 'markdown' : 'text');
    let title = String(item.title || item.fileName || '').replace(/\.(md|markdown|txt)$/i, '').trim();
    let summary = String(item.summary || '').trim();
    let tags = parseTags(item.tags);
    let customSlug = String(item.slug || '').trim();
    let publishedAt = parseDateIso(item.publishedAt || item.date, generatedAt);
    let updatedAt = parseDateIso(item.updatedAt || item.updated, publishedAt);
    let html = '';

    if (format === 'html') {
      html = String(item.html || '');
    } else if (format === 'markdown') {
      const { meta, body } = parseFrontmatter(item.raw ?? item.markdown ?? item.body ?? '');
      if (/^(true|yes|1)$/i.test(meta.draft || '')) continue;
      if (meta.title) title = meta.title;
      if (meta.summary) summary = meta.summary;
      if (meta.slug) customSlug = meta.slug;
      if (meta.date) publishedAt = parseDateIso(meta.date, publishedAt);
      if (meta.updated) updatedAt = parseDateIso(meta.updated, updatedAt);
      if (meta.tags) tags = uniqueTags([...tags, ...parseTags(meta.tags)]);
      html = markdownToHtml(body);
    } else {
      const { meta, body } = parseFrontmatter(item.raw ?? item.body ?? '');
      if (/^(true|yes|1)$/i.test(meta.draft || '')) continue;
      if (meta.title) title = meta.title;
      if (meta.summary) summary = meta.summary;
      if (meta.slug) customSlug = meta.slug;
      if (meta.date) publishedAt = parseDateIso(meta.date, publishedAt);
      if (meta.updated) updatedAt = parseDateIso(meta.updated, updatedAt);
      if (meta.tags) tags = uniqueTags([...tags, ...parseTags(meta.tags)]);
      html = plainTextToHtml(body);
    }

    if (!title) continue;
    const slug = makeSlug(customSlug || title, item.id, usedSlugs);

    // Google Docs 내장 이미지(base64)를 정적 파일로 추출
    const savedImages = [];
    if (Array.isArray(item.images) && item.images.length) {
      const postAssetDir = path.join(ASSETS_DIR, slug);
      await mkdir(postAssetDir, { recursive: true });
      for (let idx = 0; idx < item.images.length; idx++) {
        const img = item.images[idx];
        if (!img?.data) continue;
        const ext = MIME_EXT[String(img.mimeType || '').toLowerCase()] || 'png';
        const fileName = `img-${idx + 1}.${ext}`;
        const buf = Buffer.from(img.data, 'base64');
        await writeFile(path.join(postAssetDir, fileName), buf);
        const relPath = `thinks/assets/${encodeURIComponent(slug)}/${fileName}`;
        savedImages.push({ id: img.id || `img-${idx}`, src: relPath });
      }
      for (const sImg of savedImages) {
        const re = new RegExp(`data-img-id=["']${sImg.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'g');
        html = html.replace(re, `src="${sImg.src}"`);
      }
    }

    // 남아 있는 미치환 data-img-id 이미지 태그 정리 + HTML 안전화
    html = html.replace(/<img\b[^>]*data-img-id=[^>]*>/gi, '');
    html = sanitizeHtml(html);

    const plain = htmlToPlainText(html);
    const excerpt = summary || clipText(plain, 165);
    const readingMinutes = estimateReadingMinutes(plain);

    // 첫 번째 이미지를 커버/공유 미리보기용으로 추출
    const firstImgMatch = html.match(/<img\b[^>]*\bsrc="([^"]+)"/i);
    const cover = item.cover || savedImages[0]?.src || firstImgMatch?.[1] || '';

    fullPosts.push({
      id: item.id || slug,
      slug,
      title,
      excerpt,
      tags: uniqueTags(tags),
      publishedAt,
      updatedAt,
      readingMinutes,
      cover,
      html,
      searchText: [title, ...uniqueTags(tags), excerpt, plain.slice(0, 600)].filter(Boolean).join(' ').toLowerCase(),
    });
  }

  fullPosts.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt) || new Date(b.updatedAt) - new Date(a.updatedAt));

  const indexPosts = fullPosts.map(({ html: _html, ...meta }) => meta);

  await mkdir(path.dirname(OUT_INDEX) || '.', { recursive: true });
  await writeFile(OUT_INDEX, JSON.stringify({ generatedAt, configured, posts: indexPosts }, null, 2));
  await writeFile(OUT_FULL, JSON.stringify({ generatedAt, configured, posts: fullPosts }, null, 2));

  const coverCount = fullPosts.filter((p) => p.cover).length;
  console.log(`✓ ${fullPosts.length} thinks posts (covers: ${coverCount}) → ${OUT_INDEX} & ${OUT_FULL}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
