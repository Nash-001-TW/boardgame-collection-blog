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

export function relationEndpointLabel(id: unknown, choice: Record<string, unknown> | undefined, game: boolean, lang: Lang) {
  if (!choice) return '#' + String(id) + (lang === 'en' ? ' (archived or not found)' : '（已封存或找不到）');
  const identity = game
    ? choice.bgg_id ? 'BGG:' + String(choice.bgg_id) : 'NotBGG:' + String(choice.seq).padStart(6, '0')
    : '#' + String(id);
  const name = String(game ? choice.primary_name : choice.display_name);
  return lang === 'en' ? name + ' (' + identity + ')' : name + '（' + identity + '）';
}

export function relationChoiceLabel(choice: Record<string, unknown>, game: boolean, lang: Lang) {
  const endpoint = relationEndpointLabel(choice.id, choice, game, lang);
  return !game && choice.record_scope === 'test' ? endpoint + (lang === 'en' ? ' · Test' : ' · 測試') : endpoint;
}
