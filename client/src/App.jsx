import React, { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

const SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000'

export default function App() {
  const [socket, setSocket] = useState(null)
  const [connected, setConnected] = useState(false)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [room, setRoom] = useState('general')
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState([])
  const [users, setUsers] = useState([])
    const [editing, setEditing] = useState(null) // {id,text}
  const [typingUsers, setTypingUsers] = useState([])
  const [admin, setAdmin] = useState(null)
  const typingRef = useRef(null)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    const s = io(SERVER)
    setSocket(s)

    s.on('connect', () => setConnected(true))
    s.on('disconnect', () => setConnected(false))

    s.on('message', (m) => setMessages((prev) => [...prev, m]))
    s.on('system', (payload) => {
      setMessages((prev) => [...prev, { id: 'sys-' + Date.now(), system: true, text: payload.message }])
      if (payload.users) setUsers(payload.users)
    })
    // receive history when joining
    s.on('history', (history) => {
      setMessages(history || [])
    })
    s.on('roomData', ({ users: ulist, admin: adminName }) => {
      if (ulist) setUsers(ulist)
      setAdmin(adminName)
    })

    s.on('typing', ({ username }) => {
      setTypingUsers((prev) => (prev.includes(username) ? prev : [...prev, username]))
    })
    s.on('stopTyping', ({ username }) => {
      setTypingUsers((prev) => prev.filter((u) => u !== username))
    })
    s.on('reaction', ({ messageId, reactions }) => {
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions } : m)))
    })
    s.on('kicked', ({ room, reason }) => {
      setMessages((prev) => [...prev, { id: 'sys-' + Date.now(), system: true, text: reason }])
      // disconnect local socket
      s.disconnect()
      setConnected(false)
    })

    return () => s.close()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function joinRoom() {
    if (!socket) return
    socket.emit('join', { username: username || 'Anonymous', room, email: email || '' })
  }

  function sendMessage() {
    if (!message.trim() || !socket) return
    socket.emit('message', { text: message })
    setMessage('')
    socket.emit('stopTyping')
  }

  // typing handlers
  function handleTyping(e) {
    setMessage(e.target.value)
    if (!socket) return
    socket.emit('typing')
    if (typingRef.current) clearTimeout(typingRef.current)
    typingRef.current = setTimeout(() => socket.emit('stopTyping'), 800)
  }

  function sendReaction(messageId, emoji) {
    if (!socket) return
    // If user already reacted with this emoji, confirm undo
    const msg = messages.find((m) => m.id === messageId) || {};
    const already = msg.reactions && msg.reactions[emoji] && msg.reactions[emoji].includes(username);
    if (already) {
      if (!window.confirm('Remove your reaction?')) return;
    }
    socket.emit('reaction', { messageId, emoji })
  }

  function kickUser(target) {
    if (!socket) return
    socket.emit('kick', { target })
  }

  function startEdit(messageId, currentText) {
    setEditing({ id: messageId, text: currentText })
  }

  function cancelEdit() { setEditing(null) }

  function saveEdit(messageId) {
    if (!socket || !editing) return
    socket.emit('editMessage', { messageId, text: editing.text })
    setEditing(null)
  }

  function confirmDelete(messageId) {
    if (!window.confirm('Delete this message?')) return;
    socket.emit('deleteMessage', { messageId })
  }

  return (
    <div className="app">
      <header className="top">
        <div>
          <input placeholder="Your name" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input placeholder="Room" value={room} onChange={(e) => setRoom(e.target.value)} />
          <button onClick={joinRoom}>Join</button>
        </div>
        <div className="status">{connected ? 'Connected' : 'Disconnected'}</div>
      </header>

      <main className="chat">
        <aside className="sidebar">
          <h3>Room: {room}</h3>
          <div style={{marginBottom:8}}>
            <input placeholder="Email (optional)" value={email} onChange={(e)=>setEmail(e.target.value)} />
          </div>
          <strong>Users</strong>
          <ul className="users-list">
            {users.map((u) => (
              <li key={u}>
                <span>{u} {admin === u && <em>(admin)</em>}</span>
                {admin === username && u !== username && (
                  <button className="kick" onClick={()=>kickUser(u)}>Kick</button>
                )}
              </li>
            ))}
          </ul>
          <div className="typing">
            {typingUsers.length > 0 && <em>{typingUsers.join(', ')} typing…</em>}
          </div>
        </aside>

        <section className="messages">
          <div className="messages-list">
            {messages.map((m) => (
              <div key={m.id || Math.random()} className={m.system ? 'msg system' : 'msg'}>
                {m.system ? (
                  <em>{m.text}</em>
                ) : (
                  <div className="message-row">
                    <div className="avatar" title={m.username}>
                      {m.email ? (
                        <img src={gravatarUrlFromEmail(m.email)} alt={m.username} style={{width:36,height:36,borderRadius:'50%'}} />
                      ) : (
                        <div style={{background: avatarColor(m.username), width:36, height:36, borderRadius:18, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:600}}>
                          {avatarInitials(m.username)}
                        </div>
                      )}
                    </div>
                    <div className="bubble">
                      <div className="meta">
                        <span className="username">{m.username}</span>
                        <span className="time">{formatTime(m.time)}</span>
                        <span style={{marginLeft:8}}>{m.edited && <em>(edited)</em>}</span>
                        <span style={{marginLeft:8}}>
                          {(m.username === username || admin === username) && (
                            <> 
                              <button onClick={()=>startEdit(m.id, m.text)}>Edit</button>
                              <button onClick={()=>confirmDelete(m.id)} style={{marginLeft:6}}>Delete</button>
                            </>
                          )}
                        </span>
                      </div>
                      {editing && editing.id === m.id ? (
                        <div>
                          <input value={editing.text} onChange={(e)=>setEditing({...editing, text:e.target.value})} />
                          <button onClick={()=>saveEdit(m.id)}>Save</button>
                          <button onClick={cancelEdit}>Cancel</button>
                        </div>
                      ) : (
                        <div className="text">{m.text}</div>
                      )}
                      <div className="reactions">
                        {['👍','❤️','😂','🎉','😮'].map((emo)=>{
                          const count = m.reactions && m.reactions[emo] ? m.reactions[emo].length : 0
                          const own = m.reactions && m.reactions[emo] && m.reactions[emo].includes(username)
                          return (
                            <div key={emo} className={"reaction" + (own? ' own':'')} onClick={()=>sendReaction(m.id, emo)}>
                              {emo} {count>0?count:''}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="composer">
            <input value={message} onChange={handleTyping} onKeyDown={(e)=>{if(e.key==='Enter') sendMessage()}} placeholder="Type a message and hit Enter" />
            <button onClick={sendMessage}>Send</button>
          </div>
        </section>
      </main>
    </div>
  )
}

// helper: initials from username
function avatarInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0,2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

// helper: deterministic color from name
function avatarColor(name) {
  const colors = ['#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#10b981','#06b6d4','#3b82f6','#6366f1','#8b5cf6']
  if (!name) return colors[0]
  let hash = 0
  for (let i=0;i<name.length;i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  const idx = Math.abs(hash) % colors.length
  return colors[idx]
}

function formatTime(iso) {
  try { return new Date(iso).toLocaleTimeString() } catch(e) { return '' }
}

// small md5 implementation for gravatar hash (public-domain-ish compact impl)
function md5cycle(x, k) {
  /* minimal inline md5 helpers are long; to keep things compact we will use Web Crypto if available */
  return null
}

async function md5hex(str) {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    const enc = new TextEncoder();
    const data = enc.encode(str);
    const hash = await window.crypto.subtle.digest('MD5', data);
    const arr = Array.from(new Uint8Array(hash));
    return arr.map(b => b.toString(16).padStart(2,'0')).join('');
  }
  // Fallback: pure-JS MD5 implementation
  return md5(str);
}

/* Minimal MD5 implementation (compact) - public algorithm implementation */
function md5(s){
  function toWords(s){
    var n=s.length,words=[];for(var i=0;i<n;i+=4){words[i>>2]=s.charCodeAt(i)+(s.charCodeAt(i+1)||0<<8)+(s.charCodeAt(i+2)||0<<16)+(s.charCodeAt(i+3)||0<<24);}return words
  }
  function rotl(x,c){return (x<<c)|(x>>>32-c)}
  function cmn(q,a,b,x,s,t){a= (a+ q + x + t)|0; return ((a<<s)|(a>>>32-s))+b}
  function ff(a,b,c,d,x,s,t){return cmn((b & c) | ((~b) & d),a,b,x,s,t)}
  function gg(a,b,c,d,x,s,t){return cmn((b & d) | (c & (~d)),a,b,x,s,t)}
  function hh(a,b,c,d,x,s,t){return cmn(b ^ c ^ d,a,b,x,s,t)}
  function ii(a,b,c,d,x,s,t){return cmn(c ^ (b | (~d)),a,b,x,s,t)}

  var txt='';
  var x=[],k,AA,BB,CC,DD,a,b,c,d;
  for (var i=0;i<s.length;i++){var code=s.charCodeAt(i); if (code<128) txt+=String.fromCharCode(code); else if(code<2048){txt+=String.fromCharCode((code>>6)|192); txt+=String.fromCharCode((code&63)|128);} else {txt+=String.fromCharCode((code>>12)|224); txt+=String.fromCharCode(((code>>6)&63)|128); txt+=String.fromCharCode((code&63)|128);} }
  var n=txt.length;
  var words=new Array(((n+8)>>6)+1);
  for(var i=0;i<words.length*16;i++)words[i]=0;
  for(i=0;i<n;i++)words[i>>2]|=(txt.charCodeAt(i)&0xff)<<( (i%4)*8);
  words[i>>2]|=0x80<<((i%4)*8);
  words[words.length*16-2]=n*8;
  a=1732584193;b=4023233417;c=2562383102;d=271733878;
  for(i=0;i<words.length;i+=16){AA=a;BB=b;CC=c;DD=d;
    a=ff(a,b,c,d,words[i+0],7,3614090360);
    a=ff(a,b,c,d,words[i+1],12,3905402710);
    a=ff(a,b,c,d,words[i+2],17,606105819);
    a=ff(a,b,c,d,words[i+3],22,3250441966);
    a=ff(a,b,c,d,words[i+4],7,4118548399);
    a=ff(a,b,c,d,words[i+5],12,1200080426);
    a=ff(a,b,c,d,words[i+6],17,2821735955);
    a=ff(a,b,c,d,words[i+7],22,4249261313);
    a=ff(a,b,c,d,words[i+8],7,1770035416);
    a=ff(a,b,c,d,words[i+9],12,2336552879);
    a=ff(a,b,c,d,words[i+10],17,4294925233);
    a=ff(a,b,c,d,words[i+11],22,2304563134);
    a=ff(a,b,c,d,words[i+12],7,1804603682);
    a=ff(a,b,c,d,words[i+13],12,4254626195);
    a=ff(a,b,c,d,words[i+14],17,2792965006);
    a=ff(a,b,c,d,words[i+15],22,1236535329);
    a=gg(a,b,c,d,words[i+1],5,4129170786);
    a=gg(a,b,c,d,words[i+6],9,3225465664);
    a=gg(a,b,c,d,words[i+11],14,643717713);
    a=gg(a,b,c,d,words[i+0],20,3921069994);
    a=gg(a,b,c,d,words[i+5],5,3593408605);
    a=gg(a,b,c,d,words[i+10],9,38016083);
    a=gg(a,b,c,d,words[i+15],14,3634488961);
    a=gg(a,b,c,d,words[i+4],20,3889429448);
    a=gg(a,b,c,d,words[i+9],5,568446438);
    a=gg(a,b,c,d,words[i+14],9,3275163606);
    a=gg(a,b,c,d,words[i+3],14,4107603335);
    a=gg(a,b,c,d,words[i+8],20,1163531501);
    a=gg(a,b,c,d,words[i+13],5,2850285829);
    a=gg(a,b,c,d,words[i+2],9,4243563512);
    a=gg(a,b,c,d,words[i+7],14,1735328473);
    a=gg(a,b,c,d,words[i+12],20,2368359562);
    a=hh(a,b,c,d,words[i+5],4,4294588738);
    a=hh(a,b,c,d,words[i+8],11,2272392833);
    a=hh(a,b,c,d,words[i+11],16,1839030562);
    a=hh(a,b,c,d,words[i+14],23,4259657740);
    a=hh(a,b,c,d,words[i+1],4,2763975236);
    a=hh(a,b,c,d,words[i+4],11,1272893353);
    a=hh(a,b,c,d,words[i+7],16,4139469664);
    a=hh(a,b,c,d,words[i+10],23,3200236656);
    a=hh(a,b,c,d,words[i+13],4,681279174);
    a=hh(a,b,c,d,words[i+0],11,3936430074);
    a=hh(a,b,c,d,words[i+3],16,3572445317);
    a=hh(a,b,c,d,words[i+6],23,76029189);
    a=hh(a,b,c,d,words[i+9],4,3654602809);
    a=hh(a,b,c,d,words[i+12],11,3873151461);
    a=hh(a,b,c,d,words[i+15],16,530742520);
    a=hh(a,b,c,d,words[i+2],23,3299628645);
    a=ii(a,b,c,d,words[i+0],6,4096336452);
    a=ii(a,b,c,d,words[i+7],10,1126891415);
    a=ii(a,b,c,d,words[i+14],15,2878612391);
    a=ii(a,b,c,d,words[i+5],21,4237533241);
    a=ii(a,b,c,d,words[i+12],6,1700485571);
    a=ii(a,b,c,d,words[i+3],10,2399980690);
    a=ii(a,b,c,d,words[i+10],15,4293915773);
    a=ii(a,b,c,d,words[i+1],21,2240044497);
    a=ii(a,b,c,d,words[i+8],6,1873313359);
    a=ii(a,b,c,d,words[i+15],10,4264355552);
    a=ii(a,b,c,d,words[i+6],15,2734768916);
    a=ii(a,b,c,d,words[i+13],21,1309151649);
    a=ii(a,b,c,d,words[i+4],6,4149444226);
    a=ii(a,b,c,d,words[i+11],10,3174756917);
    a=ii(a,b,c,d,words[i+2],15,718787259);
    a=ii(a,b,c,d,words[i+9],21,3951481745);
    a=(a+AA)|0;b=(b+BB)|0;c=(c+CC)|0;d=(d+DD)|0;
  }
  function hex(x){
    var s=''; for(var i=0;i<4;i++){s+=('00'+((x>> (i*8))&255).toString(16)).slice(-2);} return s;
  }
  return hex(a)+hex(b)+hex(c)+hex(d);
}

function gravatarUrlFromEmail(email) {
  if (!email) return null
  const e = String(email).trim().toLowerCase();
  // return a promise-like object: but we'll use a sync placeholder and let client update after hash resolves
  return `https://www.gravatar.com/avatar/${placeholderHash(e)}?d=identicon&s=80`;
}

// placeholder hash sync (used until async md5 completes) — deterministic but not real MD5
function placeholderHash(s) { let h=0; for (let i=0;i<s.length;i++) h=(h<<5)-h+s.charCodeAt(i)|0; return (h>>>0).toString(16).padStart(8,'0') }

