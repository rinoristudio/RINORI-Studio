// The order bill (receipt) as an email: HTML with inline styles, plus a plain-text copy.
// SHOP_URL is the address customers use (the always-on loading page), for the "view online" link.
const SHOP_URL = () => (process.env.SHOP_URL || 'https://rinori-studio-shop.onrender.com').replace(/\/+$/, '');
const CONTACT = { email: 'rinoristudio@gmail.com', instagram: 'rinori.studio' };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Number(n).toLocaleString('en-IN');
const when = d => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const landmark = l => (l ? (/^near\b/i.test(l) ? l : 'Near ' + l) : '');
const addressLines = a => [a.fullName, a.house, a.street, landmark(a.landmark),
  [a.city, a.district].filter(Boolean).join(', '), `${a.state} - ${a.pincode}`, 'Phone: ' + a.phone].filter(Boolean);

function billLink(order) {
  return `${SHOP_URL()}/bill?id=${encodeURIComponent(order.id)}`;
}

function billEmail(order) {
  const pink = '#d24f7d', berry = '#6e3350', line = '#ffd0de';
  const td = 'padding:10px 8px;border-bottom:1px solid ' + line + ';font-size:14px;color:' + berry + ';';
  const rows = order.items.map(i => `
    <tr>
      <td style="${td}">${esc(i.name)}${i.color ? `<br><span style="font-size:12px;color:#8a5a70">Colour: ${esc(i.color)}</span>` : ''}</td>
      <td style="${td}text-align:center">${i.qty}</td>
      <td style="${td}text-align:right">${inr(i.price)}</td>
      <td style="${td}text-align:right">${inr(i.price * i.qty)}</td>
    </tr>`).join('');
  const sumRow = (label, value, bold) => `
    <tr><td style="padding:6px 8px;font-size:14px;color:${berry};${bold ? 'font-weight:700;font-size:16px;' : ''}" colspan="3" align="right">${label}</td>
    <td style="padding:6px 8px;font-size:14px;color:${berry};text-align:right;${bold ? 'font-weight:700;font-size:16px;' : ''}">${value}</td></tr>`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#ffe6ee;font-family:Arial,Helvetica,sans-serif;color:${berry}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffe6ee;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden">
  <tr><td style="background:#f2709a;padding:22px 24px;color:#ffffff">
    <div style="font-size:22px;font-weight:700;letter-spacing:2px">RINORI STUDIO</div>
    <div style="font-size:14px;margin-top:4px">Thank you for your order! Here is your bill.</div>
  </td></tr>
  <tr><td style="padding:22px 24px 6px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:14px;line-height:1.6;vertical-align:top">
        <b style="font-size:16px">Bill for order ${esc(order.number)}</b><br>
        Date: ${esc(when(order.createdAt))}<br>
        Payment: Paid online via Razorpay${order.paymentRef ? `<br>Payment ID: ${esc(order.paymentRef)}` : ''}
      </td>
      <td style="font-size:14px;line-height:1.6;vertical-align:top;text-align:right">
        <b>Billed to</b><br>${esc(order.customer.name)}<br>${esc(order.customer.email)}${order.customer.phone ? `<br>${esc(order.customer.phone)}` : ''}
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:12px 24px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr>
        <th style="text-align:left;padding:8px;font-size:12px;color:${pink};border-bottom:2px solid ${line}">ITEM</th>
        <th style="text-align:center;padding:8px;font-size:12px;color:${pink};border-bottom:2px solid ${line}">QTY</th>
        <th style="text-align:right;padding:8px;font-size:12px;color:${pink};border-bottom:2px solid ${line}">PRICE</th>
        <th style="text-align:right;padding:8px;font-size:12px;color:${pink};border-bottom:2px solid ${line}">AMOUNT</th>
      </tr>
      ${rows}
      ${sumRow('Subtotal', inr(order.subtotal))}
      ${sumRow('Speed Post shipping', order.shipping ? inr(order.shipping) : 'Free')}
      ${sumRow('Total paid', inr(order.total), true)}
    </table>
  </td></tr>
  <tr><td style="padding:6px 24px 4px;font-size:14px;line-height:1.6">
    <b>Shipping to</b><br>${addressLines(order.address).map(esc).join('<br>')}
  </td></tr>
  <tr><td style="padding:18px 24px" align="center">
    <a href="${esc(billLink(order))}" style="display:inline-block;background:#f2709a;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;font-size:14px">View or download your bill</a>
    <div style="font-size:13px;margin-top:12px;line-height:1.5">We'll pack your order with love and send the India Post Speed Post tracking number once it ships.</div>
  </td></tr>
  <tr><td style="background:#fff6f9;padding:16px 24px;font-size:12px;line-height:1.6;color:#8a5a70;text-align:center">
    Questions? Reply to this email, write to ${esc(CONTACT.email)} or message us on Instagram @${esc(CONTACT.instagram)}.<br>
    Rinori Studio · Handmade with love
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    `RINORI STUDIO - Bill for order ${order.number}`,
    `Date: ${when(order.createdAt)}`,
    `Payment: Paid online via Razorpay${order.paymentRef ? ` (Payment ID ${order.paymentRef})` : ''}`,
    `Billed to: ${order.customer.name}, ${order.customer.email}`,
    '',
    ...order.items.map(i => `${i.name}${i.color ? ` (${i.color})` : ''} x ${i.qty} @ ${inr(i.price)} = ${inr(i.price * i.qty)}`),
    '',
    `Subtotal: ${inr(order.subtotal)}`,
    `Speed Post shipping: ${order.shipping ? inr(order.shipping) : 'Free'}`,
    `Total paid: ${inr(order.total)}`,
    '',
    'Shipping to:', ...addressLines(order.address),
    '',
    `View or download your bill: ${billLink(order)}`,
    `Questions? Write to ${CONTACT.email} or Instagram @${CONTACT.instagram}.`,
  ].join('\n');

  return { subject: `Your Rinori Studio bill · Order ${order.number}`, html, text };
}

module.exports = { billEmail, billLink };
