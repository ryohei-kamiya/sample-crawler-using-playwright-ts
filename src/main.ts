import { program } from 'commander';
import { Worker } from 'worker_threads';
import { v4 as uuidv4 } from 'uuid';
import { Semaphore } from 'async-mutex';
import { url2dirpath, makedir, loadUrlWithRulesInFile, serialize, outputStringArray } from './utils/io_util';
import { UrlWithRule } from './types/url_with_rule';
import { CrawledResult } from './workers/crawler';

const MAX_CONCURRENT_TOP_LEVEL_CRAWLS = 10


const crawlPages = (browserTypeStr: string, urlWithRules: UrlWithRule[], outputRootDir: string): void => {
  const browserDirPath = `${outputRootDir}/${browserTypeStr}`;
  makedir(browserDirPath);

  const allProcessedUrlsPath = `${browserDirPath}/all_processed_urls.txt`;
  const allRedirectedUrlsPath = `${browserDirPath}/all_redirected_urls.txt`;
  const allErrorUrlsPath = `${browserDirPath}/all_error_urls.txt`;
  const allLinkUrlsPath = `${browserDirPath}/all_link_urls.txt`;
  const allInternalLinkUrlsPath = `${browserDirPath}/all_internal_link_urls.txt`;
  const allExternalLinkUrlsPath = `${browserDirPath}/all_external_link_urls.txt`;
  const allSummariesPath = `${browserDirPath}/all_summaries.txt`;

  const semaphore = new Semaphore(MAX_CONCURRENT_TOP_LEVEL_CRAWLS);

  urlWithRules.sort((a, b) => 0.5 - Math.random()).forEach(async (urlWithRule: UrlWithRule) => {
    const url = urlWithRule.url;
    const linkFilterRegex = new RegExp(urlWithRule.filter);
    try {
      const [semaphoreValue, semaphoreRelease] = await semaphore.acquire();
      const worker = new Worker('./dist/workers/crawler.js', {
        workerData: { urlWithRule, browserTypeStr },
      });

      worker.on('message', (result: CrawledResult) => {
        console.log(`Crawled: ${result.url}`);

        let dirpath = url2dirpath(result.url);
        try {
          makedir(`${browserDirPath}/page/${dirpath}`);
        } catch (error) {
          if (error instanceof Error) {
            console.error(error.message);
          } else if (typeof error === 'string') {
            console.error(error);
          } else {
            console.error('Unknown error');
          }
          dirpath = `__${uuidv4()}`;
          makedir(`${browserDirPath}/page/${dirpath}`);
        }
        dirpath = `${browserDirPath}/page/${dirpath}`;
        outputStringArray([result.content], `${dirpath}/content.html`);

        const urlWithBacklinks: string[] = [];
        const internalUrlWithBacklinks: string[] = [];
        const externalUrlWithBacklinks: string[] = [];
        for (const link of result.links) {
          if (link && link.trim()) {
            const record = serialize({"url": link, "backlink": result.url});
            urlWithBacklinks.push(record);
            if (link.match(linkFilterRegex)) {
              internalUrlWithBacklinks.push(record);
            } else {
              externalUrlWithBacklinks.push(record);
            }
          }
        }
        outputStringArray(urlWithBacklinks, `${dirpath}/links.txt`);
        outputStringArray(internalUrlWithBacklinks, `${dirpath}/internal_links.txt`);
        outputStringArray(externalUrlWithBacklinks, `${dirpath}/external_links.txt`);

        // ページ内のJavaScriptファイルを出力
        const jsUrls: string[] = [];
        for (const [jsUrl, jsContent] of Object.entries(result.jsFiles)) {
          let jsDirpath: string = url2dirpath(jsUrl);
          try {
            makedir(`${browserDirPath}/js/${jsDirpath}`);
          } catch (error) {
            if (error instanceof Error) {
              console.error(error.message);
            } else if (typeof error === 'string') {
              console.error(error);
            } else {
              console.error('Unknown error');
            }
            jsDirpath = `__${uuidv4()}`;
            makedir(`${browserDirPath}/js/${jsDirpath}`);
          }
          jsDirpath = `${browserDirPath}/js/${jsDirpath}`;
          outputStringArray([jsContent], `${jsDirpath}/script.js`);  // JavaScriptのURLに対応するディレクトリに保存
          jsUrls.push(serialize({"url": jsUrl, "directory": `${jsDirpath}`}));
        }
        outputStringArray(jsUrls, `${dirpath}/js_urls.txt`);  // JavaScriptのURLと保存先の関連のリストを保存

        outputStringArray([result.url], allProcessedUrlsPath, 'a');
        outputStringArray([serialize({"url": result.url, "title": result.title, "keywords": result.keywords, "description": result.description, "bodyText": result.bodyText, "backlink": result.backlink, "directory": dirpath})], allSummariesPath, 'a');
        outputStringArray(urlWithBacklinks, allLinkUrlsPath, 'a');
        outputStringArray(internalUrlWithBacklinks, allInternalLinkUrlsPath, 'a');
        outputStringArray(externalUrlWithBacklinks, allExternalLinkUrlsPath, 'a');
        const redirectedUrls: string[] = [];
        for (const [key, value] of Object.entries(result.redirectedUrls)) {
          redirectedUrls.push(serialize({'url': key, 'location': value}));
        }
        outputStringArray(redirectedUrls, allRedirectedUrlsPath, 'a');
      });

      worker.on('error', (error) => {
        console.error(`Error in worker: ${error.message}`);
        outputStringArray([url], allErrorUrlsPath, 'a');
      });

      worker.on('exit', (code) => {
        console.error(`Worker stopped with exit code ${code}`);
        semaphoreRelease();
      });
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Error: ${url} ${error.message}`);
      } else if (typeof error === 'string') {
        console.error(`Error: ${url} ${error}`);
      } else {
        console.error(`Unknown error: ${url}`);
      }
    }
  });
};


const main = (): void => {
  // コマンドラインオプションを解析
  program
    .option(
      '-u, --url-file <file>',
      'クロール対象ルール付きURLリストファイル',
      './test/test-url-with-rules.txt'
    )
    .option(
      '-b, --browser-types <types>',
      'カンマ区切りのブラウザタイプリスト (例: chromium,firefox,webkit)',
      'chromium'
    )
    .option(
      '-o, --output-root-dir <dir>',
      '処理結果の保存先ディレクトリのパス',
      './output'
    )
    .parse(process.argv);

  const options = program.opts();

  if (!options.urlFile || !options.browserTypes || !options.outputRootDir) {
    console.error('必要なオプションが指定されていません。');
    process.exit(1);
  }

  const urlFile = options.urlFile;
  const browserTypeStrs = options.browserTypes.split(',');
  const outputRootDir = options.outputRootDir;

  // クロール対象ルール付きURLリストをファイルから読み込む
  const urlWithRules = loadUrlWithRulesInFile(urlFile);

  // 各ブラウザでクロールを実行
  browserTypeStrs.forEach(async (browserTypeStr: string) => {
    console.log(`Browser: ${browserTypeStr}`);
    crawlPages(browserTypeStr, urlWithRules, outputRootDir);
  });
};


main();
