import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './comments.css'

const API_URL = `${window.location.protocol}//${window.location.hostname}:3000/api`
const headers = () => ({ Authorization: `Bearer ${JSON.parse(localStorage.getItem('admin-session') || '{}').token || ''}` })

export default function AdminCommentsPanel() {
  const [comments, setComments] = useState([])
  useEffect(() => { fetch(`${API_URL}/admin/comments`, { headers: headers() }).then(response => response.ok ? response.json() : []).then(setComments) }, [])
  const moderate = async (id, action) => { const response = await fetch(`${API_URL}/admin/comments/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json', ...headers()}, body:JSON.stringify({ action }) }); if (response.ok) { const data = await response.json(); setComments(items => items.map(item => item.id === id ? data : item)) } }
  const remove = async id => { if (!window.confirm('이 댓글을 삭제할까요?')) return; const response = await fetch(`${API_URL}/admin/comments/${id}`, { method:'DELETE', headers:headers() }); if (response.ok) setComments(items => items.filter(item => item.id !== id)) }
  return <div className="admin-panel comments-admin-panel"><div className="panel-title"><div><h2>댓글 관리</h2><p>댓글을 숨기거나 삭제할 수 있습니다.</p></div></div><div className="member-list">{comments.map(comment => <p key={comment.id}><b>{comment.author}</b><span>{comment.content}</span><em>{comment.hidden ? '숨김' : '공개'}</em><button className="outline-button compact" onClick={() => moderate(comment.id, comment.hidden ? 'show' : 'hide')}>{comment.hidden ? '공개' : '숨김'}</button><button className="delete-button" onClick={() => remove(comment.id)}>삭제</button></p>)}{!comments.length && <p>등록된 댓글이 없습니다.</p>}</div></div>
}

// The existing admin page is a single legacy render block. Mount the new
// moderation panel into it when that page becomes available.
if (typeof window !== 'undefined') {
  const mount = () => {
    const host = document.querySelector('.admin-main')
    if (!host || host.querySelector('.comments-admin-mount')) return
    const target = document.createElement('div')
    target.className = 'comments-admin-mount'
    host.appendChild(target)
    createRoot(target).render(<AdminCommentsPanel />)
  }
  new MutationObserver(mount).observe(document.documentElement, { childList:true, subtree:true })
  setTimeout(mount, 0)
}
