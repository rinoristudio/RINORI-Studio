(async () => {
  const me = await requireUser({ admin: true });
  renderHeader(me, 'admin');
  renderFooter();

  const panel = document.querySelector('[data-panel]');
  const MAX_PHOTOS = 10;
  let state = { orders: [], statuses: [], products: [], users: [], orderFilter: 'All', search: '', editing: null, messageTo: 'all', newFiles: [] };

  const statusOptions = current => state.statuses.map(s => `<option ${s === current ? 'selected' : ''}>${esc(s)}</option>`).join('');

  const views = {
    async dashboard() {
      const s = await api('/api/admin/stats');
      return `
        <h2 class="section-title">Today at the studio</h2>
        <div class="stats">
          <div class="stat"><div class="muted small">Total orders</div><div class="n">${s.orders}</div></div>
          <div class="stat"><div class="muted small">Ready to post</div><div class="n">${s.to_ship}</div></div>
          <div class="stat"><div class="muted small">Revenue</div><div class="n">${inr(s.revenue)}</div></div>
          <div class="stat"><div class="muted small">Customers</div><div class="n">${s.customers}</div></div>
          <div class="stat"><div class="muted small">Products</div><div class="n">${s.products}</div></div>
        </div>
        <h3>Low stock</h3>
        ${s.lowStock.length
          ? s.lowStock.map(p => `<div class="notice">⚠️ <b>${esc(p.name)}</b>: ${p.stock} left · <a href="#products" data-edit-link="${p.id}">Restock</a></div>`).join('')
          : '<p class="muted">Everything is well stocked ✿</p>'}
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px">
          <a class="btn" href="#orders">View orders</a>
          <a class="btn ghost" href="#products" data-new-product>+ Add product</a>
        </div>
        ${me.payment.ready ? '' : '<div class="notice" style="margin-top:20px">⚠️ Customers cannot pay yet. Connect Razorpay: see <a href="#settings">Payments</a>.</div>'}`;
    },

    async orders() {
      ({ orders: state.orders, statuses: state.statuses } = await api('/api/admin/orders'));
      return renderOrders();
    },

    async products() {
      ({ products: state.products } = await api('/api/admin/products'));
      return renderProducts();
    },

    async customers() {
      ({ users: state.users } = await api('/api/admin/users'));
      if (!state.users.length) return '<h2 class="section-title">Customers</h2><p class="empty">No customers yet.</p>';
      return `
        <h2 class="section-title">Customers (${state.users.length})</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Customer</th><th>Contact</th><th>Default address</th><th>Orders</th><th></th></tr></thead>
          <tbody>${state.users.map(u => {
            const a = u.addresses.find(x => x.isDefault) || u.addresses[0];
            return `<tr>
              <td><b>${esc(u.name)}</b><div class="small muted">Joined ${new Date(u.createdAt).toLocaleDateString('en-IN')}</div></td>
              <td class="small">${esc(u.email)}<br>${esc(u.phone)}</td>
              <td class="small">${a ? formatAddress(a) : '<span class="muted">Not added yet</span>'}</td>
              <td class="small">${u.orderCount}<br><span class="muted">${inr(u.totalSpent)}</span></td>
              <td><button class="btn small soft" data-message-user="${u.id}">Message</button></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`;
    },

    async settings() {
      const p = await api('/api/admin/payments');
      const row = (ok, label, detail) => `<div class="notice" style="background:${ok ? '#e3f3e7' : 'var(--pink-50)'};border-color:${ok ? 'var(--ok)' : 'var(--pink-400)'}">${ok ? '✅' : '⚠️'} <b>${label}</b><div class="small">${detail}</div></div>`;
      return `
        <h2 class="section-title">Payments (Razorpay)</h2>
        <p class="muted">Customers pay in the Razorpay window at checkout. An order only appears here after Razorpay confirms the payment. Your keys are kept in Render's Environment settings, never in the code.</p>
        ${row(p.ready, p.ready ? `Razorpay connected (${p.mode === 'live' ? 'LIVE: real payments' : 'TEST mode: no real money'})` : 'Razorpay not connected',
          p.ready ? 'Customers can pay and place orders.' : 'Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Render → Environment. Until then nobody can place an order.')}
        ${row(p.webhook, p.webhook ? 'Webhook connected' : 'Webhook not set (recommended)',
          p.webhook ? 'Payments are confirmed even if a customer closes the page right after paying.'
            : `In Razorpay → Webhooks add <b>${esc(p.webhookUrl)}</b> with events <b>payment.captured</b> and <b>order.paid</b>, choose a secret, and save the same secret in Render as RAZORPAY_WEBHOOK_SECRET.`)}
        <p class="small muted">Refunds: open the payment in your Razorpay dashboard and click Refund, then set the order here to Cancelled (stock is returned automatically).</p>`;
    },

    async message() {
      if (!state.users.length) ({ users: state.users } = await api('/api/admin/users'));
      if (!state.products.length) ({ products: state.products } = await api('/api/admin/products'));
      return `
        <h2 class="section-title">Send an update</h2>
        <p class="muted">Customers see this under <b>Updates</b> (the bell icon) when they log in.</p>
        <div class="chips" style="margin-bottom:16px">
          <button type="button" class="btn small soft" data-template="new">✨ New product</button>
          <button type="button" class="btn small soft" data-template="back">🌸 Back in stock</button>
          <button type="button" class="btn small soft" data-template="sale">🎀 Offer</button>
        </div>
        <form data-message-form style="max-width:560px">
          <div class="field">
            <label for="m-to">Send to</label>
            <select id="m-to" name="userId">
              <option value="all">All customers (${state.users.length})</option>
              ${state.users.map(u => `<option value="${u.id}" ${state.messageTo === u.id ? 'selected' : ''}>${esc(u.name)} · ${esc(u.email)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="m-product">About product <span class="opt">(optional, adds a "View product" link)</span></label>
            <select id="m-product" name="productId">
              <option value="">None</option>
              ${state.products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label for="m-title">Title</label><input id="m-title" name="title" maxlength="120" required></div>
          <div class="field"><label for="m-msg">Message</label><textarea id="m-msg" name="message" maxlength="1000" required></textarea></div>
          <button class="btn" type="submit">Send update 💌</button>
        </form>`;
    },
  };

  // ---------- orders ----------

  function renderOrders() {
    const q = state.search.toLowerCase();
    const list = state.orders.filter(o =>
      (state.orderFilter === 'All' || o.status === state.orderFilter) &&
      (!q || [o.number, o.customer.name, o.customer.phone, o.customer.email, o.address.pincode].join(' ').toLowerCase().includes(q)));
    return `
      <h2 class="section-title">Orders</h2>
      <div class="toolbar">
        <select data-order-filter aria-label="Filter by status">
          <option>All</option>${statusOptions(state.orderFilter)}
        </select>
        <input data-order-search type="search" placeholder="Search order no, name, phone…" value="${esc(state.search)}" style="flex:1;min-width:200px">
      </div>
      ${list.length ? list.map(orderCard).join('') : '<p class="empty">No orders here yet.</p>'}`;
  }

  function orderCard(o) {
    const a = o.address;
    return `
      <details class="order">
        <summary class="order-head">
          <div><b>${esc(o.number)}</b> · ${esc(o.customer.name)}<div class="small muted">${fmtDate(o.createdAt)} · ${o.items.reduce((s, i) => s + i.qty, 0)} item(s) · ${inr(o.total)}</div></div>
          <span class="status ${esc(o.status)}">${esc(o.status)}</span>
        </summary>
        <div class="detail-grid">
          <div class="box">
            <h4>Customer</h4>
            <b>${esc(o.customer.name)}</b><br>✉️ ${esc(o.customer.email)}<br>📞 ${esc(o.customer.phone)}
            <h4 style="margin-top:12px">Payment</h4>
            ${esc(o.paymentMethod)} · <b>${inr(o.total)}</b>${o.paymentRef ? `<br>Payment ref: <b>${esc(o.paymentRef)}</b>` : ''}
            ${o.status === 'Paid' ? '<br><span class="small" style="color:var(--ok)">✅ Paid via Razorpay · ready to pack</span>' : ''}
            ${o.trackingNumber ? `<h4 style="margin-top:12px">Speed Post</h4><b>${esc(o.trackingNumber)}</b>` : ''}
          </div>
          <div class="box">
            <h4>Ship to (${esc(a.type)})</h4>
            <b>${esc(a.fullName)}</b><br>${esc(a.house)}<br>${esc(a.street)}${a.landmark ? `<br>Landmark: ${esc(a.landmark)}` : ''}<br>
            ${esc(a.city)}${a.district ? ', ' + esc(a.district) : ''}<br>${esc(a.state)} - <b>${esc(a.pincode)}</b><br>
            📞 ${esc(a.phone)}${a.altPhone ? ' / ' + esc(a.altPhone) : ''}
          </div>
        </div>
        <div class="order-items">
          ${o.items.map(i => `<div class="it"><img src="${esc(i.image)}" alt=""><div>${esc(i.name)} <span class="muted">× ${i.qty} @ ${inr(i.price)}</span></div><b style="margin-left:auto">${inr(i.price * i.qty)}</b></div>`).join('')}
        </div>
        <div class="small">Subtotal ${inr(o.subtotal)} · Speed Post ${o.shipping ? inr(o.shipping) : 'free'} · <b>Total ${inr(o.total)}</b></div>
        ${o.note ? `<div class="notice small" style="margin-top:10px">📝 Customer note: ${esc(o.note)}</div>` : ''}
        <ul class="timeline">
          ${o.history.slice().reverse().map(h => `<li><b>${esc(h.status)}</b> <span class="muted small">· ${fmtDate(h.at)}</span>${h.message ? `<div class="msg">${esc(h.message)}</div>` : ''}</li>`).join('')}
        </ul>
        <form data-order-update="${o.id}" style="margin-top:14px;border-top:2px dashed var(--pink-100);padding-top:14px">
          <div class="grid-3">
            <div class="field"><label>Status</label><select name="status">${statusOptions(o.status)}</select></div>
            <div class="field"><label>Speed Post tracking no.</label><input name="trackingNumber" maxlength="40" placeholder="e.g. EE123456789IN" value="${esc(o.trackingNumber)}"></div>
            <div class="field"><label>Message <span class="opt">(optional)</span></label><input name="message" maxlength="500" placeholder="e.g. Posted today!"></div>
          </div>
          <button class="btn small" type="submit">Update &amp; notify customer</button>
        </form>
      </details>`;
  }

  // ---------- products ----------

  function renderProducts() {
    if (state.editing) return productForm(state.editing === 'new' ? null : state.products.find(p => p.id === state.editing));
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px">
        <h2 class="section-title" style="margin:0">Products (${state.products.length})</h2>
        <button class="btn small" data-new-product>+ Add product</button>
      </div>
      ${state.products.length ? state.products.map(p => `
        <div class="admin-product">
          <img src="${esc(p.images[0])}" alt="">
          <div>
            <b>${esc(p.name)}</b> ${p.active ? '' : '<span class="pill">Hidden</span>'}
            <div class="small muted">${esc(p.category)} · ${inr(p.price)} · ${p.shipping ? `Shipping ${inr(p.shipping)}` : 'Free shipping'} · Stock ${p.stock} · ${p.images.length} photo${p.images.length === 1 ? '' : 's'}</div>
          </div>
          <div class="actions">
            <button class="btn small soft" data-edit="${p.id}">Edit</button>
            <button class="btn small danger" data-delete="${p.id}">Delete</button>
          </div>
        </div>`).join('') : '<p class="empty">No products yet. Add your first one!</p>'}`;
  }

  function productForm(p) {
    return `
      <h2 class="section-title">${p ? 'Edit product' : 'Add a new product'}</h2>
      <form data-product-form="${p ? p.id : ''}">
        <div class="error-box hidden" data-error></div>
        <div class="field"><label for="pf-name">Product name</label><input id="pf-name" name="name" maxlength="120" value="${esc(p?.name)}" required></div>
        <div class="grid-2">
          <div class="field"><label for="pf-price">Price (₹)</label><input id="pf-price" name="price" type="number" min="1" step="1" value="${p?.price ?? ''}" required></div>
          <div class="field"><label for="pf-mrp">MRP (₹) <span class="opt">(optional, shown struck-through)</span></label><input id="pf-mrp" name="mrp" type="number" min="1" step="1" value="${p?.mrp ?? ''}"></div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="pf-ship">Speed Post shipping (₹) <span class="opt">0 = free shipping</span></label>
            <input id="pf-ship" name="shipping" type="number" min="0" step="1" value="${p?.shipping ?? 0}" required>
          </div>
          <div class="field"><label for="pf-stock">Stock</label><input id="pf-stock" name="stock" type="number" min="0" step="1" value="${p?.stock ?? 10}" required></div>
        </div>
        <div class="field"><label for="pf-cat">Category</label><input id="pf-cat" name="category" maxlength="60" list="cats" value="${esc(p?.category || '')}" placeholder="e.g. Scrunchies, Bows, Gifts">
          <datalist id="cats">${[...new Set(state.products.map(x => x.category))].map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
        <div class="field"><label for="pf-desc">Description</label><textarea id="pf-desc" name="description" maxlength="3000" style="min-height:120px">${esc(p?.description)}</textarea></div>
        <div class="field">
          <label>Photos <span class="opt">(first photo is the cover · up to ${MAX_PHOTOS} photos, max 5 MB each · you can pick more in several goes)</span></label>
          <div class="img-edit" data-existing>
            ${(p?.images || []).map(src => `<div class="im" data-keep="${esc(src)}"><img src="${esc(src)}" alt=""><button type="button" data-remove-img aria-label="Remove photo">×</button></div>`).join('')}
          </div>
          <input type="file" data-photo-picker accept="image/jpeg,image/png,image/webp,image/gif" multiple>
          <div class="small muted" data-photo-count></div>
          <div class="img-edit" data-previews style="margin-top:10px"></div>
        </div>
        <label class="check" style="margin-bottom:10px"><input type="checkbox" name="active" ${p?.active === false ? '' : 'checked'}> Show this product in the shop</label>
        <label class="check" style="margin-bottom:22px"><input type="checkbox" name="notify"> ${p ? 'Notify all customers about this update (e.g. back in stock)' : 'Notify all customers about this new product'}</label>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn" type="submit">${p ? 'Save changes' : 'Add product'}</button>
          <button class="btn ghost" type="button" data-cancel-edit>Cancel</button>
        </div>
      </form>`;
  }

  function renderPreviews() {
    const previews = panel.querySelector('[data-previews]');
    if (!previews) return;
    previews.innerHTML = state.newFiles.map((f, i) =>
      `<div class="im"><img src="${URL.createObjectURL(f)}" alt=""><button type="button" data-remove-new="${i}" aria-label="Remove photo">×</button></div>`).join('');
    const total = panel.querySelectorAll('[data-keep]').length + state.newFiles.length;
    panel.querySelector('[data-photo-count]').textContent = `${total} of ${MAX_PHOTOS} photos`;
  }

  // ---------- routing ----------

  async function show() {
    const name = views[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard';
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    panel.innerHTML = '<p class="empty">Loading…</p>';
    try {
      panel.innerHTML = await views[name]();
      if (panel.querySelector('[data-photo-picker]')) renderPreviews();
    } catch (err) {
      panel.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    }
  }

  function go(tab) {
    if (location.hash === '#' + tab) show();
    else location.hash = tab;
  }

  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    state.editing = null;
    go(b.dataset.tab);
  }));
  window.addEventListener('hashchange', show);

  // ---------- events ----------

  panel.addEventListener('click', async e => {
    const t = e.target.closest('button, a');
    if (!t) return;
    try {
      if (t.hasAttribute('data-new-product')) {
        e.preventDefault();
        state.editing = 'new';
        state.newFiles = [];
        go('products');
      } else if (t.dataset.editLink || t.dataset.edit) {
        e.preventDefault();
        state.editing = t.dataset.editLink || t.dataset.edit;
        state.newFiles = [];
        go('products');
      } else if (t.hasAttribute('data-cancel-edit')) {
        state.editing = null;
        panel.innerHTML = renderProducts();
      } else if (t.dataset.delete) {
        const p = state.products.find(x => x.id === t.dataset.delete);
        if (!confirm(`Delete "${p.name}"? Past orders keep their details. To just hide it, edit and untick "Show in shop".`)) return;
        await api('/api/admin/products/' + p.id, { method: 'DELETE' });
        toast('Product deleted');
        show();
      } else if (t.hasAttribute('data-remove-img')) {
        t.closest('.im').remove();
        renderPreviews();
      } else if (t.dataset.removeNew !== undefined) {
        state.newFiles.splice(Number(t.dataset.removeNew), 1);
        renderPreviews();
      } else if (t.dataset.messageUser) {
        state.messageTo = t.dataset.messageUser;
        go('message');
      } else if (t.dataset.template) {
        const f = panel.querySelector('[data-message-form]');
        const product = state.products.find(p => p.id === f.productId.value) || state.products[0];
        const name = product ? product.name : 'our new piece';
        if (product && !f.productId.value) f.productId.value = product.id;
        const tpl = {
          new: ['New in the studio ✨', `Say hello to "${name}"! Freshly handmade and ready to ship.`],
          back: ['Back in stock 🌸', `"${name}" is back in stock. Grab yours before it's gone!`],
          sale: ['A little treat for you 🎀', `Enjoy a special price on "${name}" this week only.`],
        }[t.dataset.template];
        [f.title.value, f.message.value] = tpl;
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  panel.addEventListener('change', e => {
    if (e.target.matches('[data-order-filter]')) {
      state.orderFilter = e.target.value;
      panel.innerHTML = renderOrders();
    } else if (e.target.matches('[data-photo-picker]')) {
      const room = Math.max(0, MAX_PHOTOS - panel.querySelectorAll('[data-keep]').length - state.newFiles.length);
      const picked = [...e.target.files];
      if (picked.length > room) toast(`Only ${room} more photo(s) can be added (max ${MAX_PHOTOS})`, true);
      state.newFiles.push(...picked.slice(0, room));
      e.target.value = '';
      renderPreviews();
    }
  });

  panel.addEventListener('input', e => {
    if (!e.target.matches('[data-order-search]')) return;
    state.search = e.target.value;
    const pos = e.target.selectionStart;
    panel.innerHTML = renderOrders();
    const input = panel.querySelector('[data-order-search]');
    input.focus();
    input.setSelectionRange(pos, pos);
  });

  panel.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type=submit]');
    setBusy(btn, true);
    try {
      if (f.dataset.orderUpdate) {
        const { order } = await api('/api/admin/orders/' + f.dataset.orderUpdate, {
          method: 'PUT', body: { status: f.status.value, message: f.message.value, trackingNumber: f.trackingNumber.value },
        });
        state.orders = state.orders.map(o => (o.id === order.id ? order : o));
        panel.innerHTML = renderOrders();
        toast('Updated. The customer has been notified.');
      } else if (f.matches('[data-product-form]')) {
        const id = f.dataset.productForm;
        const fd = new FormData(f);
        fd.set('active', f.active.checked);
        fd.set('notify', f.notify.checked);
        fd.set('keepImages', JSON.stringify([...f.querySelectorAll('[data-keep]')].map(el => el.dataset.keep)));
        state.newFiles.forEach(file => fd.append('images', file));
        await api('/api/admin/products' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: fd });
        toast(id ? 'Product saved' : 'Product added');
        state.editing = null;
        state.newFiles = [];
        show();
        return;
      } else if (f.matches('[data-message-form]')) {
        const { sent } = await api('/api/admin/notify', { method: 'POST', body: Object.fromEntries(new FormData(f)) });
        toast(`Sent to ${sent} customer${sent === 1 ? '' : 's'}`);
        f.title.value = '';
        f.message.value = '';
      }
    } catch (err) {
      const box = f.querySelector('[data-error]');
      if (box) {
        box.textContent = err.message;
        box.classList.remove('hidden');
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        toast(err.message, true);
      }
    }
    if (btn.isConnected) setBusy(btn, false);
  });

  show();
})();
