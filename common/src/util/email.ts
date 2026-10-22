// Transactional email bodies (welcome + order bill). Kept framework-free so both apps
// and the Worker share one source of truth. Content is English — the recipient's locale
// isn't reliably known at send time. Each builder returns subject + plain `text` + `html`;
// the caller adds the `to` field to form an EmailPayload.
import type { Order, OrderItem } from '../types';

export interface EmailBody {
  subject: string;
  text: string;
  html: string;
}

function money(n: number | undefined | null): string {
  return `₹${Math.round(((n ?? 0) + Number.EPSILON) * 100) / 100}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Welcome mail sent once, on a new customer's first sign-in. */
export function buildWelcomeEmail(opts: { name?: string | null; shopName: string }): EmailBody {
  const who = (opts.name ?? '').trim().split(/\s+/)[0] || 'there';
  const shop = opts.shopName || 'our shop';
  const subject = `Welcome to ${shop}`;
  const lines = [
    `Hi ${who},`,
    '',
    `Thanks for joining ${shop}. We're delighted to have you!`,
    'Browse fresh fruits and flowers, add them to your cart, and place your order right from the app.',
    '',
    'See you soon,',
    shop,
  ];
  const text = lines.join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1b1b1b;line-height:1.5">
    <p>Hi ${esc(who)},</p>
    <p>Thanks for joining <b>${esc(shop)}</b>. We're delighted to have you!</p>
    <p>Browse fresh fruits and flowers, add them to your cart, and place your order right from the app.</p>
    <p style="margin-top:20px">See you soon,<br/><b>${esc(shop)}</b></p>
  </div>`;
  return { subject, text, html };
}

/** Itemized bill sent to the customer when the shop accepts their order. */
export function buildOrderBillEmail(opts: { order: Order; shopName: string }): EmailBody {
  const { order } = opts;
  const shop = opts.shopName || 'our shop';
  const items: OrderItem[] = order.items ?? [];
  const subtotal = order.subtotal ?? order.total ?? 0;
  const discount = order.discount ?? 0;
  const delivery = order.deliveryFee ?? 0;
  const grand = order.grandTotal ?? Math.max(0, subtotal - discount) + delivery;
  const shortId = order.id.slice(0, 8).toUpperCase();

  const itemLines = items.map(
    (it) => `  ${it.qty} × ${it.name}  —  ${money(it.price * it.qty)}`,
  );
  const totals: string[] = [`Subtotal: ${money(subtotal)}`];
  if (discount > 0) totals.push(`Discount${order.couponCode ? ` (${order.couponCode})` : ''}: -${money(discount)}`);
  totals.push(`Delivery: ${delivery > 0 ? money(delivery) : 'Free'}`);
  totals.push(`Total: ${money(grand)}`);

  const payMode = order.paymentMode === 'upi' ? 'UPI' : 'Cash on delivery';
  const textLines = [
    `Hi ${(order.customerName ?? '').trim() || 'there'},`,
    '',
    `Good news — your order #${shortId} has been accepted and is being prepared.`,
    '',
    'Items:',
    ...itemLines,
    '',
    ...totals,
    '',
    `Payment: ${payMode}`,
    '',
    `Thank you for shopping with ${shop}!`,
    shop,
  ];
  const text = textLines.join('\n');

  const itemRows = items
    .map(
      (it) =>
        `<tr><td style="padding:4px 0">${esc(it.name)}</td><td style="padding:4px 0;text-align:center">${it.qty}</td><td style="padding:4px 0;text-align:right">${money(it.price * it.qty)}</td></tr>`,
    )
    .join('');
  const totalRows = [
    `<tr><td colspan="2" style="padding:2px 0;text-align:right">Subtotal</td><td style="padding:2px 0;text-align:right">${money(subtotal)}</td></tr>`,
    discount > 0
      ? `<tr><td colspan="2" style="padding:2px 0;text-align:right">Discount${order.couponCode ? ` (${esc(order.couponCode)})` : ''}</td><td style="padding:2px 0;text-align:right">-${money(discount)}</td></tr>`
      : '',
    `<tr><td colspan="2" style="padding:2px 0;text-align:right">Delivery</td><td style="padding:2px 0;text-align:right">${delivery > 0 ? money(delivery) : 'Free'}</td></tr>`,
    `<tr><td colspan="2" style="padding:6px 0 0;text-align:right"><b>Total</b></td><td style="padding:6px 0 0;text-align:right"><b>${money(grand)}</b></td></tr>`,
  ].join('');

  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1b1b1b;line-height:1.5">
    <p>Hi ${esc((order.customerName ?? '').trim() || 'there')},</p>
    <p>Good news — your order <b>#${esc(shortId)}</b> has been accepted and is being prepared.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr style="border-bottom:1px solid #ddd"><th style="text-align:left;padding:4px 0">Item</th><th style="text-align:center;padding:4px 0">Qty</th><th style="text-align:right;padding:4px 0">Amount</th></tr></thead>
      <tbody>${itemRows}</tbody>
      <tfoot style="border-top:1px solid #ddd">${totalRows}</tfoot>
    </table>
    <p style="margin-top:12px">Payment: <b>${esc(payMode)}</b></p>
    <p style="margin-top:20px">Thank you for shopping with <b>${esc(shop)}</b>!</p>
  </div>`;
  return { subject: `Your ${shop} order #${shortId} is confirmed`, text, html };
}

/** Short thank-you sent to the customer once their order is served/delivered. */
export function buildOrderServedEmail(opts: { order: Order; shopName: string }): EmailBody {
  const { order } = opts;
  const shop = opts.shopName || 'our shop';
  const shortId = order.id.slice(0, 8).toUpperCase();
  const who = (order.customerName ?? '').trim() || 'there';
  const text = [
    `Hi ${who},`,
    '',
    `Your order #${shortId} has been delivered. Thank you for shopping with ${shop} — we hope you enjoy your fresh fruits and flowers!`,
    '',
    'We look forward to serving you again.',
    shop,
  ].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1b1b1b;line-height:1.5">
    <p>Hi ${esc(who)},</p>
    <p>Your order <b>#${esc(shortId)}</b> has been delivered. Thank you for shopping with <b>${esc(shop)}</b> — we hope you enjoy your fresh fruits and flowers!</p>
    <p style="margin-top:20px">We look forward to serving you again.<br/><b>${esc(shop)}</b></p>
  </div>`;
  return { subject: `Thanks for your order from ${shop}`, text, html };
}
