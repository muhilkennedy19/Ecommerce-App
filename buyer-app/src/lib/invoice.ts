// Turn an order into a shareable PDF bill for the buyer's own records.
import { buildInvoiceHtml, getShop, type Order } from '@common';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { shopId } from '@/lib/config';

/**
 * Generate and share the invoice PDF for one of the buyer's orders.
 *
 * Unlike the admin copy this never claims a sequential invoice number: that counter lives
 * on the shop doc, which buyers cannot write. A buyer's bill shows the shop-assigned number
 * if one exists, else a short form of the order id.
 */
export async function shareInvoice(order: Order): Promise<void> {
  const shop = await getShop(shopId).catch(() => null);
  const html = buildInvoiceHtml({ order, shop });
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
  else await Print.printAsync({ uri });
}
