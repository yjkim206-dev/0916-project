const API_URL = import.meta.env.VITE_API_URL || 'https://aftnadzpsxzzujfyblsm.supabase.co/functions/v1/api'

const renderMembers = async (host) => {
  if (host.dataset.membersLoaded) return
  host.dataset.membersLoaded = 'true'
  host.textContent = '회원 목록을 불러오는 중입니다.'

  try {
    const session = JSON.parse(localStorage.getItem('admin-session') || '{}')
    const response = await fetch(`${API_URL}/admin/members`, { headers: { Authorization: `Bearer ${session.token || ''}` } })
    if (!response.ok) throw new Error('회원 목록을 불러올 수 없습니다.')
    const members = await response.json()
    host.replaceChildren(...(members.length ? members.map((member) => {
      const row = document.createElement('p')
      const name = document.createElement('b')
      const email = document.createElement('span')
      const role = document.createElement('em')
      name.textContent = member.name || '회원'
      email.textContent = member.email || '이메일 없음'
      role.textContent = member.role === 'admin' ? '관리자' : '회원'
      row.append(name, email, role)
      return row
    }) : [Object.assign(document.createElement('p'), { textContent: '등록된 회원이 없습니다.' })]))
  } catch (error) {
    host.textContent = error.message || '회원 목록을 불러오지 못했습니다.'
    delete host.dataset.membersLoaded
  }
}

const connectMemberPanel = () => {
  document.querySelectorAll('.admin-main .member-list').forEach((host) => {
    if (host.textContent.includes('회원 목록 API가 연결되면')) renderMembers(host)
  })
}

new MutationObserver(connectMemberPanel).observe(document.documentElement, { childList: true, subtree: true })
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', connectMemberPanel)
else connectMemberPanel()
