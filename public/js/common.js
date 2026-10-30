// Shared helpers for every page.
const LOGO = '/assets/RINORI%20STUDIO%20logo.png';
const CONTACT = {
  email: 'rinoristudio@gmail.com',
  instagram: 'rinori.studio',
  instagramUrl: 'https://www.instagram.com/rinori.studio/',
};

async function api(path, options = {}) {
  const opts = { credentials: 'same-origin', ...options };
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers = { 'Content-Type': 'application/json', ...opts.headers };
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong');
    err.status = res.status;
    throw err;
  }
  return data;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Number(n).toLocaleString('en-IN');
const fmtDate = d => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const qs = name => new URLSearchParams(location.search).get(name);

function toast(message, isError = false) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2800);
}

// Loads the logged-in user or sends them to the login page.
async function requireUser({ admin = false } = {}) {
  try {
    const me = await api('/api/me');
    if (admin && me.user.role !== 'admin') {
      location.href = '/home';
      return new Promise(() => {});
    }
    return me;
  } catch (err) {
    if (err.status === 401) {
      location.href = '/?next=' + encodeURIComponent(location.pathname + location.search);
      return new Promise(() => {});
    }
    throw err;
  }
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/';
}

// ---------- cart (per user, in this browser) ----------

const Cart = {
  key: null,
  init(userId) { this.key = 'rs_cart_' + userId; },
  read() {
    try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch { return []; }
  },
  write(items) {
    try { localStorage.setItem(this.key, JSON.stringify(items)); } catch { /* storage unavailable */ }
    updateCartBadge();
  },
  add(productId, qty = 1) {
    const items = this.read();
    const line = items.find(i => i.productId === productId);
    if (line) line.qty = Math.min(20, line.qty + qty);
    else items.push({ productId, qty });
    this.write(items);
  },
  set(productId, qty) {
    this.write(this.read().map(i => (i.productId === productId ? { ...i, qty } : i)).filter(i => i.qty > 0));
  },
  remove(productId) { this.write(this.read().filter(i => i.productId !== productId)); },
  clear() { this.write([]); },
  count() { return this.read().reduce((s, i) => s + i.qty, 0); },
};

function updateCartBadge() {
  const b = document.querySelector('[data-cart-badge]');
  if (!b) return;
  const n = Cart.count();
  b.textContent = n;
  b.classList.toggle('hidden', n === 0);
}

// ---------- header / footer ----------

const ICONS = {
  shop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9h18"/><path d="M9 20v-6h6v6"/></svg>',
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M8 14h3M8 17h6"/></svg>',
  insta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 7l9 6 9-6"/></svg>',
  out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/></svg>',
};

function renderHeader(me, active = '') {
  Cart.init(me.user.id);
  const isAdmin = me.user.role === 'admin';
  const link = (href, icon, label, key, extra = '') =>
    `<a href="${href}" class="${active === key ? 'active' : ''}" aria-label="${label}">${ICONS[icon]}<span class="label">${label}</span>${extra}</a>`;
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <div class="container">
      <a class="brand" href="/home"><img src="${LOGO}" alt=""><span>RINORI STUDIO</span></a>
      <nav class="nav">
        ${link('/home', 'shop', 'Shop', 'home')}
        ${isAdmin ? link('/admin', 'admin', 'Admin', 'admin') : ''}
        ${link('/account#notifications', 'bell', 'Updates', 'notif', `<span class="badge ${me.unread ? '' : 'hidden'}">${me.unread}</span>`)}
        ${link('/account', 'user', 'Account', 'account')}
        ${link('/cart', 'bag', 'Cart', 'cart', '<span class="badge hidden" data-cart-badge>0</span>')}
        <button class="linkish" type="button" data-logout aria-label="Log out">${ICONS.out}<span class="label">Log out</span></button>
      </nav>
    </div>`;
  document.body.prepend(header);
  document.body.prepend(announceBar());
  header.querySelector('[data-logout]').addEventListener('click', logout);
  updateCartBadge();
}

function announceBar() {
  const bar = document.createElement('div');
  bar.className = 'announce';
  bar.setAttribute('aria-hidden', 'true');
  const msgs = [
    '✿ Shipped by India Post Speed Post',
    '✿ Handmade with love',
    '✿ 手作り',
    `✿ Follow us @${CONTACT.instagram}`,
    '✿ Secure payments by Razorpay',
  ];
  const run = msgs.map(m => `<span>${esc(m)}</span>`).join('');
  bar.innerHTML = `<div class="track">${run.repeat(4)}</div>`;
  return bar;
}

function renderFooter() {
  const f = document.createElement('footer');
  f.className = 'site-footer';
  f.innerHTML = `
    <div class="wave-top"></div>
    <div class="footer-inner">
      <span class="sparkle" style="left:8%;top:30%">✦</span>
      <span class="sparkle" style="right:10%;top:20%">✦</span>
      <span class="script">thank you for shopping small</span>
      <span class="jp">手作り · 心をこめて</span>
      <div class="footer-links">
        <a href="${CONTACT.instagramUrl}" target="_blank" rel="noopener">${ICONS.insta} @${CONTACT.instagram}</a>
        <a href="mailto:${CONTACT.email}">${ICONS.mail} ${CONTACT.email}</a>
      </div>
      <small>© ${new Date().getFullYear()} Rinori Studio · Made by hand, with heart · Shipped by India Post Speed Post</small>
    </div>`;
  document.body.appendChild(f);
}

function petals(count = 14) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const wrap = document.createElement('div');
  wrap.className = 'petals';
  wrap.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.className = 'petal';
    p.style.left = Math.random() * 100 + 'vw';
    p.style.animationDuration = 9 + Math.random() * 10 + 's';
    p.style.animationDelay = -Math.random() * 18 + 's';
    p.style.transform = `scale(${0.6 + Math.random() * 0.7})`;
    wrap.appendChild(p);
  }
  document.body.appendChild(wrap);
}

function formatAddress(a) {
  return [a.house, a.street, a.landmark && 'Near ' + a.landmark, a.city, a.district, `${a.state} - ${a.pincode}`]
    .filter(Boolean).map(esc).join(', ');
}

function setBusy(btn, busy, text) {
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.textContent = text || 'Please wait…';
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.label || btn.textContent;
    btn.disabled = false;
  }
}
