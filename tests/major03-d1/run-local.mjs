import { request } from 'node:http';

const cases = [
    ['replay', ['committed', 'replayed', 'updatedOnce', 'evidence']],
    ['stale', ['stale', 'unchanged', 'generationAdvanced']],
    ['rollback', ['rejected', 'rolledBack']],
    ['null', ['committed', 'replayed', 'updatedOnce', 'evidence']],
];

async function run(id, expected) {
    return new Promise((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port: 18743, path: '/' + id,
            method: 'POST', agent: false, headers: { 'X-Major03-Local': 'fixed-cases' } }, res => {
            let body = '';
            res.setEncoding('utf8');
            res.on('error', reject);
            res.on('data', chunk => {
                body += chunk;
                if (body.length > 4096) req.destroy(new Error('Response too large'));
            });
            res.on('end', () => {
                if (res.statusCode !== 200) return resolve({ status: 'FAIL', httpStatus: res.statusCode });
                try {
                    const received = JSON.parse(body).checks;
                    const checks = Object.fromEntries(expected.map(key => [key, received?.[key] === true]));
                    resolve({ status: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL', checks });
                } catch {
                    resolve({ status: 'FAIL', code: 'INVALID_RESPONSE' });
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => req.destroy(new Error('Loopback timeout')));
        req.end();
    });
}

let stopped = false;
for (const [id, expected] of cases) {
    let result = { status: 'BLOCKED', code: 'PRIOR_CASE_STOP' };
    if (!stopped) {
        try {
            result = await run(id, expected);
        } catch {
            result = { status: 'BLOCKED', code: 'LOOPBACK_TRANSPORT' };
        }
    }
    stopped = result.status !== 'PASS';
    console.log(JSON.stringify({ schema: 1, mode: 'local', at: new Date().toISOString(), id, ...result }));
}
if (stopped) process.exitCode = 1;
