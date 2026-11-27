import type { collectionRelationTypes, gameRelationTypes } from './relation-admin';

type Lang = 'zh-TW' | 'en';
type RelationType = (typeof collectionRelationTypes | typeof gameRelationTypes)[number];
const types = {
  requires_base: ['擴充 → 必要主遊戲', 'Expansion → required base'],
  expansion_of: ['擴充 → 主遊戲', 'Expansion → base'],
  accessory_for: ['配件 → 適用遊戲', 'Accessory → game'],
  compilation_of: ['合輯 → 內容遊戲', 'Compilation → included game'],
  bundle_contains: ['組合包 → 收藏內容', 'Bundle → collection member'],
  standalone_related: ['獨立遊戲相關', 'Standalone related'],
  same_series: ['同系列', 'Same series'],
  integrates_with: ['可整合遊玩', 'Integrates with'],
  other: ['其他（不推估細分類）', 'Other (no inferred subtype)'],
} satisfies Record<RelationType, [string, string]>;

export function relationTypeLabel(type: string, lang: Lang) {
  return Object.hasOwn(types, type) ? types[type as RelationType][lang === 'en' ? 1 : 0] : type;
}

export function relationSourceLabel(source: string, lang: Lang) {
  if (source === 'manual') return lang === 'en' ? 'Manual' : '手動';
  return source === 'bgg' ? 'BGG' : source;
}

// Game relations are stored per game (BGG English names). In Chinese, prefer the owner's own collection name
// (production, not archived; lowest collection id) and keep the BGG name as secondary text.
export function gameDisplayName(choice: Record<string, unknown> | undefined, lang: Lang, fallback?: unknown) {
  const primary = String(choice?.primary_name ?? fallback ?? '');
  const local = lang === 'en' ? '' : String(choice?.collection_name ?? '').trim();
  return local && local !== primary ? {name: local, original: primary} : {name: primary, original: ''};
}

export function relationEndpointLabel(id: unknown, choice: Record<string, unknown> | undefined, game: boolean, lang: Lang) {
  if (!choice) return '#' + String(id) + (lang === 'en' ? ' (archived or not found)' : '（已封存或找不到）');
  const identity = game
    ? choice.bgg_id ? 'BGG:' + String(choice.bgg_id) : 'NotBGG:' + String(choice.seq).padStart(6, '0')
    : '#' + String(id);
  const name = String(game ? gameDisplayName(choice, lang).name : choice.display_name);
  return lang === 'en' ? name + ' (' + identity + ')' : name + '（' + identity + '）';
}

export function relationChoiceLabel(choice: Record<string, unknown>, game: boolean, lang: Lang) {
  const endpoint = relationEndpointLabel(choice.id, choice, game, lang);
  return !game && choice.record_scope === 'test' ? endpoint + (lang === 'en' ? ' · Test' : ' · 測試') : endpoint;
}

export function relationChoiceTypeLabel(choice: Record<string, unknown>, lang: Lang) {
  const labels: Record<string, [string, string]> = {
    base: ['本體', 'Base'],
    standalone: ['獨立遊戲', 'Standalone'],
    expansion: ['擴充', 'Expansion'],
    accessory: ['配件', 'Accessory'],
    bundle: ['套組／合輯', 'Bundle / compilation'],
    unknown: ['類型未確認', 'Unverified type'],
  };
  const type = String(choice.item_type ?? choice.game_type ?? 'unknown');
  return (Object.hasOwn(labels, type) ? labels[type] : labels.unknown)[lang === 'en' ? 1 : 0];
}

export function relationDirectionHint(type: string, lang: Lang) {
  const en = lang === 'en';
  switch (type) {
    case 'requires_base':
    case 'expansion_of':
      return en ? 'Expansion → base or standalone game.' : '擴充 → 本體或獨立遊戲。';
    case 'accessory_for':
      return en ? 'Accessory → base, standalone game, or expansion.' : '配件 → 本體、獨立遊戲或擴充。';
    case 'compilation_of':
      return en ? 'Source must be a compilation.' : '來源必須是合輯。';
    case 'bundle_contains':
      return en ? 'Source must be a bundle.' : '來源必須是套組。';
    default:
      return '';
  }
}
export function crossLayerStateLabel(state: string, lang: 'en' | 'zh-TW') {
 const labels: Record<string, [string, string]> = {
  all: ['全部','All'], linked: ['已有','Linked'], addable: ['可補建','Addable'],
  blocked: ['不可建立','Blocked'], not_applicable: ['不適用','Not applicable'],
  unavailable: ['判定不可用','Check unavailable'],
 };
 return (labels[state] ?? labels.unavailable)[lang === 'en' ? 1 : 0];
}

export function crossLayerReasonLabel(reason: string, lang: 'en' | 'zh-TW') {
 const labels: Record<string, [string, string]> = {
  missing_game: ['缺少對應遊戲','Missing matching game'], same_game: ['兩端對應同一遊戲','Both ends identify the same game'],
  direction: ['類型或方向不符','Type or direction mismatch'], cycle: ['會形成循環','Would create a cycle'],
  cache_unavailable: ['BGG 快取不可用','BGG cache unavailable'], read_failed: ['讀取失敗','Read failed'],
  scope: ['兩端收藏的紀錄範圍不同','Collections have different record scopes'],
 };
 return (labels[reason] ?? labels.read_failed)[lang === 'en' ? 1 : 0];
}
