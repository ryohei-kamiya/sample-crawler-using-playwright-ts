import { toASCII as punycodeEncode } from 'punycode';
import { URL } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'fs';
import { parse as csvParse } from 'csv-parse/sync';
import * as crypto from 'crypto';
import { UrlWithRule } from '../types/url_with_rule';


export const url2dirpath = (url: string): string => {
  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname ? punycodeEncode(parsedUrl.hostname) : '';

  const h = crypto.createHash('sha256');
  h.update(Buffer.from(url, 'utf-8'));
  const digest = h.digest('hex');

  return [hostname, digest].join('/');
};


export const loadUrlWithRulesInFile = (urlWithRuleFile: string): UrlWithRule[] => {
  const data = readFileSync(urlWithRuleFile, 'utf-8')
  return csvParse(data, { columns: true });
};


export const makedir = (dirpath: string): void => {
  mkdirSync(dirpath, { recursive: true });
};

export const serialize = (_data: any): string => {
  const escape = (text: string): string => {
    let result = text.replace(/\n/g, '\\n');
    result = result.replace(/\r/g, '\\r');
    result = result.replace(/\t/g, '\\t');
    result = result.replace(/\f/g, '\\f');
    result = result.replace(/\v/g, '\\v');
    return result;
  };

  let result = _data;
  if (Array.isArray(_data)) {
    result = JSON.stringify(_data);
  } else if (_data instanceof Set) {
    result = JSON.stringify(Array.from(_data));
  } else if (typeof _data === 'object' && _data !== null) {
    result = JSON.stringify(_data);
  } else {
    result = `${_data}`;
  }
  result = result.replaceAll('\\\\n', '\\n');
  result = result.replaceAll('\\\\r', '\\r');
  result = result.replaceAll('\\\\t', '\\t');
  result = result.replaceAll('\\\\f', '\\f');
  result = result.replaceAll('\\\\v', '\\v');
  return escape(result);
};

export const outputStringArray = (lines: string[], filepath: string, flags: string = "w"): void => {
  if (lines && lines.length > 0) {
    writeFileSync(filepath, `${lines.join('\n')}\n`, {encoding: 'utf-8', flag: flags});
  }
};

export const makeSymlink = (realfile: string, linkfile: string): void => {
  symlinkSync(realfile, linkfile)
}
