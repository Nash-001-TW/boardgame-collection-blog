const copy = {
  cache: {
    title: ['BGG 同步與快取', 'BGG sync & cache'],
    breadcrumb: ['遊戲資料', 'Game data'],
    label: ['BGG 同步與快取', 'BGG sync & cache'],
  },
  game: {
    title: ['遊戲關聯管理', 'Game relation management'],
    breadcrumb: ['遊戲資料', 'Game data'],
    label: ['遊戲關聯', 'Game relations'],
  },
  collection: {
    title: ['收藏組合管理', 'Collection combination management'],
    breadcrumb: ['收藏', 'Collection'],
    label: ['收藏組合', 'Collection combinations'],
  },
} as const;

interface RelationPageContext {
  domain: 'game' | 'collection' | null;
  lang: 'zh-TW' | 'en';
  title: string;
  breadcrumb: readonly [group: string, label: string];
}

export function relationPageContext(url: URL): RelationPageContext {
  const params = url.searchParams;
  const domain = params.get('view') !== 'relations' ? null
    : params.get('domain') === 'collection' ? 'collection' : 'game';
  const lang = params.get('lang') === 'en' ? 'en' : 'zh-TW';
  const messages = copy[domain ?? 'cache'];
  const index = lang === 'en' ? 1 : 0;
  return {
    domain,
    lang,
    title: messages.title[index],
    breadcrumb: [messages.breadcrumb[index], messages.label[index]],
  };
}
