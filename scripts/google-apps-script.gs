/**
 * MinaryHub Thinks — Google Drive → JSON Feed (Google Apps Script)
 *
 * 사용 방법:
 * 1. https://script.google.com 에서 새 프로젝트를 만들고 이 파일 전체를 붙여넣습니다.
 * 2. 아래 FOLDER_ID 에 글을 저장할 Google Drive 폴더 ID를 넣습니다.
 *    (폴더 주소 https://drive.google.com/drive/folders/<여기가_폴더_ID>)
 *    또는 [프로젝트 설정 → 스크립트 속성]에 FOLDER_ID / SECRET_TOKEN 을 등록해도 됩니다.
 * 3. 상단 실행 메뉴에서 `testRun` 함수를 한 번 실행해 Google Drive/Docs 권한을 승인합니다.
 * 4. [배포 → 새 배포 → 유형: 웹 앱]
 *    - 다음 사용자 권한으로 실행: 나(본인 계정)
 *    - 액세스 권한이 있는 사용자: 모든 사용자
 *    → 발급된 웹 앱 URL을 GitHub 저장소 Secrets 의 `THINKS_FEED_URL` 에 등록합니다.
 *      (SECRET_TOKEN 을 설정했다면 GitHub Secrets 의 `THINKS_FEED_TOKEN` 에도 같은 값을 등록)
 *
 * 글 작성 규칙:
 * - Google Docs 문서, Markdown(.md), 텍스트(.txt) 파일을 모두 자동으로 읽습니다.
 * - 파일 이름이 `_`, `.`, `[draft]`, `[초안]`, `draft:` 로 시작하면 초안으로 간주해 공개하지 않습니다.
 * - 1단계 하위 폴더를 만들면 폴더 이름이 자동으로 태그(tag)로 붙습니다.
 * - 문서 맨 앞에 선택적으로 메타데이터를 넣을 수 있습니다 (생략 시 파일명·작성일 자동 사용):
 *     ---
 *     title: 글 제목 (생략 시 파일명)
 *     date: 2026-11-21
 *     tags: 생각, 개발, AI
 *     summary: 목록에 표시할 한 줄 요약
 *     slug: custom-url-slug
 *     draft: false
 *     ---
 */

const FOLDER_ID = '여기에_구글_드라이브_폴더_ID_입력';
const SECRET_TOKEN = ''; // 선택: 비워 두면 토큰 검사 안 함. 설정 시 ?token=... 필요
const INCLUDE_SUBFOLDERS = true;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 이미지 1장 최대 4MB

function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  return {
    folderId: (props.getProperty('FOLDER_ID') || FOLDER_ID || '').trim(),
    secretToken: (props.getProperty('SECRET_TOKEN') || SECRET_TOKEN || '').trim(),
  };
}

function doGet(e) {
  const cfg = getConfig_();
  const reqToken = (e && e.parameter && e.parameter.token) ? String(e.parameter.token).trim() : '';

  if (cfg.secretToken && reqToken !== cfg.secretToken) {
    return jsonResponse_({ error: 'Unauthorized' });
  }
  if (!cfg.folderId || cfg.folderId === '여기에_구글_드라이브_폴더_ID_입력') {
    return jsonResponse_({ error: 'FOLDER_ID is not configured' });
  }

  try {
    const posts = collectPosts_(cfg.folderId);
    return jsonResponse_({
      generatedAt: new Date().toISOString(),
      source: 'google-drive',
      posts: posts,
    });
  } catch (err) {
    return jsonResponse_({ error: String(err && err.message ? err.message : err) });
  }
}

/**
 * 권한 승인 및 동작 확인용 테스트 함수 (Apps Script 편집기에서 직접 실행)
 */
