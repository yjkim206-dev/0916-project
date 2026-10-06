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
const connectUserActions = async () => {
  const profile = document.querySelector('.profile-message'); if (profile) addButton(profile, '문의하기', () => modal({ title: '문의하기', fields: [{ name: 'subject', label: '제목' }, { name: 'content', label: '문의 내용', multiline: true }], submit: (value) => request('/inquiries', { method: 'POST', body: JSON.stringify(value) }) }))
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
const showNotice = async () => { if (location.pathname !== '/' || document.body.dataset.noticeLoaded) return; document.body.dataset.noticeLoaded = 'true'; try { const notices = await request('/notices'); const notice = notices[0]; if (notice && localStorage.getItem('notice-dismissed') !== notice.id) { modal({ title: notice.title, fields: [], submit: async () => {} }); const form = document.querySelector('.operation-modal form'); form.querySelector('.primary-button').textContent = '확인'; form.onsubmit = (event) => { event.preventDefault(); localStorage.setItem('notice-dismissed', notice.id); form.closest('.operation-modal').remove() } } } catch {} }
const connect = () => { connectUserActions(); connectAdmin(); showNotice() }
new MutationObserver(connect).observe(document.documentElement, { childList: true, subtree: true })
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', connect); else connect()
