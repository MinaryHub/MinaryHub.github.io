// 하단 '문의하기': 메일 주소를 드러내지 않고 minaryhub-star 서버(Brevo)로 문의를 보낸다.
// 첫 페이지와 앱 소개 페이지가 함께 쓴다. [data-contact] 버튼을 누르면 창이 열린다.
(() => {
  const API = 'https://minaryhub-star.vercel.app/api/contact';
  const L = {
    en: {
      open: 'Contact', title: 'Contact us', name: 'Name (optional)', email: 'Your email', emailHint: 'Only used to reply to you.',
      app: 'About', general: 'General', message: 'Message', send: 'Send', sending: 'Sending…', cancel: 'Close',
      ok: 'Thanks! Your message was sent. We’ll reply by email.', invalid: 'Please check your email address and message.',
      badEmail: 'Please enter a valid email address so we can reply.', noMessage: 'Please write a message.',
      rate: 'Too many messages. Please try again in a few minutes.', fail: 'Couldn’t send your message. Please try again later.',
    },
    ko: {
      open: '문의하기', title: '문의하기', name: '이름 (선택)', email: '답장 받을 메일', emailHint: '답장할 때만 사용합니다.',
      app: '관련 앱', general: '일반 문의', message: '내용', send: '보내기', sending: '보내는 중…', cancel: '닫기',
      ok: '보냈습니다. 메일로 답장드릴게요.', invalid: '메일 주소와 내용을 확인해 주세요.',
      badEmail: '답장 받을 메일 주소를 올바르게 입력해 주세요.', noMessage: '내용을 입력해 주세요.',
      rate: '잠시 후 다시 보내 주세요.', fail: '보내지 못했습니다. 잠시 후 다시 시도해 주세요.',
    },
  };
  const lang = () => (document.documentElement.lang === 'ko' ? 'ko' : 'en');
  const t = (k) => L[lang()][k];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const label = () => document.querySelectorAll('[data-contact]').forEach((b) => (b.textContent = t('open')));
  label();
  document.addEventListener('mh:lang', label);

  let dlg, openedAt = 0, apps = null;
  async function appList() {
    if (apps) return apps;
    try {
      const d = await fetch('data/repos.json').then((r) => r.json());
      const key = lang() === 'en' ? 'displayNameEn' : 'displayNameKo';
      apps = (d.repos || []).map((r) => ({ name: r.name, label: r[key] || r.displayName || r.name }));
    } catch { apps = []; }
    return apps;
  }

  async function open(preset) {
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.className = 'contact';
      document.body.appendChild(dlg);
    }
    apps = null;
    const list = await appList();
    dlg.innerHTML = `<form method="dialog" novalidate>
      <h2>${t('title')}</h2>
      <label>${t('name')}<input name="name" maxlength="100" autocomplete="name"></label>
      <label>${t('email')}<input name="email" type="email" maxlength="200" required autocomplete="email"><small>${t('emailHint')}</small></label>
      <label>${t('app')}<select name="app"><option value="">${t('general')}</option>${list.map((a) =>
        `<option value="${esc(a.name)}"${a.name === preset ? ' selected' : ''}>${esc(a.label)}</option>`).join('')}</select></label>
      <label>${t('message')}<textarea name="message" rows="6" maxlength="5000" required></textarea></label>
      <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
      <p class="status" role="status"></p>
      <div class="row"><button type="button" class="btn ghost" value="cancel">${t('cancel')}</button><button class="btn primary" type="submit">${t('send')}</button></div>
    </form>`;
    const f = dlg.querySelector('form'), st = dlg.querySelector('.status'), sendBtn = f.querySelector('[type=submit]');
    f.querySelector('.ghost').onclick = () => dlg.close();
    f.oninput = () => { if (st.classList.contains('err')) { st.textContent = ''; st.className = 'status'; } };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f));
      const bad = !/^\S+@\S+\.\S{2,}$/.test(v.email.trim()) ? 'badEmail' : !v.message.trim() ? 'noMessage' : '';
      if (bad) { st.textContent = t(bad); st.className = 'status err'; f.querySelector(bad === 'badEmail' ? '[name=email]' : '[name=message]').focus(); return; }
      sendBtn.disabled = true; sendBtn.textContent = t('sending'); st.textContent = ''; st.className = 'status';
      try {
        const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...v, lang: lang(), page: location.href.split('#')[0], openedMs: Date.now() - openedAt }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'fail');
        f.innerHTML = `<h2>${t('title')}</h2><p class="status ok" role="status">${t('ok')}</p><div class="row"><button class="btn primary" value="cancel">${t('cancel')}</button></div>`;
      } catch (err) {
        st.textContent = t(['invalid', 'rate'].includes(err.message) ? err.message : 'fail'); st.className = 'status err';
        sendBtn.disabled = false; sendBtn.textContent = t('send');
      }
    };
    openedAt = Date.now();
    dlg.showModal();
    f.querySelector('[name=email]').focus();
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-contact]'); if (!b) return;
    e.preventDefault(); open(b.dataset.app || '');
  });
})();