function testRun() {
  const cfg = getConfig_();
  const posts = collectPosts_(cfg.folderId);
  Logger.log('수집된 글 수: ' + posts.length);
  posts.forEach(function (p) {
    Logger.log('- ' + p.title + ' (' + p.format + ', ' + p.publishedAt + ', tags=' + (p.tags || []).join(',') + ')');
  });
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function isDraftName_(name) {
  return /^([_. ]|\[draft\]|\[초안\]|draft:)/i.test(String(name || '').trim());
}

function collectPosts_(folderId) {
  const root = DriveApp.getFolderById(folderId);
  const posts = [];

  scanFolder_(root, [], posts);

  if (INCLUDE_SUBFOLDERS) {
    const subs = root.getFolders();
    while (subs.hasNext()) {
      const sub = subs.next();
      if (sub.isTrashed() || isDraftName_(sub.getName())) continue;
      scanFolder_(sub, [sub.getName().trim()], posts);
    }
  }

  posts.sort(function (a, b) {
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });
  return posts;
}

function scanFolder_(folder, folderTags, posts) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.isTrashed()) continue;
    const name = file.getName();
    if (isDraftName_(name)) continue;

    const mime = file.getMimeType();
    const isDoc = mime === MimeType.GOOGLE_DOCS;
    const isMd = /\.(md|markdown)$/i.test(name) || mime === 'text/markdown' || mime === 'text/x-markdown';
    const isTxt = /\.txt$/i.test(name) || mime === MimeType.PLAIN_TEXT;

    if (!isDoc && !isMd && !isTxt) continue;

    try {
      const post = isDoc
        ? readGoogleDoc_(file, folderTags)
        : readTextFile_(file, isMd ? 'markdown' : 'text', folderTags);
      if (post) posts.push(post);
    } catch (err) {
      Logger.log('파일 읽기 실패 (' + name + '): ' + err);
    }
  }
}

function readTextFile_(file, format, folderTags) {
  const fileName = file.getName();
  const baseTitle = fileName.replace(/\.(md|markdown|txt)$/i, '').trim();
  const raw = file.getBlob().getDataAsString('UTF-8');
  return {
    id: file.getId(),
    fileName: fileName,
    title: baseTitle,
    tags: folderTags.slice(),
    publishedAt: file.getDateCreated().toISOString(),
    updatedAt: file.getLastUpdated().toISOString(),
    format: format,
    raw: raw,
  };
}

function readGoogleDoc_(file, folderTags) {
  const doc = DocumentApp.openById(file.getId());
  const body = doc.getBody();
  const total = body.getNumChildren();

  // 선택적 frontmatter (맨 앞 '---' ... '---') 파싱
  const meta = {};
  let startIndex = 0;
  let firstNonEmpty = -1;
  for (let i = 0; i < total; i++) {
    const el = body.getChild(i);
    if (el.getType() === DocumentApp.ElementType.PARAGRAPH) {
      const txt = el.asParagraph().getText().trim();
      if (!txt) continue;
      firstNonEmpty = i;
      break;
    } else {
      break;
    }
  }

  if (firstNonEmpty !== -1 && body.getChild(firstNonEmpty).asParagraph().getText().trim() === '---') {
    let closeIdx = -1;
    const maxScan = Math.min(total, firstNonEmpty + 20);
    for (let i = firstNonEmpty + 1; i < maxScan; i++) {
      const el = body.getChild(i);
      if (el.getType() !== DocumentApp.ElementType.PARAGRAPH) break;
      const line = el.asParagraph().getText().trim();
      if (line === '---') {
        closeIdx = i;
        break;
      }
      const m = line.match(/^([a-zA-Z_-]+)\s*:\s*(.*)$/);
      if (m) {
        meta[m[1].toLowerCase()] = m[2].trim();
      }
    }
    if (closeIdx !== -1) {
      startIndex = closeIdx + 1;
    }
  }

  if (/^(true|yes|1)$/i.test(meta.draft || '')) {
    return null;
  }

  const images = [];
  const htmlParts = [];
  let listStack = []; // [{ tag: 'ul'|'ol', level: number }]
  let codeLines = [];

  function flushCode() {
    if (!codeLines.length) return;
    htmlParts.push('<pre><code>' + escHtml_(codeLines.join('\n')) + '</code></pre>');
    codeLines = [];
  }

  function closeLists(targetLevel) {
    while (listStack.length > targetLevel) {
      const top = listStack.pop();
      htmlParts.push('</' + top.tag + '>');
    }
  }

  for (let i = startIndex; i < total; i++) {
    const el = body.getChild(i);
    const type = el.getType();

    if (type === DocumentApp.ElementType.LIST_ITEM) {
      flushCode();
      const item = el.asListItem();
      const level = item.getNestingLevel();
      const tag = isOrderedGlyph_(item.getGlyphType()) ? 'ol' : 'ul';

      while (listStack.length > level + 1) {
        htmlParts.push('</' + listStack.pop().tag + '>');
      }
      if (listStack.length === level + 1 && listStack[level].tag !== tag) {
        htmlParts.push('</' + listStack.pop().tag + '>');
      }
      while (listStack.length <= level) {
        listStack.push({ tag: tag, level: listStack.length });
        htmlParts.push('<' + tag + '>');
      }

      const content = renderContainer_(item, images);
      if (content) htmlParts.push('<li>' + content + '</li>');
      continue;
    }

    closeLists(0);

    if (type === DocumentApp.ElementType.PARAGRAPH) {
      const p = el.asParagraph();
      const heading = p.getHeading();
      const rawText = p.getText();

      if (heading === DocumentApp.ParagraphHeading.NORMAL && isCodeParagraph_(p)) {
        codeLines.push(rawText);
        continue;
      }

      flushCode();

      const inner = renderContainer_(p, images);
      if (!inner || !inner.trim()) continue;

      const hTag = headingToTag_(heading);
      if (hTag) {
        htmlParts.push('<' + hTag + '>' + inner + '</' + hTag + '>');
      } else if (p.getIndentStart && p.getIndentStart() >= 24 && rawText.trim()) {
        htmlParts.push('<blockquote><p>' + inner + '</p></blockquote>');
      } else {
        htmlParts.push('<p>' + inner + '</p>');
      }
    } else if (type === DocumentApp.ElementType.HORIZONTAL_RULE) {
      flushCode();
      htmlParts.push('<hr>');
    } else if (type === DocumentApp.ElementType.TABLE) {
      flushCode();
      htmlParts.push(renderTable_(el.asTable(), images));
    }
  }

  flushCode();
  closeLists(0);

  const metaTags = meta.tags
    ? meta.tags.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean)
    : [];
  const allTags = uniqueTags_(folderTags.concat(metaTags));

  const publishedAt = parseMetaDate_(meta.date) || file.getDateCreated().toISOString();
  const updatedAt = parseMetaDate_(meta.updated) || file.getLastUpdated().toISOString();

  return {
    id: file.getId(),
    fileName: file.getName(),
    title: meta.title || file.getName().trim(),
    slug: meta.slug || '',
    summary: meta.summary || '',
    tags: allTags,
    publishedAt: publishedAt,
    updatedAt: updatedAt,
    format: 'html',
    html: htmlParts.join('\n'),
    images: images,
  };
}

