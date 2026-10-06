const API_URL = import.meta.env.VITE_API_URL || 'https://aftnadzpsxzzujfyblsm.supabase.co/functions/v1/api'
const token = (admin = false) => {
  if (!admin) return localStorage.getItem('community-session') || ''
  try { return JSON.parse(localStorage.getItem('admin-session') || '{}').token || '' } catch { return '' }
}
const request = async (path, options = {}, admin = false) => {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token(admin) ? { Authorization: `Bearer ${token(admin)}` } : {}) }
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: { ...headers, ...options.headers } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || '요청을 처리하지 못했습니다.')
  return data
}
const modal = ({ title, fields, submit }) => {
  document.querySelector('.operation-modal')?.remove()
  const overlay = document.createElement('div'); overlay.className = 'operation-modal'; overlay.style.cssText = 'position:fixed;inset:0;z-index:99;background:#0008;display:grid;place-items:center;padding:20px'
  const form = document.createElement('form'); form.style.cssText = 'width:min(520px,100%);background:#fff;border-radius:14px;padding:24px;display:grid;gap:12px;color:#1d2a44'
  form.innerHTML = `<h2 style="margin:0">${title}</h2>`
  fields.forEach((field) => { const label = document.createElement('label'); label.textContent = field.label; const input = field.multiline ? document.createElement('textarea') : document.createElement('input'); input.name = field.name; input.required = true; input.rows = field.multiline ? 6 : undefined; input.placeholder = field.placeholder || ''; input.style.cssText = 'width:100%;box-sizing:border-box;margin-top:6px;padding:10px;border:1px solid #d9dfeb;border-radius:7px'; label.append(input); form.append(label) })
  const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end'; actions.innerHTML = '<button type="button">취소</button><button class="primary-button">등록</button>'; actions.firstChild.onclick = () => overlay.remove(); form.append(actions)
  form.onsubmit = async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(form)); try { await submit(values); overlay.remove(); window.alert('등록되었습니다.') } catch (error) { window.alert(error.message) } }
  overlay.onclick = (event) => { if (event.target === overlay) overlay.remove() }; overlay.append(form); document.body.append(overlay)
}
const addButton = (host, text, handler) => { if (!host || host.querySelector(`[data-operation="${text}"]`)) return; const button = document.createElement('button'); button.type = 'button'; button.dataset.operation = text; button.className = 'outline-button compact'; button.textContent = text; button.onclick = handler; host.append(button) }
const report = (targetType, targetId) => modal({ title: '신고하기', fields: [{ name: 'reason', label: '신고 사유', placeholder: '예: 욕설, 스팸, 부적절한 내용' }, { name: 'detail', label: '상세 설명', multiline: true }], submit: (value) => request('/reports', { method: 'POST', body: JSON.stringify({ targetType, targetId, ...value }) }) })
const renderMyOperations = async (profile) => {
  if (profile.dataset.operationsLoaded || !token()) return
  profile.dataset.operationsLoaded = 'true'
  const panel = document.createElement('section'); panel.className = 'my-operations'; panel.style.cssText = 'margin-top:22px;padding:20px;background:#fff;border:1px solid #e5e9f1;border-radius:10px'
  panel.innerHTML = '<h2 style="margin-top:0">내 문의 · 신고 내역</h2><p>불러오는 중입니다.</p>'; profile.after(panel)
  try {
    const [inquiries, reports] = await Promise.all([request('/inquiries'), request('/reports')])
    const inquiryRows = inquiries.map(item => `<li><b>문의 · ${item.status}</b><br>${item.subject}<br><small>${item.content}${item.answer ? `<br><strong>관리자 답변:</strong> ${item.answer}` : ''}</small></li>`).join('') || '<li>문의 내역이 없습니다.</li>'
    const reportRows = reports.map(item => `<li><b>신고 · ${item.status}</b><br>${item.target_type} / ${item.reason}<br><small>${item.detail || '상세 설명 없음'}</small></li>`).join('') || '<li>신고 내역이 없습니다.</li>'
    panel.innerHTML = `<h2 style="margin-top:0">내 문의 · 신고 내역</h2><h3>문의하기</h3><ul>${inquiryRows}</ul><h3>신고하기</h3><ul>${reportRows}</ul>`
  } catch (error) { panel.textContent = error.message || '내역을 불러오지 못했습니다.'; delete profile.dataset.operationsLoaded }
}
const connectUserActions = async () => {
  const profile = document.querySelector('.profile-message'); if (profile) { addButton(profile, '문의하기', () => modal({ title: '문의하기', fields: [{ name: 'subject', label: '제목' }, { name: 'content', label: '문의 내용', multiline: true }], submit: (value) => request('/inquiries', { method: 'POST', body: JSON.stringify(value) }) })); renderMyOperations(profile) }
  const postId = location.pathname.match(/^\/post\/([^/]+)/)?.[1]; if (!postId) return
  addButton(document.querySelector('.detail-footer'), '신고하기', () => report('post', postId))
  try { const comments = await request(`/posts/${postId}/comments`); document.querySelectorAll('.comment-item').forEach((node, index) => addButton(node.querySelector('.comment-actions') || node.querySelector('.comment-content'), '신고하기', () => report('comment', comments[index]?.id))) } catch {}
}
const adminPanel = async (kind) => {
  const main = document.querySelector('.admin-main'); if (!main) return
  const panel = document.createElement('section'); panel.className = 'admin-panel operation-admin-panel'; panel.innerHTML = '<p>불러오는 중입니다.</p>'; main.querySelector('.operation-admin-panel')?.remove(); main.append(panel)
  try {
    if (kind === 'dashboard') { const data = await request('/admin/dashboard', {}, true); const cards = main.querySelectorAll('.admin-cards strong'); [data.memberCount, data.postCount, data.pendingInquiries].forEach((value, index) => { if (cards[index]) cards[index].textContent = String(value) }); panel.innerHTML = `<h2>운영 현황</h2><p>회원 ${data.memberCount}명 · 게시글 ${data.postCount}개 · 미답변 문의 ${data.pendingInquiries}건 · 처리 대기 신고 ${data.pendingReports}건</p>`; return }
    if (kind === 'notices') { const notices = await request('/admin/notices', {}, true); panel.innerHTML = `<h2>공지사항</h2><button class="primary-button">공지 작성</button><div class="member-list">${notices.map(n => `<p><b>${n.title}</b><span>${new Date(n.created_at).toLocaleDateString('ko-KR')}</span></p>`).join('') || '<p>공지사항이 없습니다.</p>'}</div>`; panel.querySelector('button').onclick = () => modal({ title: '공지사항 작성', fields: [{ name: 'title', label: '제목' }, { name: 'content', label: '내용', multiline: true }], submit: async (value) => { await request('/admin/notices', { method: 'POST', body: JSON.stringify(value) }, true); adminPanel('notices') } }); return }
    const rows = await request(kind === 'inquiries' ? '/admin/inquiries' : '/admin/reports', {}, true); panel.innerHTML = `<h2>${kind === 'inquiries' ? '문의하기' : '신고 관리'}</h2><div class="member-list">${rows.map(row => `<p data-id="${row.id}"><b>${kind === 'inquiries' ? row.subject : `${row.target_type} · ${row.reason}`}</b><span>${row.content || row.detail || ''}</span><em>${row.status}</em></p>`).join('') || '<p>항목이 없습니다.</p>'}</div>`
    panel.querySelectorAll('[data-id]').forEach((row) => row.onclick = async () => { const id = row.dataset.id; if (kind === 'inquiries') { const answer = window.prompt('답변을 입력하세요.'); if (answer) { await request(`/admin/inquiries/${id}`, { method: 'PATCH', body: JSON.stringify({ answer }) }, true); adminPanel(kind) } } else { const status = window.prompt('상태: reviewing, resolved, dismissed', 'reviewing'); if (status) { await request(`/admin/reports/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }, true); adminPanel(kind) } } })
  } catch (error) { panel.textContent = error.message }
}
const connectAdmin = () => {
  if (!document.querySelector('.admin-main') || !token(true)) return
  const menu = document.querySelector('.admin-menu'); if (!menu || menu.dataset.operations) return; menu.dataset.operations = 'true'
  ;[['공지사항', 'notices'], ['문의하기', 'inquiries'], ['신고 관리', 'reports']].forEach(([label, kind]) => { const button = document.createElement('button'); button.textContent = label; button.onclick = () => adminPanel(kind); menu.append(button) })
  adminPanel('dashboard')
}
const showNotice = async () => {
  if (location.pathname !== '/' || document.body.dataset.noticeLoaded) return
  document.body.dataset.noticeLoaded = 'true'
  try {
    const notices = await request('/notices'); const notice = notices[0]
    const storageKey = `notice-snooze:${notice?.id || ''}`
    if (!notice || Number(localStorage.getItem(storageKey) || 0) > Date.now()) return
    document.querySelector('.operation-modal')?.remove()
    const overlay = document.createElement('div'); overlay.className = 'operation-modal'; overlay.style.cssText = 'position:fixed;inset:0;z-index:99;background:#0008;display:grid;place-items:center;padding:20px'
    const box = document.createElement('section'); box.style.cssText = 'width:min(520px,100%);background:#fff;border-radius:14px;padding:24px;color:#1d2a44;position:relative'
    box.innerHTML = `<button type="button" aria-label="닫기" style="position:absolute;right:16px;top:12px;border:0;background:none;font-size:24px">×</button><h2 style="margin:0 32px 12px 0">${notice.title}</h2><p style="white-space:pre-wrap;line-height:1.6">${notice.content}</p><label style="display:flex;gap:8px;align-items:center;margin-top:20px"><input type="checkbox"> 24시간 동안 보지 않기</label><div style="text-align:right;margin-top:16px"><button type="button" class="primary-button">닫기</button></div>`
    const close = () => { if (box.querySelector('input').checked) localStorage.setItem(storageKey, String(Date.now() + 24 * 60 * 60 * 1000)); overlay.remove() }
    box.querySelector('[aria-label="닫기"]').onclick = close; box.querySelector('.primary-button').onclick = close; overlay.onclick = (event) => { if (event.target === overlay) close() }
    overlay.append(box); document.body.append(overlay)
  } catch {}
}
const legalModal = (title, content) => {
  document.querySelector('.legal-modal')?.remove()
  const overlay = document.createElement('div'); overlay.className = 'legal-modal'; overlay.style.cssText = 'position:fixed;inset:0;z-index:100;background:#0008;display:grid;place-items:center;padding:20px'
  const box = document.createElement('section'); box.style.cssText = 'width:min(760px,100%);max-height:80vh;overflow:auto;background:#fff;border-radius:14px;padding:28px;color:#1d2a44;position:relative;line-height:1.65'
  box.innerHTML = `<button type="button" aria-label="닫기" style="position:absolute;right:16px;top:12px;border:0;background:none;font-size:24px">×</button><h1 style="margin-top:0">${title}</h1>${content}<p style="margin-top:24px;color:#667085">시행일: 2026년 10월 7일</p>`
  const close = () => overlay.remove(); box.querySelector('button').onclick = close; overlay.onclick = (event) => { if (event.target === overlay) close() }; overlay.append(box); document.body.append(overlay)
}
const termsContent = `<h2>제1조 목적</h2><p>본 약관은 온마을 커뮤니티(이하 “서비스”)의 이용 조건과 회원 및 운영자의 권리·의무를 정합니다.</p><h2>제2조 회원가입과 계정</h2><p>회원은 정확한 정보를 제공해야 하며, 계정의 관리 책임은 회원에게 있습니다. 타인의 계정 사용, 허위 정보 등록, 운영 방해 행위는 금지됩니다.</p><h2>제3조 게시물과 이용자 준수사항</h2><p>회원은 법령을 위반하거나 타인의 권리를 침해하는 내용, 욕설·혐오·차별, 광고·스팸, 개인정보 무단 공개, 음란·불법 정보를 게시해서는 안 됩니다. 운영자는 신고 또는 검토 결과에 따라 게시물·댓글을 숨김 또는 삭제하고 이용을 제한할 수 있습니다.</p><h2>제4조 서비스 변경 및 책임</h2><p>서비스는 운영상 필요에 따라 기능을 변경하거나 중단할 수 있습니다. 회원이 작성한 콘텐츠의 책임은 작성자에게 있으며, 서비스는 법령상 책임이 있는 경우를 제외하고 회원 간 분쟁에 대해 책임을 지지 않습니다.</p><h2>제5조 문의 및 약관 변경</h2><p>서비스 관련 문의는 프로필의 문의하기 기능으로 접수할 수 있습니다. 약관 변경 시 서비스 내 공지 등 합리적인 방법으로 안내합니다.</p>`
const privacyContent = `<h2>1. 수집하는 개인정보와 목적</h2><p>서비스는 회원가입·로그인, 게시글·댓글 작성, 문의·신고 처리 및 서비스 운영을 위해 이메일 주소, 닉네임(표시 이름), 인증 식별자, 작성 콘텐츠를 처리합니다.</p><h2>2. 보유 및 이용 기간</h2><p>개인정보는 회원 탈퇴 또는 처리 목적 달성 시까지 보유합니다. 다만 법령상 보존 의무가 있는 정보는 해당 기간 동안 보관합니다.</p><h2>3. 제3자 제공과 처리 위탁</h2><p>서비스는 법령상 근거 또는 별도 동의가 없는 한 개인정보를 제3자에게 제공하지 않습니다. 서비스 운영을 위해 Supabase(인증·데이터베이스)와 Vercel(웹 호스팅)을 이용할 수 있습니다.</p><h2>4. 이용자 권리</h2><p>이용자는 자신의 개인정보에 대한 열람·정정·삭제·처리정지를 요청할 수 있으며, 프로필의 문의하기 기능으로 요청할 수 있습니다.</p><h2>5. 안전성 및 쿠키</h2><p>서비스는 접근 통제 등 합리적인 보호조치를 적용합니다. 로그인 유지와 서비스 제공을 위해 브라우저 저장소를 사용할 수 있으며, 이용자는 브라우저 설정에서 이를 관리할 수 있습니다.</p><h2>6. 문의 및 변경</h2><p>개인정보 관련 문의는 서비스 내 문의하기 기능으로 접수할 수 있습니다. 처리방침이 변경되면 시행 전 서비스 내 공지로 알립니다.</p>`
const connectLegal = () => {
  const footer = document.querySelector('footer'); if (!footer || footer.dataset.legalLinks) return; footer.dataset.legalLinks = 'true'
  const links = document.createElement('span'); links.style.cssText = 'display:inline-flex;gap:10px;margin-left:12px'; links.innerHTML = '<button type="button">이용약관</button><button type="button">개인정보처리방침</button>'; links.querySelectorAll('button').forEach((button) => { button.style.cssText = 'border:0;background:none;padding:0;color:inherit;text-decoration:underline;cursor:pointer'; button.onclick = () => legalModal(button.textContent, button.textContent === '이용약관' ? termsContent : privacyContent) }); footer.append(links)
}
const connect = () => { connectUserActions(); connectAdmin(); showNotice(); connectLegal() }
new MutationObserver(connect).observe(document.documentElement, { childList: true, subtree: true })
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', connect); else connect()
