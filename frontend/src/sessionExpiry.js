const TTL = 24 * 60 * 60 * 1000
const sessions = [
  { token: 'community-session', user: 'community-user', started: 'community-session-start' },
  { token: 'admin-session', user: 'admin-session', started: 'admin-session-start' },
]

const clearSession = (item) => {
  localStorage.removeItem(item.token)
  localStorage.removeItem(item.user)
  localStorage.removeItem(item.started)
}

const setStartedAt = (item) => localStorage.setItem(item.started, String(Date.now()))
const originalSetItem = Storage.prototype.setItem
Storage.prototype.setItem = function (key, value) {
  originalSetItem.call(this, key, value)
  const item = sessions.find((candidate) => candidate.token === key)
  if (item && this === localStorage) originalSetItem.call(this, item.started, String(Date.now()))
}

const enforceExpiry = () => {
  let expired = false
  sessions.forEach((item) => {
    if (!localStorage.getItem(item.token)) return
    const started = Number(localStorage.getItem(item.started))
    if (!started) { setStartedAt(item); return }
    if (Date.now() - started >= TTL) { clearSession(item); expired = true }
  })
  if (expired) window.location.assign('/')
}

enforceExpiry()
window.setInterval(enforceExpiry, 60 * 1000)
