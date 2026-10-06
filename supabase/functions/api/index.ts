const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const base = Deno.env.get('SUPABASE_URL')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const bodyOf = async (req: Request) => await req.json().catch(() => ({}))
const tokenOf = (req: Request) => req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
const db = async (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers); headers.set('apikey', serviceKey); headers.set('Authorization', `Bearer ${serviceKey}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${base}/rest/v1/${path}`, { ...init, headers }); const text = await response.text()
  let result: any = null; try { result = text ? JSON.parse(text) : null } catch { result = text }
  if (!response.ok) throw new Error(result?.message || '데이터베이스 요청에 실패했습니다.')
  return result
}
const authUser = async (req: Request) => {
  const token = tokenOf(req); if (!token) return null
  const response = await fetch(`${base}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } })
  return response.ok ? await response.json() : null
}
const profile = async (id: string) => (await db(`profiles?id=eq.${encodeURIComponent(id)}&select=id,name,display_name,role`))?.[0] || null
const adminUser = async (req: Request) => { const user = await authUser(req); const item = user && await profile(user.id); const marker = user && await db(`admin_accounts?user_id=eq.${user.id}&select=user_id`); return item?.role === 'admin' || marker?.length ? { ...user, profile: item } : null }
const authUsers = async () => {
  const response = await fetch(`${base}/auth/v1/admin/users?page=1&per_page=1000`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } })
  const result = await response.json()
  if (!response.ok) throw new Error(result?.msg || result?.message || 'Unable to load users.')
  return result.users || []
}
const posts = async (filter = '') => db(`posts?select=*,profiles:author_id(name,display_name)&${filter}`)
const post = async (id: string) => (await posts(`id=eq.${encodeURIComponent(id)}`))?.[0] || null
const countComments = async (id: string) => (await db(`comments?post_id=eq.${id}&hidden=eq.false&select=id`))?.length || 0
const reaction = async (postId: string, userId?: string) => userId ? (await db(`post_reactions?post_id=eq.${postId}&user_id=eq.${userId}&select=reaction`))?.[0]?.reaction || null : null
const publicPost = async (item: any, userId?: string) => ({ id: item.id, category: item.category, title: item.title, content: item.content, author: item.profiles?.display_name || item.profiles?.name || '회원', authorId: item.author_id, date: item.created_at, updatedAt: item.updated_at, views: item.views || 0, likes: item.likes || 0, dislikes: item.dislikes || 0, comments: await countComments(item.id), hidden: Boolean(item.hidden), reaction: await reaction(item.id, userId) })
const publicComment = (item: any) => ({ id: item.id, postId: item.post_id, content: item.content, author: item.profiles?.display_name || item.profiles?.name || '회원', authorId: item.author_id, date: item.created_at, updatedAt: item.updated_at, hidden: Boolean(item.hidden) })

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const route = new URL(req.url).pathname.replace(/^\/api/, '')
  try {
    if (route === '/auth/signup' || route === '/auth/login') {
      if (req.method !== 'POST') return json({ error: '지원하지 않는 메서드입니다.' }, 405)
      const data = await bodyOf(req); const email = String(data.email || '').trim().toLowerCase(); const password = String(data.password || ''); const name = String(data.name || '').trim()
      if (!email || !password || (route.endsWith('signup') && !name)) return json({ error: '닉네임, 이메일, 비밀번호를 입력해주세요.' }, 400)
      const signup = route.endsWith('signup'); const endpoint = signup ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password'; const payload = signup ? { email, password, data: { name, display_name: name } } : { email, password }
      const response = await fetch(`${base}${endpoint}`, { method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json()
      if (!response.ok) return json({ error: result.msg || result.message || '인증에 실패했습니다.' }, response.status)
      const item = await profile(result.user.id); return json({ user: { id: result.user.id, name: item?.display_name || item?.name || name || email.split('@')[0], email, bio: '' }, token: result.access_token || result.session?.access_token || null }, signup ? 201 : 200)
    }
    if (route === '/auth/password' && req.method === 'POST') {
      const token = tokenOf(req); const user = await authUser(req); const data = await bodyOf(req); const password = String(data.password || '')
      if (!user) return json({ error: 'Login required.' }, 401)
      if (password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400)
      const response = await fetch(`${base}/auth/v1/user`, { method: 'PUT', headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      const result = await response.json().catch(() => ({})); if (!response.ok) return json({ error: result.msg || result.message || 'Password update failed.' }, response.status)
      return json({ ok: true })
    }
    if (route === '/profile' && req.method === 'PATCH') {
      const token = tokenOf(req); const user = await authUser(req); const data = await bodyOf(req)
      if (!user) return json({ error: 'Login required.' }, 401)
      const name = String(data.name || '').trim(); const bio = String(data.bio || '').trim()
      if (!name) return json({ error: 'Display name is required.' }, 400)
      if (bio.length > 500) return json({ error: 'Bio must be 500 characters or fewer.' }, 400)
      const result = await db(`profiles?id=eq.${user.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name, display_name: name, bio }) })
      await db(`user_accounts?user_id=eq.${user.id}`, { method: 'PATCH', body: JSON.stringify({ display_name: name, updated_at: new Date().toISOString() }) })
      const response = await fetch(`${base}/auth/v1/user`, { method: 'PUT', headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { name, display_name: name, bio } }) })
      if (!response.ok) return json({ error: 'Profile update failed.' }, response.status)
      return json({ id: user.id, name: result[0]?.display_name || name, bio })
    }
    if (route === '/posts' && req.method === 'GET') { const user = await authUser(req); return json(await Promise.all((await posts('hidden=eq.false&order=created_at.desc')).map((p: any) => publicPost(p, user?.id)))) }
    if (route === '/posts' && req.method === 'POST') {
      const user = await authUser(req); if (!user) return json({ error: '로그인이 필요합니다.' }, 401); const data = await bodyOf(req)
      if (!String(data.title || '').trim() || !String(data.content || '').trim()) return json({ error: '제목과 내용이 필요합니다.' }, 400)
      const result = await db('posts', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ author_id: user.id, category: String(data.category || '자유').trim(), title: String(data.title).trim(), content: String(data.content).trim() }) })
      return json(await publicPost(result[0], user.id), 201)
    }
    const postMatch = route.match(/^\/posts\/([^/]+)$/)
    if (postMatch) {
      const id = postMatch[1]; const item = await post(id); if (!item) return json({ error: '게시글을 찾을 수 없습니다.' }, 404); const data = await bodyOf(req); const user = await authUser(req)
      if (data.action === 'view') {
        if (!user) return json({ error: '로그인이 필요합니다.' }, 401)
        const inserted = await db('post_views', { method: 'POST', headers: { Prefer: 'return=representation,resolution=ignore-duplicates' }, body: JSON.stringify({ post_id: id, user_id: user.id }) })
        if (inserted?.length) await db(`posts?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ views: (item.views || 0) + 1 }) })
        return json(await publicPost(await post(id), user.id))
      }
      if (req.method === 'DELETE') { if (!user) return json({ error: '로그인이 필요합니다.' }, 401); if (item.author_id !== user.id && !(await adminUser(req))) return json({ error: '작성자만 게시글을 삭제할 수 있습니다.' }, 403); await db(`posts?id=eq.${id}`, { method: 'DELETE' }); return new Response(null, { status: 204, headers: cors }) }
      if (req.method === 'PATCH') {
        if (data.action === 'like' || data.action === 'dislike') return json(await publicPost(item, user?.id))
        if (!user || item.author_id !== user.id) return json({ error: '작성자만 게시글을 수정할 수 있습니다.' }, 403)
        if (!String(data.title || '').trim() || !String(data.content || '').trim()) return json({ error: '제목과 내용이 필요합니다.' }, 400)
        const result = await db(`posts?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ title: String(data.title).trim(), content: String(data.content).trim(), category: String(data.category || item.category).trim(), updated_at: new Date().toISOString() }) }); return json(await publicPost(result[0], user.id))
      }
    }
    const commentsMatch = route.match(/^\/posts\/([^/]+)\/comments$/)
    if (commentsMatch) {
      const postId = commentsMatch[1]; if (!(await post(postId))) return json({ error: '게시글을 찾을 수 없습니다.' }, 404)
      if (req.method === 'GET') return json((await db(`comments?post_id=eq.${postId}&hidden=eq.false&select=*,profiles:author_id(name,display_name)&order=created_at.asc`)).map(publicComment))
      const user = await authUser(req); if (!user) return json({ error: '로그인이 필요합니다.' }, 401); const data = await bodyOf(req)
      if (!String(data.content || '').trim()) return json({ error: '댓글 내용을 입력해주세요.' }, 400)
      const result = await db('comments', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ post_id: postId, author_id: user.id, content: String(data.content).trim() }) }); const full = await db(`comments?id=eq.${result[0].id}&select=*,profiles:author_id(name,display_name)`); return json(publicComment(full[0]), 201)
    }
    const commentMatch = route.match(/^\/comments\/([^/]+)$/)
    if (commentMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
      const user = await authUser(req); if (!user) return json({ error: '로그인이 필요합니다.' }, 401); const id = commentMatch[1]; const item = (await db(`comments?id=eq.${id}&select=*`))?.[0]
      if (!item) return json({ error: '댓글을 찾을 수 없습니다.' }, 404); if (item.author_id !== user.id) return json({ error: '댓글 작성자만 처리할 수 있습니다.' }, 403)
      if (req.method === 'DELETE') { await db(`comments?id=eq.${id}`, { method: 'DELETE' }); return new Response(null, { status: 204, headers: cors }) }
      const data = await bodyOf(req); const result = await db(`comments?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ content: String(data.content || '').trim(), updated_at: new Date().toISOString() }) }); return json(publicComment(result[0]))
    }
    if (route === '/admin/login' && req.method === 'POST') {
      const data = await bodyOf(req); const response = await fetch(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: data.email, password: data.password }) }); const result = await response.json(); if (!response.ok) return json({ error: '관리자 계정 정보가 올바르지 않습니다.' }, 401); const item = await profile(result.user.id); const marker = await db(`admin_accounts?user_id=eq.${result.user.id}&select=user_id`); if (item?.role !== 'admin' && !marker?.length) return json({ error: '관리자 권한이 없습니다.' }, 403); return json({ ok: true, name: item?.name || result.user.email, email: result.user.email, token: result.access_token })
    }
    if (route === '/admin/posts' && req.method === 'GET') { if (!(await adminUser(req))) return json({ error: '관리자 로그인이 필요합니다.' }, 401); return json(await Promise.all((await posts('order=created_at.desc')).map((p: any) => publicPost(p)))) }
    if (route === '/admin/members' && req.method === 'GET') {
      if (!(await adminUser(req))) return json({ error: 'Administrator login is required.' }, 401)
      const [items, users] = await Promise.all([
        db('profiles?select=id,name,display_name,role,created_at&order=created_at.desc'),
        authUsers(),
      ])
      const emails = new Map(users.map((user: any) => [user.id, user.email || '']))
      return json(items.map((item: any) => ({ id: item.id, name: item.display_name || item.name, role: item.role, createdAt: item.created_at, email: emails.get(item.id) || '' })))
    }
    if (route === '/notices' && req.method === 'GET') return json(await db('notices?is_published=eq.true&select=id,title,content,created_at&order=created_at.desc&limit=1'))
    if (route === '/inquiries') {
      const user = await authUser(req); if (!user) return json({ error: 'Login required.' }, 401)
      if (req.method === 'GET') return json(await db(`inquiries?user_id=eq.${user.id}&select=*&order=created_at.desc`))
      if (req.method === 'POST') {
        const data = await bodyOf(req); const subject = String(data.subject || '').trim(); const content = String(data.content || '').trim()
        if (!subject || !content) return json({ error: 'Subject and content are required.' }, 400)
        const result = await db('inquiries', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ user_id: user.id, subject, content }) })
        return json(result[0], 201)
      }
      return json({ error: 'Method not allowed.' }, 405)
    }
    if (route === '/reports') {
      const user = await authUser(req); if (!user) return json({ error: 'Login required.' }, 401)
      if (req.method === 'GET') return json(await db(`reports?reporter_id=eq.${user.id}&select=id,target_type,target_id,reason,detail,status,created_at,handled_at&order=created_at.desc`))
      if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
      const data = await bodyOf(req); const targetType = String(data.targetType || ''); const targetId = String(data.targetId || ''); const reason = String(data.reason || '').trim(); const detail = String(data.detail || '').trim()
      if (!['post', 'comment'].includes(targetType) || !targetId || !reason) return json({ error: 'A report target and reason are required.' }, 400)
      const exists = targetType === 'post' ? await post(targetId) : (await db(`comments?id=eq.${encodeURIComponent(targetId)}&select=id`))?.[0]
      if (!exists) return json({ error: 'Report target not found.' }, 404)
      const result = await db('reports', { method: 'POST', headers: { Prefer: 'return=representation,resolution=merge-duplicates' }, body: JSON.stringify({ reporter_id: user.id, target_type: targetType, target_id: targetId, reason, detail }) })
      return json(result[0], 201)
    }
    if (route === '/admin/dashboard' && req.method === 'GET') {
      if (!(await adminUser(req))) return json({ error: 'Administrator login is required.' }, 401)
      const [members, allPosts, pendingInquiries, pendingReports, recentInquiries, recentReports] = await Promise.all([
        db('profiles?select=id'), db('posts?select=id'), db('inquiries?status=eq.open&select=id'), db('reports?status=in.(open,reviewing)&select=id'),
        db('inquiries?select=id,subject,status,created_at&order=created_at.desc&limit=5'), db('reports?select=id,target_type,reason,status,created_at&order=created_at.desc&limit=5'),
      ])
      return json({ memberCount: members.length, postCount: allPosts.length, pendingInquiries: pendingInquiries.length, pendingReports: pendingReports.length, recentInquiries, recentReports })
    }
    if (route === '/admin/notices') {
      if (!(await adminUser(req))) return json({ error: 'Administrator login is required.' }, 401)
      if (req.method === 'GET') return json(await db('notices?select=*&order=created_at.desc'))
      if (req.method === 'POST') {
        const user = await authUser(req); const data = await bodyOf(req); const title = String(data.title || '').trim(); const content = String(data.content || '').trim()
        if (!title || !content) return json({ error: 'Title and content are required.' }, 400)
        const result = await db('notices', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ title, content, is_published: data.isPublished !== false, author_id: user!.id }) })
        return json(result[0], 201)
      }
    }
    if (route === '/admin/inquiries' && req.method === 'GET') {
      if (!(await adminUser(req))) return json({ error: 'Administrator login is required.' }, 401)
      return json(await db('inquiries?select=*&order=created_at.desc'))
    }
    const adminInquiry = route.match(/^\/admin\/inquiries\/([^/]+)$/)
    if (adminInquiry && req.method === 'PATCH') {
      const admin = await adminUser(req); if (!admin) return json({ error: 'Administrator login is required.' }, 401)
      const data = await bodyOf(req); const answer = String(data.answer || '').trim(); if (!answer) return json({ error: 'Answer is required.' }, 400)
      const result = await db(`inquiries?id=eq.${encodeURIComponent(adminInquiry[1])}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ answer, status: 'answered', answered_by: admin.id, answered_at: new Date().toISOString(), updated_at: new Date().toISOString() }) })
      return json(result[0])
    }
    if (route === '/admin/reports' && req.method === 'GET') {
      if (!(await adminUser(req))) return json({ error: 'Administrator login is required.' }, 401)
      return json(await db('reports?select=*&order=created_at.desc'))
    }
    const adminReport = route.match(/^\/admin\/reports\/([^/]+)$/)
    if (adminReport && req.method === 'PATCH') {
      const admin = await adminUser(req); if (!admin) return json({ error: 'Administrator login is required.' }, 401)
      const data = await bodyOf(req); const status = String(data.status || ''); if (!['open', 'reviewing', 'resolved', 'dismissed'].includes(status)) return json({ error: 'Invalid report status.' }, 400)
      const result = await db(`reports?id=eq.${encodeURIComponent(adminReport[1])}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status, handled_by: admin.id, handled_at: new Date().toISOString(), updated_at: new Date().toISOString() }) })
      return json(result[0])
    }
    const adminPost = route.match(/^\/admin\/posts\/([^/]+)$/)
    if (adminPost && req.method === 'PATCH') { if (!(await adminUser(req))) return json({ error: '관리자 로그인이 필요합니다.' }, 401); const data = await bodyOf(req); if (!['hide', 'show'].includes(data.action)) return json({ error: '지원하지 않는 관리자 작업입니다.' }, 400); const result = await db(`posts?id=eq.${adminPost[1]}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ hidden: data.action === 'hide' }) }); return json(await publicPost(result[0])) }
    if (route === '/health') return json({ ok: true, service: 'supabase-api' })
    return json({ error: '지원하지 않는 API입니다.' }, 404)
  } catch (error) { console.error(error); return json({ error: error instanceof Error ? error.message : '서버 오류가 발생했습니다.' }, 500) }
})
