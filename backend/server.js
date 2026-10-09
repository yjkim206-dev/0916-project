import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()
const port = Number(process.env.PORT) || 3000
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173'
const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env')
const postsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'posts.json')
const databasePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'onmaeul.sqlite')
const db = new DatabaseSync(databasePath)
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_accounts (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`)
db.exec(`
  CREATE TABLE IF NOT EXISTS user_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL DEFAULT '자유',
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    author_id INTEGER NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    likes INTEGER NOT NULL DEFAULT 0,
    dislikes INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (author_id) REFERENCES user_accounts(id)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    subject_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
    created_at TEXT NOT NULL
  );
`)
// Existing installations may already have the posts table without the newer
// counter. Keep upgrades additive so existing data is preserved.
try { db.exec('ALTER TABLE posts ADD COLUMN dislikes INTEGER NOT NULL DEFAULT 0') } catch {}
db.exec(`
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES user_accounts(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at);
  CREATE TABLE IF NOT EXISTS post_views (
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (post_id, user_id),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS post_reactions (
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    reaction TEXT NOT NULL CHECK (reaction IN ('like', 'dislike')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (post_id, user_id),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
  );
`)

const normalizeEmail = email => String(email || '').trim().toLowerCase()
const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => ({
  salt,
  hash: crypto.scryptSync(String(password), salt, 64).toString('hex'),
})
const passwordMatches = (password, account) => {
  const actual = Buffer.from(hashPassword(password, account.password_salt).hash, 'hex')
  const expected = Buffer.from(account.password_hash, 'hex')
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}
const getAdminAccount = () => db.prepare('SELECT id, name, email, password_hash, password_salt FROM admin_accounts WHERE id = 1').get()
const publicUser = user => ({ id: user.id, name: user.name, email: user.email, bio: user.bio || '' })
const publicPost = post => ({
  id: post.id,
  category: post.category,
  title: post.title,
  content: post.content,
  author: post.author,
  authorId: post.author_id,
  date: post.created_at,
  updatedAt: post.updated_at,
  views: post.views,
  likes: post.likes,
  dislikes: post.dislikes || 0,
  comments: post.comment_count ?? 0,
  reaction: post.reaction || null,
  hidden: Boolean(post.hidden),
})
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex')
const createSession = (subjectId, role) => {
  const token = crypto.randomBytes(32).toString('hex')
  db.prepare('INSERT INTO sessions (token_hash, subject_id, role, created_at) VALUES (?, ?, ?, ?)').run(tokenHash(token), subjectId, role, new Date().toISOString())
  return token
}
const getSession = req => {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return null
  return db.prepare('SELECT token_hash, subject_id, role FROM sessions WHERE token_hash = ?').get(tokenHash(token)) || null
}
const requireUser = (req, res) => {
  const session = getSession(req)
  if (!session || session.role !== 'user') {
    res.status(401).json({ error: '로그인이 필요합니다.' })
    return null
  }
  const user = db.prepare('SELECT id, name, email, bio FROM user_accounts WHERE id = ?').get(session.subject_id)
  if (!user) {
    res.status(401).json({ error: '유효하지 않은 사용자입니다.' })
    return null
  }
  return user
}
const requireAdmin = (req, res) => {
  const session = getSession(req)
  if (!session || session.role !== 'admin' || session.subject_id !== 1) {
    res.status(401).json({ error: '관리자 로그인이 필요합니다.' })
    return null
  }
  return getAdminAccount()
}
const postQuery = `
  SELECT posts.*, user_accounts.name AS author,
    (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id AND comments.hidden = 0) AS comment_count
  FROM posts JOIN user_accounts ON user_accounts.id = posts.author_id
`
const commentQuery = `
  SELECT comments.*, user_accounts.name AS author, user_accounts.email AS author_email
  FROM comments JOIN user_accounts ON user_accounts.id = comments.author_id
`
const withReaction = (post, userId) => {
  if (!userId) return post
  const reaction = db.prepare('SELECT reaction FROM post_reactions WHERE post_id = ? AND user_id = ?').get(post.id, userId)
  return { ...post, reaction: reaction?.reaction || null }
}
const findPost = (id, userId) => withReaction(db.prepare(`${postQuery} WHERE posts.id = ?`).get(id), userId)
const publicComment = comment => ({
  id: comment.id,
  postId: comment.post_id,
  content: comment.content,
  author: comment.author,
  authorId: comment.author_id,
  date: comment.created_at,
  updatedAt: comment.updated_at,
  hidden: Boolean(comment.hidden),
})

const envEmail = normalizeEmail(process.env.ADMIN_EMAIL)
const envPassword = process.env.ADMIN_PASSWORD
if (!envEmail || !envPassword) {
  throw new Error('ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD를 backend/.env에 설정해야 합니다.')
}
const syncAdminFromEnv = () => {
  const current = getAdminAccount()
  const envName = process.env.ADMIN_NAME?.trim() || '관리자'
  if (current && current.name === envName && current.email === envEmail && passwordMatches(envPassword, current)) return
  const credentials = hashPassword(envPassword)
  db.prepare(`
    INSERT INTO admin_accounts (id, name, email, password_hash, password_salt, updated_at)
    VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      email = excluded.email,
      password_hash = excluded.password_hash,
      password_salt = excluded.password_salt,
      updated_at = excluded.updated_at
  `).run(
    envName,
    envEmail,
    credentials.hash,
    credentials.salt,
    new Date().toISOString(),
  )
}
syncAdminFromEnv()

const readPosts = () => {
  try {
    if (!fs.existsSync(postsPath)) return []
    const posts = JSON.parse(fs.readFileSync(postsPath, 'utf8'))
    return Array.isArray(posts) ? posts : []
  } catch {
    return []
  }
}
const writePosts = (posts) => fs.writeFileSync(postsPath, JSON.stringify(posts, null, 2), 'utf8')

app.use(cors({ origin: (origin, callback) => {
  const allowed = !origin || origin === clientOrigin || origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173'
  callback(null, allowed)
} }))
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'backend',
    timestamp: new Date().toISOString(),
  })
})

app.get('/api', (_req, res) => {
  res.json({ message: 'Backend API is running' })
})

app.post('/api/auth/signup', (req, res) => {
  const { name, email, password } = req.body || {}
  if (!name?.trim() || !email?.trim() || !password || password.length < 8) {
    return res.status(400).json({ error: '닉네임, 이메일, 8자 이상의 비밀번호가 필요합니다.' })
  }
  const credentials = hashPassword(password)
  try {
    const result = db.prepare('INSERT INTO user_accounts (name, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)').run(name.trim(), normalizeEmail(email), credentials.hash, credentials.salt, new Date().toISOString())
    const user = db.prepare('SELECT id, name, email, bio FROM user_accounts WHERE id = ?').get(Number(result.lastInsertRowid))
    return res.status(201).json({ user: publicUser(user), token: createSession(user.id, 'user') })
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: '이미 가입된 이메일입니다.' })
    throw error
  }
})

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {}
  const user = db.prepare('SELECT id, name, email, bio, password_hash, password_salt FROM user_accounts WHERE email = ?').get(normalizeEmail(email))
  if (!user || !passwordMatches(password, user)) return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' })
  return res.json({ user: publicUser(user), token: createSession(user.id, 'user') })
})

app.get('/api/posts', (req, res) => {
  const userId = getSession(req)?.role === 'user' ? getSession(req).subject_id : null
  const posts = db.prepare(`${postQuery} WHERE posts.hidden = 0 ORDER BY posts.created_at DESC`).all()
  res.json(posts.map(post => publicPost(withReaction(post, userId))))
})

app.post('/api/posts', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const { title, content, category = '자유' } = req.body || {}
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: '제목과 내용이 필요합니다.' })
  const now = new Date().toISOString()
  const result = db.prepare('INSERT INTO posts (category, title, content, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(category.trim() || '자유', title.trim(), content.trim(), user.id, now, now)
  const post = db.prepare(`${postQuery} WHERE posts.id = ?`).get(Number(result.lastInsertRowid))
  return res.status(201).json(publicPost(withReaction(post, user.id)))
})

app.patch('/api/posts/:id', (req, res) => {
  const id = Number(req.params.id)
  const post = db.prepare(`${postQuery} WHERE posts.id = ?`).get(id)
  if (!post) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' })
  if (['view', 'like', 'dislike'].includes(req.body?.action)) {
    const user = requireUser(req, res)
    if (!user) return
    const action = req.body.action
    if (action === 'view') {
      const result = db.prepare('INSERT OR IGNORE INTO post_views (post_id, user_id, created_at) VALUES (?, ?, ?)').run(id, user.id, new Date().toISOString())
      if (result.changes) db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(id)
      return res.json(publicPost(findPost(id, user.id)))
    }

    const existing = db.prepare('SELECT reaction FROM post_reactions WHERE post_id = ? AND user_id = ?').get(id, user.id)
    db.exec('BEGIN')
    try {
      if (existing?.reaction === action) {
        db.prepare('DELETE FROM post_reactions WHERE post_id = ? AND user_id = ?').run(id, user.id)
        const column = action === 'like' ? 'likes' : 'dislikes'
        db.prepare(`UPDATE posts SET ${column} = MAX(${column} - 1, 0) WHERE id = ?`).run(id)
      } else {
        if (existing) {
          const previousColumn = existing.reaction === 'like' ? 'likes' : 'dislikes'
          db.prepare(`UPDATE posts SET ${previousColumn} = MAX(${previousColumn} - 1, 0) WHERE id = ?`).run(id)
        }
        db.prepare(`
          INSERT INTO post_reactions (post_id, user_id, reaction, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(post_id, user_id) DO UPDATE SET reaction = excluded.reaction, updated_at = excluded.updated_at
        `).run(id, user.id, action, new Date().toISOString(), new Date().toISOString())
        const column = action === 'like' ? 'likes' : 'dislikes'
        db.prepare(`UPDATE posts SET ${column} = ${column} + 1 WHERE id = ?`).run(id)
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return res.json(publicPost(findPost(id, user.id)))
  }
  const user = requireUser(req, res)
  if (!user) return
  if (post.author_id !== user.id) return res.status(403).json({ error: '작성자만 게시글을 수정할 수 있습니다.' })
  const { title, content, category = post.category } = req.body || {}
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: '제목과 내용이 필요합니다.' })
  db.prepare('UPDATE posts SET category = ?, title = ?, content = ?, updated_at = ? WHERE id = ?').run(category.trim() || '자유', title.trim(), content.trim(), new Date().toISOString(), id)
  return res.json(publicPost(db.prepare(`${postQuery} WHERE posts.id = ?`).get(id)))
})

app.get('/api/posts/:id/comments', (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id = ? AND hidden = 0').get(Number(req.params.id))
  if (!post) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' })
  const comments = db.prepare(`${commentQuery} WHERE comments.post_id = ? AND comments.hidden = 0 ORDER BY comments.created_at ASC`).all(post.id)
  return res.json(comments.map(publicComment))
})

app.post('/api/posts/:id/comments', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const post = db.prepare('SELECT id FROM posts WHERE id = ? AND hidden = 0').get(Number(req.params.id))
  if (!post) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' })
  const content = String(req.body?.content || '').trim()
  if (!content) return res.status(400).json({ error: '댓글 내용을 입력해주세요.' })
  const now = new Date().toISOString()
  const result = db.prepare('INSERT INTO comments (post_id, author_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(post.id, user.id, content, now, now)
  const comment = db.prepare(`${commentQuery} WHERE comments.id = ?`).get(Number(result.lastInsertRowid))
  return res.status(201).json(publicComment(comment))
})

app.patch('/api/comments/:id', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const comment = db.prepare('SELECT id, author_id FROM comments WHERE id = ? AND hidden = 0').get(Number(req.params.id))
  if (!comment) return res.status(404).json({ error: '댓글을 찾을 수 없습니다.' })
  if (comment.author_id !== user.id) return res.status(403).json({ error: '댓글 작성자만 수정할 수 있습니다.' })
  const content = String(req.body?.content || '').trim()
  if (!content) return res.status(400).json({ error: '댓글 내용을 입력해주세요.' })
  db.prepare('UPDATE comments SET content = ?, updated_at = ? WHERE id = ?').run(content, new Date().toISOString(), comment.id)
  return res.json(publicComment(db.prepare(`${commentQuery} WHERE comments.id = ?`).get(comment.id)))
})

app.delete('/api/comments/:id', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  const comment = db.prepare('SELECT id, author_id FROM comments WHERE id = ?').get(Number(req.params.id))
  if (!comment) return res.status(404).json({ error: '댓글을 찾을 수 없습니다.' })
  if (comment.author_id !== user.id) return res.status(403).json({ error: '댓글 작성자만 삭제할 수 있습니다.' })
  db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id)
  return res.status(204).end()
})

app.delete('/api/posts/:id', (req, res) => {
  const id = Number(req.params.id)
  const post = db.prepare('SELECT id, author_id FROM posts WHERE id = ?').get(id)
  if (!post) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' })
  const admin = getSession(req)?.role === 'admin' ? requireAdmin(req, res) : null
  if (!admin) {
    const user = requireUser(req, res)
    if (!user) return
    if (post.author_id !== user.id) return res.status(403).json({ error: '작성자만 게시글을 삭제할 수 있습니다.' })
  }
  db.prepare('DELETE FROM posts WHERE id = ?').run(id)
  return res.status(204).end()
})

app.get('/api/admin/posts', (req, res) => {
  if (!requireAdmin(req, res)) return
  const posts = db.prepare(`${postQuery} ORDER BY posts.created_at DESC`).all()
  return res.json(posts.map(publicPost))
})

app.get('/api/admin/comments', (req, res) => {
  if (!requireAdmin(req, res)) return
  const comments = db.prepare(`${commentQuery} ORDER BY comments.created_at DESC`).all()
  return res.json(comments.map(publicComment))
})

app.patch('/api/admin/comments/:id', (req, res) => {
  if (!requireAdmin(req, res)) return
  const id = Number(req.params.id)
  const comment = db.prepare(`${commentQuery} WHERE comments.id = ?`).get(id)
  if (!comment) return res.status(404).json({ error: '댓글을 찾을 수 없습니다.' })
  if (!['hide', 'show'].includes(req.body?.action)) return res.status(400).json({ error: '지원하지 않는 관리자 작업입니다.' })
  db.prepare('UPDATE comments SET hidden = ? WHERE id = ?').run(req.body.action === 'hide' ? 1 : 0, id)
  return res.json(publicComment(db.prepare(`${commentQuery} WHERE comments.id = ?`).get(id)))
})

app.delete('/api/admin/comments/:id', (req, res) => {
  if (!requireAdmin(req, res)) return
  const result = db.prepare('DELETE FROM comments WHERE id = ?').run(Number(req.params.id))
  if (!result.changes) return res.status(404).json({ error: '댓글을 찾을 수 없습니다.' })
  return res.status(204).end()
})

app.patch('/api/admin/posts/:id', (req, res) => {
  if (!requireAdmin(req, res)) return
  const id = Number(req.params.id)
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(id)
  if (!post) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' })
  if (req.body?.action === 'hide' || req.body?.action === 'show') db.prepare('UPDATE posts SET hidden = ? WHERE id = ?').run(req.body.action === 'hide' ? 1 : 0, id)
  else return res.status(400).json({ error: '지원하지 않는 관리자 작업입니다.' })
  return res.json(publicPost(db.prepare(`${postQuery} WHERE posts.id = ?`).get(id)))
})

app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body || {}
  const account = db.prepare('SELECT id, name, email, password_hash, password_salt FROM admin_accounts WHERE email = ?').get(normalizeEmail(email))
  if (!account || !passwordMatches(password, account)) {
    return res.status(401).json({ error: '관리자 계정 정보가 올바르지 않습니다.' })
  }
  return res.json({ ok: true, name: account.name, email: account.email, token: createSession(account.id, 'admin') })
})

app.patch('/api/admin/account', (req, res) => {
  if (!requireAdmin(req, res)) return
  const { currentPassword, email, password, name } = req.body || {}
  const account = getAdminAccount()
  if (!account || !passwordMatches(currentPassword, account)) {
    return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' })
  }
  const nextEmail = normalizeEmail(email) || account.email
  const nextName = name?.trim() || account.name
  const credentials = password?.trim() ? hashPassword(password) : { hash: account.password_hash, salt: account.password_salt }
  try {
    db.prepare('UPDATE admin_accounts SET name = ?, email = ?, password_hash = ?, password_salt = ?, updated_at = ? WHERE id = 1').run(
      nextName,
      nextEmail,
      credentials.hash,
      credentials.salt,
      new Date().toISOString(),
    )
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: '이미 사용 중인 관리자 이메일입니다.' })
    throw error
  }
  const envContent = `PORT=${process.env.PORT || 3000}\nCLIENT_ORIGIN=${clientOrigin}\nADMIN_EMAIL=${nextEmail}\nADMIN_PASSWORD=${password?.trim() || process.env.ADMIN_PASSWORD}\nADMIN_NAME=${nextName}\n`
  fs.writeFileSync(envPath, envContent, 'utf8')
  Object.assign(process.env, { ADMIN_EMAIL: nextEmail, ADMIN_PASSWORD: password?.trim() || process.env.ADMIN_PASSWORD, ADMIN_NAME: nextName })
  return res.json({ ok: true, name: nextName, email: nextEmail })
})

app.use((_req, res) => {
  res.status(404).json({ error: '요청한 API를 찾을 수 없습니다.' })
})

app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' })
})

app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`)
})
