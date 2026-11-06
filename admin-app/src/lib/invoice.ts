// Turn an order into a shareable PDF bill. Lives in lib (not a component) because both the
// order list and the order detail trigger it.
import { assignInvoiceNumber, buildInvoiceHtml, getShop, type Order } from '@common';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { shopId } from '@/lib/config';
import { logError } from '@/lib/logging';

/**
 * Generate and share the invoice PDF for an order.
 *
 * `claimNumber` assigns the next sequential bill number — admins printing the real invoice
 * want that, whereas a buyer re-downloading their copy should not burn a number from the
 * shop's counter (and has no permission to write the shop doc anyway).
 */
export async function shareInvoice(
  order: Order,
  opts: { claimNumber?: boolean } = {},
): Promise<void> {
  let enriched = order;
  if (opts.claimNumber && !order.invoiceNo) {
    try {
      const invoiceNo = await assignInvoiceNumber(shopId, order.id);
      enriched = { ...order, invoiceNo };
    } catch (e) {
      // Numbering is a nicety — fall back to the short order id rather than failing.
      logError('invoice.assignNumber', e, { orderId: order.id });
    }
  }

  const shop = await getShop(shopId).catch(() => null);
  const html = buildInvoiceHtml({ order: enriched, shop });
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
  else await Print.printAsync({ uri });
}
