// 배포 완료 후 IndexNow(Bing · 네이버 · DuckDuckGo · ChatGPT Search 등)에 변경 URL을 자동 알립니다.
import { readFile, readdir } from 'node:fs/promises';

const cfg = JSON.parse(await readFile('config.json', 'utf8').catch(() => '{}'));
const siteUrl = (cfg.siteUrl || 'https://minaryhub.github.io').replace(/\/+$/, '') + '/';
const host = new URL(siteUrl).host;

// 저장소 루트의 32자리 16진수 IndexNow 키 파일 탐색
const files = await readdir('.');
const keyFile = files.find((f) => /^[0-9a-f]{32}\.txt$/i.test(f));
if (!keyFile) {
  console.log('ℹ No IndexNow key file found — skipping');
  process.exit(0);
}
const key = (await readFile(keyFile, 'utf8')).trim();
const keyLocation = `${siteUrl}${keyFile}`;

try {
  const smRes = await fetch(`${siteUrl}sitemap.xml`, { headers: { Accept: 'application/xml' } });
  if (!smRes.ok) throw new Error(`sitemap.xml HTTP ${smRes.status}`);
  const xml = await smRes.text();
  const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()).filter(Boolean);
  if (!urlList.length) {
    console.log('ℹ No URLs found in sitemap.xml — skipping IndexNow');
    process.exit(0);
  }

  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key, keyLocation, urlList }),
  });

  if (res.ok || res.status === 202) {
    console.log(`✓ IndexNow notified: ${urlList.length} URLs (HTTP ${res.status})`);
  } else {
    console.warn(`⚠ IndexNow returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
} catch (err) {
  console.warn(`⚠ IndexNow notify skipped: ${err.message}`);
}
