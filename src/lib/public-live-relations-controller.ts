import type {PublicLiveRelation} from './public-live-relations';

function relationGroup({kind, role}: PublicLiveRelation) {
  if (kind === 'compilations' || kind === 'compilation_of') return 'compilation';
  if (kind === 'accessory_for' || kind === 'compatible_with') return 'accessory';
  if (kind === 'same_series') return 'series';
  if (kind === 'integrates_with') return 'integration';
  if (role === 'expansion') return 'expansion';
  if (role === 'base') return kind === 'requires_base' ? 'required' : 'base';
  return 'other';
}

function cover(src: string | null) {
  const placeholder = document.createElement('span');
  placeholder.className = 'relation-placeholder';
  placeholder.textContent = '◇';
  placeholder.setAttribute('aria-hidden', 'true');
  if (!src) return placeholder;

  const image = document.createElement('img');
  image.alt = '';
  image.width = 42;
  image.height = 55;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.addEventListener('error', () => image.replaceWith(placeholder), {once: true});
  image.src = src;
  return image;
}

function initialize() {
  document.querySelectorAll<HTMLElement>('[data-live-relations]').forEach(root => {
    if (root.dataset.ready) return;
    root.dataset.ready = 'true';
    const en = root.dataset.lang === 'en';
    const t = (zh: string, english: string) => en ? english : zh;
    const body = root.querySelector<HTMLElement>('[data-live-relation-body]')!;
    const heading = root.querySelector('h2')!;
    const retry = root.querySelector<HTMLButtonElement>('[data-live-relation-retry]')!;
    const slugIds: Record<string, number> = JSON.parse(root.dataset.bggSlugs ?? '{}');
    const labels = {
      expansion: t('擴充內容', 'Expansion content'),
      base: t('主遊戲', 'Base game'),
      required: t('必要主遊戲', 'Required base game'),
      accessory: t('適用配件', 'Compatible accessory'),
      series: t('同系列', 'Same series'),
      integration: t('可整合遊玩', 'Integrable play'),
      compilation: t('合輯關聯', 'Compilation relation'),
      other: t('其他', 'Other'),
    };
    let busy = false;

    function renderRow(row: PublicLiveRelation) {
      const item = document.createElement('li');
      const copy = document.createElement('div');
      const name = document.createElement('a');
      name.href = row.href;
      name.textContent = row.name;
      copy.appendChild(name);

      const path = new URL(row.href, location.origin).pathname;
      const id = path.match(/\/(?:games\/bgg|boardgame)\/(\d+)(?:\/|$)/)?.[1]
        ?? slugIds[path.match(/^\/(?:en\/)?games\/([^/]+)$/)?.[1] ?? ''];
      const details = document.createElement('div');
      details.className = 'live-relation-details';
      if (id) {
        const identity = document.createElement('span');
        identity.textContent = 'BGG:' + id;
        details.appendChild(identity);
      }
      const source = document.createElement('span');
      source.textContent = (row.sources ?? [row.source]).map(value => value === 'bgg' ? 'BGG' : t('管理員', 'Admin')).join(t('＋', '+'));
      details.appendChild(source);
      if (row.owned) {
        const owned = document.createElement('span');
        owned.className = 'live-relation-owned';
        owned.textContent = t('已收藏', 'Collected');
        details.appendChild(owned);
      }
      if (row.role === 'unconfirmed') {
        const pending = document.createElement('span');
        pending.className = 'live-relation-pending';
        pending.textContent = t('方向待確認', 'Direction pending');
        details.appendChild(pending);
      }
      copy.appendChild(details);
      item.appendChild(cover(row.image));
      item.appendChild(copy);
      return item;
    }

    async function load() {
      if (busy) return;
      busy = true;
      retry.hidden = true;
      try {
        const response = await fetch('/api/public/relations/' + encodeURIComponent(root.dataset.key!) + '?lang=' + root.dataset.lang, {cache: 'no-store'});
        const result = await response.json() as {success?: boolean; data?: {relations: PublicLiveRelation[]}};
        if (!response.ok || !result.success || !result.data) throw new Error('Relations unavailable');

        const {relations} = result.data;
        heading.textContent = t(`相關遊戲 · 共 ${relations.length} 款`, `Related games - ${relations.length} total`);
        body.replaceChildren();
        if (!relations.length) {
          body.textContent = t('尚無可公開的可靠關聯。', 'No reliable public relations recorded.');
          return;
        }

        const groups = new Map<keyof typeof labels, HTMLUListElement>();
        for (const row of relations) {
          const key = relationGroup(row);
          let list = groups.get(key);
          if (!list) {
            list = document.createElement('ul');
            groups.set(key, list);
          }
          list.appendChild(renderRow(row));
        }
        for (const [key, label] of Object.entries(labels)) {
          const list = groups.get(key as keyof typeof labels);
          if (!list) continue;
          const group = document.createElement('h3');
          group.textContent = label;
          body.appendChild(group);
          body.appendChild(list);
        }
      } catch {
        body.textContent = t('關聯資料查詢失敗，請稍後重試。', 'Relations could not be loaded. Please retry.');
        retry.hidden = false;
      } finally {
        busy = false;
      }
    }

    retry.addEventListener('click', () => void load());
    void load();
  });
}

initialize();
document.addEventListener('astro:page-load', initialize);
