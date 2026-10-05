const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/api/, '')
  if (!['/auth/signup', '/auth/login'].includes(path) || req.method !== 'POST') return json({ error: '지원하지 않는 API입니다.' }, 404)
  const body = await req.json().catch(() => ({}))
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  const name = String(body.name || '').trim()
  if (!email || !password || (path === '/auth/signup' && !name)) return json({ error: '닉네임, 이메일, 비밀번호를 입력해주세요.' }, 400)
  const base = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const endpoint = path === '/auth/signup' ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password'
  const payload = path === '/auth/signup' ? { email, password, data: { name } } : { email, password }
  const response = await fetch(`${base}${endpoint}`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const data = await response.json()
  if (!response.ok) return json({ error: data.msg || data.message || '인증에 실패했습니다.' }, response.status)
  const user = data.user
  return json({ user: { id: user.id, name: user.user_metadata?.name || name || email.split('@')[0], email, bio: '' }, token: data.access_token || data.session?.access_token || null })
})
