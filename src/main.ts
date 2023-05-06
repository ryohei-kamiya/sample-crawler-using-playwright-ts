import { program } from 'commander';
import { readFileSync } from 'fs';
import { Worker } from 'worker_threads';

const crawlPages = (browserTypeStr: string, urls: string[]): void => {
  urls.forEach(async (url) => {
    const worker = new Worker('./dist/workers/crawler.js', {
      workerData: { browserTypeStr, url },
    });

    worker.on('message', (message) => {
      console.log(`URL: ${message.url}`);
      console.log(`Browser: ${message.browserTypeStr}`);
      console.log(`Title: ${message.title}`);
      console.log(`Content: ${message.content}`);
      console.log(`Links: ${message.links.join('\n')}`);
    });

    worker.on('error', (error) => {
      console.error(`Error: ${error.message}`);
    });

    worker.on('exit', (code) => {
      if (code !== 0) console.error(`Worker stopped with exit code ${code}`);
    });
  });
};

const loadUrlsInFile = (urlFile: string): string[] => {
  return readFileSync(urlFile, 'utf-8')
    .split('\n')
    .filter((url) => {
      // 行頭・行末の空白文字列は除去
      url = url.trim();

      // 先頭に # を含む行は無視
      const doesNotStartWithHash = !url.startsWith('#');

      // 空行は無視
      const isNotEmpty = url.trim().length > 0;

      return doesNotStartWithHash && isNotEmpty;
    });
};

const main = (): void => {
  // コマンドラインオプションを解析
  program
    .option('-u, --url-file <file>', 'URLリストを含むファイル')
    .option(
      '-b, --browser-types <types>',
      'カンマ区切りのブラウザタイプリスト (例: chromium,firefox,webkit)',
    )
    .parse(process.argv);

  const options = program.opts();

  if (!options.urlFile || !options.browserTypes) {
    console.error('必要なオプションが指定されていません。');
    process.exit(1);
  }

  const urlFile = options.urlFile;
  const browserTypeStrs = options.browserTypes.split(',');

  // URLリストをファイルから読み込む
  const urls = loadUrlsInFile(urlFile);

  // 各ブラウザでクロールを実行
  browserTypeStrs.forEach(async (browserTypeStr: string) => {
    crawlPages(browserTypeStr, urls);
  });
};

main();
