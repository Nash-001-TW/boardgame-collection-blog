/** One label table for v2_collection_items.item_type (CHECK list in migration 0007),
 * shared by the R02 list and the collection detail header so a record reads the same in both. */
const itemTypeLabels: Record<string, readonly [zh: string, en: string]> = {
  base: ['本體', 'Base game'],
  expansion: ['擴充', 'Expansion'],
  standalone: ['獨立遊戲', 'Standalone'],
  bundle: ['組合', 'Bundle'],
  accessory: ['配件', 'Accessory'],
  storage: ['收納', 'Storage'],
  promo: ['宣傳品', 'Promo'],
  other: ['其他', 'Other'],
  unknown: ['未知類型', 'Unknown type'],
};

export function collectionItemTypeLabel(type: string, en: boolean): string {
  const label = itemTypeLabels[type] ?? itemTypeLabels.unknown;
  return en ? label[1] : label[0];
}
