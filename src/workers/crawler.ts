import { parentPort, workerData } from 'worker_threads';
import { BrowserType } from 'playwright';
import { chromium, firefox, webkit } from 'playwright-extra';
import { Semaphore, Mutex } from 'async-mutex';
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { UrlWithRule } from '../types/url_with_rule';
import * as setUtil from '../utils/set_util';

export type CrawledResult = {
  url: string;
  title: string;
  content: string;
  links: Set<string>;
  redirectedUrls: { [key: string]: string };
  jsFiles: { [key: string]: string };
};

const mutex0 = new Mutex();
const ignoredLinkFilterRegex = new RegExp('^.*\.pdf$|^.*\.docx?$|^.*\.xlsx?$|^.*\.pptx?$|^.*\.jpe?g$|^.*\.png$|^.*\.gif$|^.*\.webp$|^mailto:.*$|^tel:.*$|^javascript:.*$');

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const crawl = async (url: string, browserType: BrowserType): Promise<CrawledResult> => {

  const result: CrawledResult = {
    url: "",
    title: "",
    content: "",
    links: new Set(),
    redirectedUrls: {},
    jsFiles: {}
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

    await page.goto(url);
  
    // タイトルを抽出
    result.title = await page.title();

    // コンテンツを抽出
    result.content = await page.content();

    // リンク一覧を抽出
    const linkLocators = page.locator('a');
    const anchors = await linkLocators.all();
    for (const anchor of anchors) {
      if (!anchor.isVisible() && !anchor.isEnabled()) {
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

    // クロールしたURLをセット
    result.url = url;

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
    await sleep((Math.random() + 1.0) * 3000); // ランダムに1〜3秒待つ
    await page.close();
    await context.close();
    await browser.close();
  }
};

const recursiveCrawl = async (allUrls: Set<string> = new Set(), linkFilterRegex: RegExp, linkDepth: number, browserType: BrowserType, processedUrls: Set<string>): Promise<void> => {
  try {
    const urls = Array.from(setUtil.difference(allUrls, processedUrls));
    const mutex1 = new Mutex();
    await mutex1.acquire();
    let urlsLength = urls.length;
    const semaphore = new Semaphore(3);
    urls.sort((a, b) => 0.5 - Math.random()).forEach(async (url) => {
      const [semaphoreValue, semaphoreRelease] = await semaphore.acquire();
      try {
        if (!url.match(linkFilterRegex)) {
          return;
        }
        const result = await crawl(url, browserType);
        parentPort?.postMessage(result);
        processedUrls.add(url);
        for (const link of result.links) {
          allUrls.add(link);
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
      await recursiveCrawl(allUrls, linkFilterRegex, linkDepth - 1, browserType, processedUrls);
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
    const allUrls = new Set([urlWithRule.url]);
    const linkFilterRegex = urlWithRule.filter ? new RegExp(urlWithRule.filter): new RegExp((new URL(urlWithRule.url)).hostname.replaceAll('.', '\.'));
    const linkDepth = urlWithRule.depth ? urlWithRule.depth : 0;
    await recursiveCrawl(allUrls, linkFilterRegex, linkDepth, browserType, new Set());
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
