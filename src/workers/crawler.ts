import { parentPort, workerData } from 'worker_threads';
import { BrowserType } from 'playwright';
import { chromium, firefox, webkit } from 'playwright-extra';
import { Semaphore, Mutex } from 'async-mutex';
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { UrlWithRule } from '../types/url_with_rule';
import * as setUtil from '../utils/set_util';

const Y_SCROLL_STEP = 500
const MIN_SLEEP_SEC = 1
const MAX_SLEEP_SEC = 3
const MAX_CONCURRENT_CRAWLS = 3


export type CrawledResult = {
  url: string;
  title: string;
  keywords: string;
  description: string;
  content: string;
  bodyText: string;
  links: Set<string>;
  redirectedUrls: { [key: string]: string };
  jsFiles: { [key: string]: string };
  backlink: string;
};

const mutex0 = new Mutex();
const ignoredLinkFilterRegex = new RegExp('^.*\.pdf$|^.*\.docx?$|^.*\.xlsx?$|^.*\.pptx?$|^.*\.jpe?g$|^.*\.png$|^.*\.gif$|^.*\.webp$|^mailto:.*$|^tel:.*$|^javascript:.*$');

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const crawl = async (url: string, backlink: string, browserType: BrowserType): Promise<CrawledResult> => {

  const result: CrawledResult = {
    url: "",
    title: "",
    keywords: "",
    description: "",
    content: "",
    bodyText: "",
    links: new Set(),
    redirectedUrls: {},
    jsFiles: {},
    backlink: "",
  };
  const browser = await browserType.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const responseHandler = (response: any) => {
      // リダイレクトを検出
      if (300 <= response.status() && response.status() < 400 && response.headers().location) {
        if (response.url()) {
          result.redirectedUrls[response.url()] = response.headers().location;
        }
      }
      // JavaScriptファイルの内容を取得
      if (response.request().resourceType() === 'script') {
        if (response.ok() && response.url() && !result.jsFiles[response.url()]) {
          getJsContent(response);
        }
      }
    };
    const getJsContent = async (response: any) => {
      if (!result.jsFiles[response.url()]) {
        const content = await response.text();
        result.jsFiles[response.url()] = content;
      }
    };
    page.on('response', responseHandler); // 全てのコンテンツのresponseイベントを捕捉

    await page.goto(url, {waitUntil: 'networkidle'});
  
    // タイトルを抽出
    result.title = await page.title();

    // コンテンツを抽出
    result.content = await page.content();

    // ページに設定されているキーワードを抽出
    const keywordsElementLocator = page.locator('meta[name="keywords"]');
    const keywordsElements = await keywordsElementLocator.all();
    if (keywordsElements && keywordsElements.length > 0) {
      let keywords = await keywordsElements[0].getAttribute('content');
      if (keywords) {
        keywords = keywords.trim();
        keywords = keywords.replace(/\r/g, '\n');
        keywords = keywords.replace(/\n+/g, '\\n');
        result.keywords = keywords.replace(/\s+/g, ' ');
      }
    }

    // ページに設定されている説明文を抽出
    const descriptionElementLocator = page.locator('meta[name="description"]').first();
    const descriptionElements = await descriptionElementLocator.all();
    if (descriptionElements && descriptionElements.length > 0) {
      let description = await descriptionElements[0].getAttribute('content');
      if (description) {
        description = description.trim();
        description = description.replace(/\r/g, '\n');
        description = description.replace(/\n+/g, '\\n');
        result.description = description.replace(/\s+/g, ' ');
      }
    }

    // ページ全体のテキストを抽出
    const bodyElementLocator = page.locator('body').first();
    const bodyElements = await bodyElementLocator.all();
    if (bodyElements && bodyElements.length > 0) {
      let bodyText = await bodyElements[0].innerText();
      if (bodyText) {
        bodyText = bodyText.trim();
        bodyText = bodyText.replace(/\r/g, '\n');
        bodyText = bodyText.replace(/\n+/g, '\\n');
        result.bodyText = bodyText.replace(/\s+/g, ' ');
      }
    }

    /*
    * ここから、スクロールでリンク一覧を読み込むタイプのページ向けの処理
    */

    // window.scrollYの最大値を取得
    let maxScrollY = await page.evaluate(() => {
      return document.documentElement.scrollHeight - window.innerHeight;
    });
    let scrollPosition = {x: 0, y: 0};
    while (scrollPosition.y < maxScrollY - Y_SCROLL_STEP) {
      // ページを特定の量だけスクロール
      await page.evaluate(() => {
        window.scrollBy(0, Y_SCROLL_STEP);  // Y方向に Y_SCROLL_STEP px だけスクロール
      });
      // 現在のスクロール位置を取得
      scrollPosition = await page.evaluate(() => {
        return {
          x: window.scrollX,
          y: window.scrollY,
        };
      });
      // window.scrollYの最大値を更新
      maxScrollY = await page.evaluate(() => {
        return document.documentElement.scrollHeight - window.innerHeight;
      });
      // ランダムに MIN_SLEEP_SEC 〜 MAX_SLEEP_SEC 秒待つ
      await sleep((Math.random() + MIN_SLEEP_SEC) * MAX_SLEEP_SEC * 1000);
    }

    /*
    * ここまで、スクロールでリンク一覧を読み込むタイプのページ向けの処理
    */

    // リンク一覧を抽出
    const linkLocators = page.locator('a');
    const anchors = await linkLocators.all();
    if (anchors && anchors.length > 0) {
      for (const anchor of anchors) {
        if (!anchor || !anchor.isVisible() || !anchor.isEnabled()) {
          continue;
        }
        const linkHref = await anchor.getAttribute('href');
        if (linkHref && typeof linkHref === 'string') {
          const linkUrl = new URL(linkHref, url).toString().trim(); // 相対URLを絶対URLに変換します。
          if (linkUrl && linkUrl !== url) {
            if (!linkUrl.match(ignoredLinkFilterRegex)) {
              result.links.add(linkUrl);
            }
          }
        }
      }
    }

    // クロールしたURLをセット
    result.url = url;

    // バックリンクURLをセット
    if (backlink) {
      result.backlink = backlink;
    }

    return result;
  } catch (error) {
    console.error("catch error in crawl");
    if (error instanceof Error) {
      console.error(error.message);
    } else if (typeof error === 'string') {
      console.error(error);
    } else {
      console.error('Unknown error');
    }
    throw error;
  } finally {
    // ランダムに MIN_SLEEP_SEC 〜 MAX_SLEEP_SEC 秒待つ
    await sleep((Math.random() + MIN_SLEEP_SEC) * MAX_SLEEP_SEC * 1000);
    await page.close();
    await context.close();
    await browser.close();
  }
};

