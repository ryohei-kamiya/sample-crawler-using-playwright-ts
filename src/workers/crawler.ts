import { parentPort, workerData } from 'worker_threads';
import { chromium, firefox, webkit, BrowserType } from 'playwright';

const crawl = async (url: string, browserType: BrowserType) => {
  const browser = await browserType.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);

  // タイトル, コンテンツ, リンクを抽出
  const title = await page.title();
  const content = await page.content();
  const links = await page.$$eval('a', (anchors) => anchors.map((a) => a.href));

  await browser.close();
  return { title, content, links };
};

const crawlPage = async (browserTypeStr: string, url: string) => {
  try {
    let browserType: BrowserType | undefined;

    switch (browserTypeStr) {
      case 'chromium':
        browserType = chromium;
        break;
      case 'firefox':
        browserType = firefox;
        break;
      case 'webkit':
        browserType = webkit;
        break;
      default:
        throw new Error(`Unsupported browser type: ${browserTypeStr}`);
    }

    const { title, content, links } = await crawl(url, browserType);
    parentPort?.postMessage({
      url,
      browserTypeStr,
      title,
      content,
      links,
    });
  } catch (error) {
    if (error instanceof Error) {
      parentPort?.postMessage({ error: error.message });
    } else if (typeof error === 'string') {
      parentPort?.postMessage({ error: error });
    } else {
      console.error('unexpected error');
    }
  }
};

const { browserTypeStr, url } = workerData as {
  browserTypeStr: string;
  url: string;
};
crawlPage(browserTypeStr, url);
