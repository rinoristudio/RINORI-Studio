// Sends email through Brevo's HTTPS API. (Render's free plan blocks SMTP ports,
// so plain SMTP would not work there.) Settings come from the environment:
//   BREVO_API_KEY  - Brevo > SMTP & API > API keys
//   MAIL_FROM      - a sender address verified in Brevo, e.g. rinoristudio@gmail.com
//   MAIL_FROM_NAME - optional, defaults to "Rinori Studio"
// BREVO_API_URL only exists so tests can point at a local fake; leave it unset.
const API = process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email';

const isConfigured = () => Boolean(process.env.BREVO_API_KEY && process.env.MAIL_FROM);

async function sendEmail({ to, toName, subject, html, text }) {
  if (!isConfigured()) {
    console.warn(`Email not sent (BREVO_API_KEY / MAIL_FROM not set): "${subject}"`);
    return { sent: false, reason: 'not configured' };
  }
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: process.env.MAIL_FROM, name: process.env.MAIL_FROM_NAME || 'Rinori Studio' },
      replyTo: { email: process.env.MAIL_FROM, name: process.env.MAIL_FROM_NAME || 'Rinori Studio' },
      to: [{ email: to, ...(toName ? { name: toName.slice(0, 70) } : {}) }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Email failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return { sent: true, id: data.messageId };
}

module.exports = { isConfigured, sendEmail };