const recursiveCrawl = async (
    allUrls: Set<string> = new Set(),
    backLinks: { [key: string]: string },
    linkFilterRegex: RegExp,
    linkDepth: number,
    browserType: BrowserType,
    processedUrls: Set<string>): Promise<void> => {
  try {
    const urls = Array.from(setUtil.difference(allUrls, processedUrls));
    const mutex1 = new Mutex();
    await mutex1.acquire();
    let urlsLength = urls.length;
    const semaphore = new Semaphore(MAX_CONCURRENT_CRAWLS);
    urls.sort((a, b) => 0.5 - Math.random()).forEach(async (url) => {
      const [semaphoreValue, semaphoreRelease] = await semaphore.acquire();
      try {
        if (!url.match(linkFilterRegex)) {
          return;
        }
        const backlink = backLinks[url];
        const result = await crawl(url, backlink, browserType);
        parentPort?.postMessage(result);
        processedUrls.add(url);
        for (const link of result.links) {
          allUrls.add(link);
          backLinks[link] = url;
        }
      } catch (error) {
        console.error("catch error in recursiveCrawl 1");
        if (error instanceof Error) {
          console.error(error.message);
        } else if (typeof error === 'string') {
          console.error(error);
        } else {
          console.error('Unknown error');
        }
        throw error;
      } finally {
        semaphoreRelease();
        urlsLength--;
        if (urlsLength <= 0) {
          mutex1.release();
        }
      }
    });
    await mutex1.waitForUnlock();
    if (linkDepth > 0 && setUtil.difference(allUrls, processedUrls).size > 0) {
      await recursiveCrawl(allUrls, backLinks, linkFilterRegex, linkDepth - 1, browserType, processedUrls);
    } else {
      mutex0.release();
    }
  } catch (error) {
    console.error("catch error in recursiveCrawl 0");
    if (error instanceof Error) {
      console.error(error.message);
    } else if (typeof error === 'string') {
      console.error(error);
    } else {
      console.error('Unknown error');
    }
    throw error;
  }
};

const runCrawler = async (urlWithRule: UrlWithRule, browserTypeStr: string) => {
  let browserType: BrowserType | undefined;
  switch (browserTypeStr) {
    case 'chromium':
      chromium.use(StealthPlugin())
      browserType = chromium;
      break;
    case 'firefox':
      firefox.use(StealthPlugin())
      browserType = firefox;
      break;
    case 'webkit':
      webkit.use(StealthPlugin())
      browserType = webkit;
      break;
    default:
      throw new Error(`Unsupported browser type: ${browserTypeStr}`);
  }
  try {
    await mutex0.acquire();
    const url = urlWithRule.url;
    const backlink = urlWithRule.backlink;
    const allUrls = new Set([url]);
    const backLinks = { url: backlink ? backlink : "" };
    const linkFilterRegex = urlWithRule.filter ? new RegExp(urlWithRule.filter): new RegExp((new URL(urlWithRule.url)).hostname.replaceAll('.', '\.'));
    const linkDepth = urlWithRule.depth ? urlWithRule.depth : 0;
    await recursiveCrawl(allUrls, backLinks, linkFilterRegex, linkDepth, browserType, new Set());
  } catch (error) {
    console.error("catch error in crawlPages");
    if (error instanceof Error) {
      console.error(error.message);
    } else if (typeof error === 'string') {
      console.error(error);
    } else {
      console.error('Unknown error');
    }
    throw error;
  } finally {
    await mutex0.waitForUnlock();
  }
};

const { urlWithRule, browserTypeStr } = workerData as {
  urlWithRule: UrlWithRule;
  browserTypeStr: string;
};
runCrawler(urlWithRule, browserTypeStr);
