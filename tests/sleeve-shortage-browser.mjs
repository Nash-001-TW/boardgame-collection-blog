import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export async function checkSleeveShortage({ cdp, navigate, evaluate, until, pass, capture }) {
    const sizes = '/admin/sleeves?view=sizes&fixture=shortage';
    for (const width of [1440, 768, 375]) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await navigate(sizes);
        const result = await evaluate(() => ({
            width: document.documentElement.scrollWidth,
            states: [...document.querySelectorAll('[data-size-status]')].map(row => row.dataset.sizeStatus),
            text: document.querySelector('.sleeve-size-table')?.innerText,
        }));
        assert.equal(result.width, width);
        assert.deepEqual(result.states, ['shortage', 'shortage', 'incomplete', 'none', 'no_product', 'sufficient']);
        assert.match(result.text, /停用庫存 100/);
        assert.match(result.text, /啟用產品庫存尚未建立/);
        await capture('sizes-' + width);
        pass('size table at ' + width);
    }

    await evaluate(() => {
        const form = document.querySelector('select[name=status]').form;
        const fixture = document.createElement('input');
        Object.assign(fixture, { type: 'hidden', name: 'fixture', value: 'shortage' });
        form.append(fixture);
        form.elements.status.value = 'shortage';
        form.elements.size.value = '6';
        form.requestSubmit();
    });
    const filtered = () => evaluate(() => new URL(location.href).searchParams.get('status') === 'shortage' &&
        document.querySelectorAll('[data-size-status]').length === 1 &&
        document.querySelector('[data-size-status]').dataset.sleeveRecord === '6');
    await until(filtered, 'submitted filters');
    await cdp('Page.reload');
    await until(filtered, 'reloaded filters');
    await cdp('Runtime.evaluate', { expression: 'history.back()' });
    await until(() => evaluate(() => !location.search.includes('status=') &&
        document.querySelectorAll('[data-size-status]').length === 6), 'back to all sizes');
    pass('filter form, URL, refresh and back navigation');

    await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await navigate('/admin?fixture=shortage');
    assert.match(await evaluate(() => document.querySelector('.admin-kit-alert').innerText), /2 種尺寸庫存不足[\s\S]*另有 1 種尺寸資料不完整/);
    assert.match(await evaluate(() => document.querySelector('.admin-kit-status-list')?.innerText ?? document.querySelector('main').innerText), /庫存不足\s*2[\s\S]*資料不完整\s*1/);
    const links = await evaluate(() => [...document.querySelectorAll('.admin-kit-pending a')].map(a => a.getAttribute('href')));
    assert.deepEqual(links, ['/admin/sleeves?view=sizes&status=shortage', '/admin/sleeves?view=sizes&status=incomplete']);
    await capture('r01-shortages');
    pass('R01 alert, both counts and both pending links');

    await navigate('/admin?fixture=sleeve-failure');
    assert.ok(await evaluate(() => {
        const heading = [...document.querySelectorAll('h3')].find(h => h.textContent.trim() === '卡套狀況');
        return (heading?.closest('article')?.textContent.match(/無法取得/g) ?? []).length === 4 &&
            document.querySelector('main').innerText.includes('JPY');
    }));
    await capture('r01-unavailable');
    pass('R01 sleeve read failure stays isolated');

    await navigate('/admin/collection/1/sleeves?fixture=shortage');
    assert.deepEqual(await evaluate(() => [...document.querySelectorAll('[data-sleeve-shortage]')].map(p => p.textContent)), [
        '此尺寸與其他收藏合計的需求超過庫存', '此尺寸資料不完整，無法判定庫存是否足夠',
        '尚無此尺寸的卡套產品', '此尺寸與其他收藏合計的需求超過庫存',
    ]);
    await capture('collection-shortage');
    pass('collection shortage, incomplete and no-product messages');

    await navigate(sizes + '&lang=en');
    const english = await evaluate(() => document.querySelector('[aria-label="Size stock"]')?.innerText);
    for (const message of ['Shortage', 'Incomplete data', 'No products', 'Sufficient', 'Inactive stock']) assert.ok(english?.includes(message));
    await capture('sizes-en');
    await navigate('/admin/collection/1/sleeves?fixture=shortage&lang=en');
    assert.equal(await evaluate(() => document.querySelector('[data-sleeve-shortage=no_product]')?.textContent), 'No sleeve products for this size');
    pass('English size table and collection hints');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.env.SLV_SHORT_BROWSER = '1';
    await import('./admin-dashboard-browser.mjs');
}

