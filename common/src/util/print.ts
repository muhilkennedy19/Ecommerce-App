// Printable HTML documents shared by both apps: the order invoice (buyer + admin download
// the same bill) and the in-house barcode label sheet. Framework-free strings so they can
// be handed straight to expo-print.
import type { Order, OrderItem, Shop } from '../types';
import { ean13Modules } from './barcode';
import { formatQty } from './format';

function money(n: number | undefined | null): string {
  return `₹${(Math.round(((n ?? 0) + Number.EPSILON) * 100) / 100).toFixed(2)}`;
}

function esc(s: string): string {
  return String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}

/** Human bill number: the stored sequential one, else a short form of the doc id. */
export function invoiceNumber(order: Pick<Order, 'id' | 'invoiceNo'>): string {
  return order.invoiceNo?.trim() || order.id.slice(0, 8).toUpperCase();
}

const PAYMENT_LABEL: Record<string, string> = {
  cod: 'Cash on delivery',
  upi: 'UPI',
  cash: 'Cash',
  card: 'Card',
};

/**
 * A4 invoice for one order. Shared by the buyer ("Download bill") and the admin order
 * detail so the two can never drift apart.
 */
export function buildInvoiceHtml(opts: { order: Order; shop: Shop | null }): string {
  const { order, shop } = opts;
  const items: OrderItem[] = order.items ?? [];
  const subtotal = order.subtotal ?? order.total ?? 0;
  const discount = order.discount ?? 0;
  const delivery = order.deliveryFee ?? 0;
  const grand = order.grandTotal ?? Math.max(0, subtotal - discount) + delivery;
  const placed = order.createdAt ? order.createdAt.toDate().toLocaleString() : '—';

  const addr = order.address;
  const addressLine = addr
    ? [addr.door, addr.street, addr.city, addr.pincode].filter(Boolean).join(', ') +
      (addr.landmark ? ` (${addr.landmark})` : '')
    : '';

  const rows = items
    .map(
      (it) => `<tr>
        <td>${esc(it.name)}</td>
        <td class="c">${esc(formatQty(it.qty, it.unit))}</td>
        <td class="r">${money(it.price)}</td>
        <td class="r">${money(it.price * it.qty)}</td>
      </tr>`,
    )
    .join('');

  const totalRows = [
    `<tr><td colspan="3" class="r">Subtotal</td><td class="r">${money(subtotal)}</td></tr>`,
    discount > 0
      ? `<tr><td colspan="3" class="r">Discount${order.couponCode ? ` (${esc(order.couponCode)})` : ''}</td><td class="r">−${money(discount)}</td></tr>`
      : '',
    order.loyaltyRedeemed
      ? `<tr><td colspan="3" class="r">Points redeemed</td><td class="r">${order.loyaltyRedeemed} pts</td></tr>`
      : '',
    `<tr><td colspan="3" class="r">Delivery</td><td class="r">${delivery > 0 ? money(delivery) : 'FREE'}</td></tr>`,
    `<tr class="grand"><td colspan="3" class="r">Total</td><td class="r">${money(grand)}</td></tr>`,
  ].join('');

  const shopBlock = [
    shop?.name ? `<div class="shop">${esc(shop.name)}</div>` : '',
    shop?.address ? `<div>${esc(shop.address).replace(/\n/g, '<br/>')}</div>` : '',
    shop?.contactPhone1 ? `<div>Phone: ${esc(shop.contactPhone1)}</div>` : '',
    shop?.contactEmail ? `<div>${esc(shop.contactEmail)}</div>` : '',
    shop?.gstin ? `<div>GSTIN: ${esc(shop.gstin)}</div>` : '',
  ]
    .filter(Boolean)
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,Roboto,Arial,sans-serif;color:#141414;padding:28px;font-size:13px}
    .head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:2px solid #141414;padding-bottom:12px}
    .shop{font-size:19px;font-weight:700}
    .title{font-size:22px;font-weight:700;text-align:right}
    .meta{text-align:right;color:#555;font-size:12px;margin-top:4px}
    .to{margin:18px 0;color:#333}
    .to b{display:block;margin-bottom:2px;color:#141414}
    table{width:100%;border-collapse:collapse;margin-top:10px}
    th,td{border-bottom:1px solid #e3e3e3;padding:7px 6px;text-align:left}
    th{background:#f5f5f5;font-size:12px;text-transform:uppercase;letter-spacing:.3px}
    td.r,th.r{text-align:right} td.c,th.c{text-align:center}
    tfoot td{border:none;padding:3px 6px}
    tr.grand td{font-weight:700;font-size:15px;border-top:2px solid #141414;padding-top:8px}
    .foot{margin-top:26px;color:#666;font-size:11px;text-align:center}
    .pay{margin-top:14px;padding:8px 10px;background:#f5f5f5;border-radius:6px}
  </style></head><body>
    <div class="head">
      <div>${shopBlock}</div>
      <div>
        <div class="title">INVOICE</div>
        <div class="meta">
          No: <b>${esc(invoiceNumber(order))}</b><br/>
          Date: ${esc(placed)}<br/>
          Status: ${esc(order.status)}
        </div>
      </div>
    </div>

    <div class="to">
      <b>Billed to</b>
      ${esc(order.customerName ?? 'Customer')}<br/>
      ${order.customerPhone ? esc(order.customerPhone) + '<br/>' : ''}
      ${addressLine ? esc(addressLine) : ''}
    </div>

    <table>
      <thead><tr><th>Item</th><th class="c">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">No items</td></tr>'}</tbody>
      <tfoot>${totalRows}</tfoot>
    </table>

    <div class="pay">
      Payment: <b>${esc(PAYMENT_LABEL[order.paymentMode ?? 'cod'] ?? (order.paymentMode ?? 'cod'))}</b>
      ${order.paymentStatus ? ` · ${esc(order.paymentStatus)}` : ''}
      ${order.upiRef ? ` · Ref ${esc(order.upiRef)}` : ''}
      ${order.loyaltyEarned ? ` · Earned ${order.loyaltyEarned} points` : ''}
    </div>

    <div class="foot">
      This is a computer-generated invoice and does not require a signature.<br/>
      ${shop?.name ? esc(shop.name) : ''}
    </div>
  </body></html>`;
}

export interface BarcodeLabel {
  code: string;
  name: string;
  price?: number | null;
}

/**
 * A sheet of scannable EAN-13 labels, laid out to be cut by hand. Bars are plain divs so no
 * font or image asset is needed — each module becomes a 2px-wide black or white column.
 */
export function buildBarcodeLabelsHtml(opts: {
  labels: BarcodeLabel[];
  shopName?: string | null;
  copiesEach?: number;
}): string {
  const copies = Math.max(1, Math.min(100, Math.floor(opts.copiesEach ?? 1)));

  const renderBars = (code: string): string => {
    let modules: string;
    try {
      modules = ean13Modules(code);
    } catch {
      return `<div class="bad">invalid: ${esc(code)}</div>`;
    }
    // Group consecutive identical modules so the output is a handful of divs, not 95.
    const parts: string[] = [];
    let i = 0;
    while (i < modules.length) {
      const ch = modules[i];
      let run = 1;
      while (i + run < modules.length && modules[i + run] === ch) run++;
      parts.push(`<i class="${ch === '1' ? 'b' : 'w'}" style="width:${run * 2}px"></i>`);
      i += run;
    }
    return `<div class="bars">${parts.join('')}</div>`;
  };

  const cells = opts.labels
    .flatMap((l) => Array.from({ length: copies }, () => l))
    .map(
      (l) => `<div class="label">
        <div class="name">${esc(l.name)}</div>
        ${renderBars(l.code)}
        <div class="code">${esc(l.code)}</div>
        ${l.price != null ? `<div class="price">₹${Number(l.price).toFixed(2)}</div>` : ''}
      </div>`,
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{margin:10mm}
    body{font-family:-apple-system,Roboto,Arial,sans-serif;margin:0;color:#000}
    h1{font-size:13px;margin:0 0 8px;color:#555;font-weight:500}
    .sheet{display:flex;flex-wrap:wrap;gap:6px}
    .label{width:200px;border:1px dashed #bbb;border-radius:4px;padding:6px;text-align:center;page-break-inside:avoid}
    .name{font-size:11px;font-weight:600;height:26px;overflow:hidden;line-height:13px}
    .bars{height:46px;display:flex;align-items:stretch;justify-content:center;margin:3px 0}
    .bars i{display:block}
    .bars i.b{background:#000}
    .bars i.w{background:#fff}
    .code{font-family:"Courier New",monospace;font-size:11px;letter-spacing:2px}
    .price{font-size:13px;font-weight:700;margin-top:2px}
    .bad{color:#c00;font-size:11px;padding:14px 0}
  </style></head><body>
    <h1>${esc(opts.shopName ?? '')} — barcode labels (${opts.labels.length} item${opts.labels.length === 1 ? '' : 's'} × ${copies})</h1>
    <div class="sheet">${cells}</div>
  </body></html>`;
}