function renderContainer_(container, images) {
  const out = [];
  if (typeof container.getPositionedImages === 'function') {
    const posImgs = container.getPositionedImages();
    for (let k = 0; k < posImgs.length; k++) {
      out.push(renderImage_(posImgs[k], images));
    }
  }
  const count = container.getNumChildren();
  for (let i = 0; i < count; i++) {
    const child = container.getChild(i);
    const type = child.getType();
    if (type === DocumentApp.ElementType.TEXT) {
      out.push(renderText_(child.asText()));
    } else if (type === DocumentApp.ElementType.INLINE_IMAGE) {
      out.push(renderImage_(child.asInlineImage(), images));
    } else if (type === DocumentApp.ElementType.HORIZONTAL_RULE) {
      out.push('<hr>');
    }
  }
  return out.join('');
}

function renderText_(textEl) {
  const full = textEl.getText();
  if (!full) return '';
  const indices = textEl.getTextAttributeIndices();
  const out = [];

  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = (i + 1 < indices.length) ? indices[i + 1] : full.length;
    const slice = full.substring(start, end);
    if (!slice) continue;

    let html = escHtml_(slice).replace(/\r?\n/g, '<br>');
    const font = textEl.getFontFamily(start) || '';
    const isMono = /mono|consolas|courier|menlo|monaco|fira code|source code/i.test(font);
    const bold = textEl.isBold(start);
    const italic = textEl.isItalic(start);
    const strike = textEl.isStrikethrough(start);
    const underline = textEl.isUnderline(start);
    const link = textEl.getLinkUrl(start);

    if (isMono) html = '<code>' + html + '</code>';
    if (bold) html = '<strong>' + html + '</strong>';
    if (italic) html = '<em>' + html + '</em>';
    if (strike) html = '<s>' + html + '</s>';
    if (underline && !link) html = '<u>' + html + '</u>';
    if (link && /^https?:\/\//i.test(link)) {
      html = '<a href="' + escAttr_(link) + '" target="_blank" rel="noopener">' + html + '</a>';
    }
    out.push(html);
  }
  return out.join('');
}

