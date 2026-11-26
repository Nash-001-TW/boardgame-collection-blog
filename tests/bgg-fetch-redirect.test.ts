import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchBggGameXml } from '../src/lib/bgg.ts';

// Cloudflare Workers throws "Invalid redirect value" for redirect:'error' before any request,
// so BGG sync must use 'manual' and treat any 3xx as a failed HTTP response.
test('BGG fetch uses a Workers-supported redirect mode and does not follow redirects', async () => {
    let seen: RequestInit | undefined;
    const ok: typeof fetch = async (_input, init) => {
        seen = init;
        return new Response('<items><item type="boardgame" id="1"></item></items>', { status: 200 });
    };
    await fetchBggGameXml(1, { token: 'test-token', fetcher: ok });
    assert.equal(seen?.redirect, 'manual');

    const redirected: typeof fetch = async () => new Response(null, { status: 301, headers: { Location: 'https://example.test/' } });
    await assert.rejects(fetchBggGameXml(1, { token: 'test-token', fetcher: redirected }), /^Error: BGG API HTTP 301$/);
});
