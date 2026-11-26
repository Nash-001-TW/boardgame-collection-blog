export const adminNavigation = [
  { id: 'overview', items: [
    { id: 'overview', path: '/admin', zh: '總覽', en: 'Overview', icon: 'home' },
  ] },
  { id: 'collection', zh: '收藏', en: 'Collection', icon: 'collection', items: [
    { id: 'collection', path: '/admin/collection', zh: '全部收藏', en: 'All collection records', icon: 'list' },
    { id: 'owned', path: '/admin/collection', query: { tab: 'owned' }, zh: '已收藏', en: 'Owned', icon: 'check-circle' },
    { id: 'wishlist', path: '/admin/collection', query: { tab: 'wishlist' }, zh: '願望清單', en: 'Wishlist', icon: 'heart' },
    { id: 'preordered', path: '/admin/collection', query: { tab: 'preordered' }, zh: '預購中', en: 'Preordered', icon: 'calendar' },
    { id: 'collection-relations', path: '/admin/bgg', query: { view: 'relations', domain: 'collection' }, zh: '收藏組合', en: 'Collection combinations', icon: 'puzzle' },
    { id: 'classification', path: '/admin/collection/components/classification', zh: '組件分類查詢', en: 'Component classification', icon: 'search' },
  ] },
  { id: 'sleeves', zh: '卡套', en: 'Sleeves', icon: 'sleeves', items: [
    { id: 'sleeves', path: '/admin/sleeves', zh: '卡套管理', en: 'Sleeve management', icon: 'sleeves' },
  ] },
  { id: 'purchases', zh: '採購', en: 'Purchasing', icon: 'cart', items: [
    { id: 'purchases', path: '/admin/purchases', zh: '採購管理', en: 'Purchase management', icon: 'cart' },
  ] },
  { id: 'game-data', zh: '遊戲資料', en: 'Game data', icon: 'database', items: [
    { id: 'bgg', path: '/admin/bgg', zh: 'BGG 管理', en: 'BGG management', icon: 'database' },
    { id: 'notbgg', path: '/admin/notbgg', zh: 'NotBGG 清單', en: 'NotBGG list', icon: 'book' },
    { id: 'relations', path: '/admin/bgg', query: { view: 'relations' }, zh: '遊戲關聯', en: 'Game relations', icon: 'puzzle' },
  ] },
] as const;

type NavigationItem = (typeof adminNavigation)[number]['items'][number];

export function adminNavigationHref(item: NavigationItem, lang: 'zh-TW' | 'en') {
  const query = new URLSearchParams('query' in item ? item.query : undefined);
  if (lang === 'en') query.set('lang', lang);
  return query.size ? item.path + '?' + query : item.path;
}

export function currentAdminItem(url: URL): NavigationItem['id'] | 'requirements' | undefined {
  const path = url.pathname.replace(/\/+$/, '');
  // Preserve the legacy route marker consumed by AdminLayout until that layout is updated.
  if (path === '/admin/sleeves/requirements') return 'requirements';
  if (path === '/admin/collection') {
    const tab = url.searchParams.get('tab');
    if (tab === 'owned' || tab === 'wishlist' || tab === 'preordered') return tab;
    if (tab === 'all') return 'collection';
    const status = url.searchParams.get('status');
    if (url.searchParams.get('wishlist') === '1' || status === 'wishlist') return 'wishlist';
    if (status === 'owned' || status === 'preordered') return status;
  }
  if (path === '/admin/bgg' && url.searchParams.get('view') === 'relations') return url.searchParams.get('domain') === 'collection' ? 'collection-relations' : 'relations';
  for (const group of adminNavigation) {
    for (const item of group.items) {
      if (!('query' in item) && item.path === path) return item.id;
    }
  }
  if (path.startsWith('/admin/collection/')) return 'collection';
  if (path.startsWith('/admin/notbgg/')) return 'notbgg';
}

export function connectAdminShell() {
  const open = document.querySelector<HTMLButtonElement>('[data-shell-open]');
  const close = document.querySelector<HTMLButtonElement>('[data-shell-close]');
  const drawer = document.querySelector<HTMLDialogElement>('[data-shell-drawer]');
  const sidebar = document.querySelector<HTMLElement>('[data-shell-sidebar]');
  if (!open || !close || !drawer || !sidebar) return;

  const content = document.getElementById('editor-content');
  if (content && !content.hasAttribute('tabindex')) content.tabIndex = -1;

  const desktop = window.matchMedia('(min-width: 1100px)');
  const placeSidebar = () => {
    if (!desktop.matches) {
      drawer.appendChild(sidebar);
      return;
    }
    if (drawer.open) drawer.close();
    drawer.parentNode?.insertBefore(sidebar, drawer);
  };
  placeSidebar();
  desktop.addEventListener('change', placeSidebar);

  open.addEventListener('click', () => {
    drawer.showModal();
    open.setAttribute('aria-expanded', 'true');
    close.focus();
  });
  close.addEventListener('click', () => drawer.close());
  drawer.addEventListener('close', () => {
    open.setAttribute('aria-expanded', 'false');
    if (!desktop.matches) open.focus();
  });

  for (const button of sidebar.querySelectorAll<HTMLButtonElement>('[data-shell-group]')) {
    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
    if (!panel) continue;
    button.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', String(!panel.hidden));
    });
  }
}