function renderImage_(imgEl, images) {
  try {
    const blob = imgEl.getBlob();
    const bytes = blob.getBytes();
    if (!bytes || bytes.length > MAX_IMAGE_BYTES) return '';
    const mime = blob.getContentType() || 'image/png';
    const altDesc = typeof imgEl.getAltDescription === 'function' ? imgEl.getAltDescription() : '';
    const altTitle = typeof imgEl.getAltTitle === 'function' ? imgEl.getAltTitle() : '';
    const alt = (altDesc || altTitle || '').trim();
    const id = 'img-' + images.length;
    images.push({
      id: id,
      mimeType: mime,
      data: Utilities.base64Encode(bytes),
      alt: alt,
    });
    return '<img data-img-id="' + id + '" alt="' + escAttr_(alt) + '" loading="lazy">';
  } catch (err) {
    return '';
  }
}

function renderTable_(table, images) {
  const rows = table.getNumRows();
  if (!rows) return '';
  const parts = ['<div class="tbl-wrap"><table>'];
  for (let r = 0; r < rows; r++) {
    const row = table.getRow(r);
    const cells = row.getNumCells();
    const isHead = r === 0 && rows > 1;
    if (r === 0) parts.push(isHead ? '<thead>' : '<tbody>');
    if (r === 1 && rows > 1) parts.push('<tbody>');
    parts.push('<tr>');
    for (let c = 0; c < cells; c++) {
      const cell = row.getCell(c);
      const cellParts = [];
      for (let k = 0; k < cell.getNumChildren(); k++) {
        const ch = cell.getChild(k);
        if (ch.getType() === DocumentApp.ElementType.PARAGRAPH) {
          const s = renderContainer_(ch.asParagraph(), images);
          if (s) cellParts.push(s);
        }
      }
      const tag = isHead ? 'th' : 'td';
      parts.push('<' + tag + '>' + cellParts.join('<br>') + '</' + tag + '>');
    }
    parts.push('</tr>');
    if (isHead) parts.push('</thead>');
  }
  parts.push('</tbody></table></div>');
  return parts.join('');
}

function isCodeParagraph_(p) {
  if (p.getNumChildren() !== 1) return false;
  const ch = p.getChild(0);
  if (ch.getType() !== DocumentApp.ElementType.TEXT) return false;
  const t = ch.asText();
  const txt = t.getText();
  if (!txt || !txt.trim()) return false;
  const font = t.getFontFamily(0) || '';
  return /mono|consolas|courier|menlo|monaco|fira code|source code/i.test(font);
}

function headingToTag_(heading) {
  switch (heading) {
    case DocumentApp.ParagraphHeading.TITLE:
    case DocumentApp.ParagraphHeading.HEADING1:
    case DocumentApp.ParagraphHeading.HEADING2:
      return 'h2';
    case DocumentApp.ParagraphHeading.SUBTITLE:
    case DocumentApp.ParagraphHeading.HEADING3:
      return 'h3';
    case DocumentApp.ParagraphHeading.HEADING4:
    case DocumentApp.ParagraphHeading.HEADING5:
    case DocumentApp.ParagraphHeading.HEADING6:
      return 'h4';
    default:
      return '';
  }
}

function isOrderedGlyph_(glyph) {
  return glyph === DocumentApp.GlyphType.NUMBER ||
    glyph === DocumentApp.GlyphType.LATIN_UPPER ||
    glyph === DocumentApp.GlyphType.LATIN_LOWER ||
    glyph === DocumentApp.GlyphType.ROMAN_UPPER ||
    glyph === DocumentApp.GlyphType.ROMAN_LOWER;
}

function parseMetaDate_(str) {
  if (!str) return '';
  const d = new Date(str);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function uniqueTags_(list) {
  const seen = {};
  const out = [];
  list.forEach(function (t) {
    const k = String(t || '').trim();
    if (!k) return;
    const low = k.toLowerCase();
    if (!seen[low]) {
      seen[low] = true;
      out.push(k);
    }
  });
  return out;
}

function escHtml_(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escAttr_(s) {
  return escHtml_(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
