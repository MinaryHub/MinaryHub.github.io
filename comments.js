// Thinks 글 하단 비로그인 공개 피드백·댓글 위젯 (Google Apps Script + Google Sheets 연동)
(() => {
  const root = document.getElementById('comments');
  if (!root) return;
  const API = (root.dataset.api || '').trim();
  const SLUG = root.dataset.slug || '';
  const TITLE = root.dataset.title || document.title;
  if (!API || !SLUG) return;

  const lang = document.documentElement.lang === 'ko' ? 'ko' : 'en';
  const L = {
    en: {
      heading: 'Feedback & Comments',
      subtitle: 'Leave a thought, question, or suggestion — no sign-in required.',
      types: [
        { id: 'thought', label: 'Thought' },
        { id: 'question', label: 'Question' },
        { id: 'suggestion', label: 'Suggestion' },
      ],
      namePh: 'Name (optional — Anonymous if blank)',
      msgPh: 'Share your thoughts or feedback on this post…',
      submit: 'Post feedback',
      sending: 'Sending…',
      anon: 'Anonymous',
      loading: 'Loading comments…',
      empty: 'No feedback yet. Be the first to leave a note!',
      needMsg: 'Please write a message first.',
      tooLong: 'Please keep your message under 2,000 characters.',
      okApproved: 'Thanks! Your feedback has been posted.',
      okPending: 'Thanks! Your feedback was received and will appear after review.',
      loadErr: 'Could not load comments right now.',
      sendErr: 'Could not submit feedback. Please try again in a moment.',
    },
    ko: {
      heading: '피드백 · 댓글',
      subtitle: '로그인 없이 감상평, 질문, 오타·수정 제안을 편하게 남겨주세요.',
      types: [
        { id: 'thought', label: '감상평' },
        { id: 'question', label: '질문' },
        { id: 'suggestion', label: '수정 제안' },
      ],
      namePh: '닉네임 (선택 · 비우면 익명)',
      msgPh: '이 글에 대한 생각이나 피드백을 남겨주세요…',
      submit: '피드백 남기기',
      sending: '등록 중…',
      anon: '익명',
      loading: '댓글을 불러오는 중…',
      empty: '아직 남겨진 피드백이 없습니다. 첫 번째 의견을 남겨보세요!',
      needMsg: '내용을 입력해 주세요.',
      tooLong: '내용은 2,000자 이내로 작성해 주세요.',
      okApproved: '소중한 피드백이 등록되었습니다. 감사합니다!',
      okPending: '피드백이 접수되었습니다. 확인 후 공개됩니다.',
      loadErr: '댓글을 불러오지 못했습니다.',
      sendErr: '등록하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    },
  }[lang];

  const TYPE_LABEL = Object.fromEntries(L.types.map((t) => [t.id, t.label]));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  let savedName = '';
  try { savedName = localStorage.getItem('mh-comment-name') || ''; } catch {}
  const openedAt = Date.now();

  root.innerHTML = `
    <div class="cm-head">
      <h2>${esc(L.heading)} <span class="cm-cnt" id="cmCnt" hidden></span></h2>
      <p class="cm-sub">${esc(L.subtitle)}</p>
    </div>
    <form class="cm-form" id="cmForm" novalidate>
      <div class="cm-types" role="radiogroup" aria-label="${esc(L.heading)}">
        ${L.types.map((tp, i) => `<label class="cm-type"><input type="radio" name="type" value="${tp.id}"${i === 0 ? ' checked' : ''}><span>${esc(tp.label)}</span></label>`).join('')}
      </div>
      <input class="cm-name" name="name" maxlength="40" placeholder="${esc(L.namePh)}" value="${esc(savedName)}" autocomplete="nickname">
      <textarea class="cm-msg" name="message" rows="4" maxlength="2000" placeholder="${esc(L.msgPh)}" required></textarea>
      <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
      <div class="cm-foot">
        <span class="cm-status" id="cmStatus" role="status"></span>
        <button type="submit" class="btn primary cm-btn">${esc(L.submit)}</button>
      </div>
    </form>
    <div class="cm-list" id="cmList"><p class="cm-empty">${esc(L.loading)}</p></div>
  `;

  const form = root.querySelector('#cmForm');
  const statusEl = root.querySelector('#cmStatus');
  const listEl = root.querySelector('#cmList');
  const cntEl = root.querySelector('#cmCnt');
  const btn = form.querySelector('.cm-btn');

  let comments = [];

  function renderList() {
    cntEl.textContent = String(comments.length);
    cntEl.hidden = !comments.length;
    if (!comments.length) {
      listEl.innerHTML = `<p class="cm-empty">${esc(L.empty)}</p>`;
      return;
    }
    listEl.innerHTML = comments.map((c) => {
      const badge = TYPE_LABEL[c.type] ? `<span class="cm-badge">${esc(TYPE_LABEL[c.type])}</span>` : '';
      return `<article class="cm-item">
        <div class="cm-meta">
          <strong class="cm-author">${esc(c.name || L.anon)}</strong>
          ${badge}
          ${c.createdAt ? `<time datetime="${esc(c.createdAt)}">${esc(fmtDate(c.createdAt))}</time>` : ''}
        </div>
        <p class="cm-body">${esc(c.message)}</p>
      </article>`;
    }).join('');
  }

  async function loadComments() {
    try {
      const u = new URL(API);
      u.searchParams.set('action', 'comments');
      u.searchParams.set('slug', SLUG);
      const res = await fetch(u.href, { cache: 'no-cache' });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'load');
      comments = Array.isArray(data.comments) ? data.comments : [];
      renderList();
    } catch {
      listEl.innerHTML = `<p class="cm-empty">${esc(L.loadErr)}</p>`;
    }
  }

  form.addEventListener('input', () => {
    if (statusEl.classList.contains('err')) {
      statusEl.textContent = '';
      statusEl.className = 'cm-status';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    const type = String(fd.get('type') || 'thought').trim();
    const message = String(fd.get('message') || '').trim();
    const website = String(fd.get('website') || '').trim();

    if (!message) {
      statusEl.textContent = L.needMsg;
      statusEl.className = 'cm-status err';
      form.querySelector('[name=message]').focus();
      return;
    }
    if (message.length > 2000) {
      statusEl.textContent = L.tooLong;
      statusEl.className = 'cm-status err';
      return;
    }

    try { if (name) localStorage.setItem('mh-comment-name', name); } catch {}

    btn.disabled = true;
    btn.textContent = L.sending;
    statusEl.textContent = '';
    statusEl.className = 'cm-status';

    try {
      // text/plain 으로 전송해 Google Apps Script 의 CORS preflight(OPTIONS) 우회
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'comment',
          slug: SLUG,
          title: TITLE,
          name,
          type,
          message,
          website,
          page: location.href.split('#')[0],
          openedMs: Date.now() - openedAt,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error || !data.ok) throw new Error(data.error || 'fail');

      form.querySelector('[name=message]').value = '';
      if (data.status === 'pending') {
        statusEl.textContent = L.okPending;
        statusEl.className = 'cm-status ok';
      } else {
        if (data.comment) {
          comments.unshift(data.comment);
          renderList();
        } else {
          loadComments();
        }
        statusEl.textContent = L.okApproved;
        statusEl.className = 'cm-status ok';
      }
    } catch {
      statusEl.textContent = L.sendErr;
      statusEl.className = 'cm-status err';
    } finally {
      btn.disabled = false;
      btn.textContent = L.submit;
    }
  });

  loadComments();
})();
