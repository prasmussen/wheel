import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Render code-native artwork with the wheel's enamel palette; no remote assets.
const palette = ['#f54d40', '#fa9e26', '#2bbb99', '#2b8ceb', '#7a57e8', '#e04594', '#57c252', '#1aadca'];
const sectors = palette.map((color, index) => {
  const a = index * Math.PI / 4, b = (index + 1) * Math.PI / 4;
  return `<path d="M128 128 L${128 + Math.cos(a) * 104} ${128 + Math.sin(a) * 104} A104 104 0 0 1 ${128 + Math.cos(b) * 104} ${128 + Math.sin(b) * 104}Z" fill="${color}" stroke="#151c2b" stroke-width="1.5"/>`;
}).join('');
const wheel = `<circle cx="128" cy="128" r="116" fill="#111827" stroke="#8590a4" stroke-width="3"/>${sectors}<circle cx="128" cy="128" r="17" fill="#131b2a" stroke="#b9c4d4" stroke-width="4"/><path d="M117 8H139L128 36Z" fill="#eff3fa" stroke="#131b2a" stroke-width="2"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="54" fill="#080b12"/>${wheel}</svg>`;
await mkdir('public', { recursive: true });
await writeFile('public/favicon.svg', svg + '\n');
await writeFile('public/site.webmanifest', JSON.stringify({
  id: '/', name: 'Mechanical Wheel – Spin the Wheel', short_name: 'Mechanical Wheel',
  description: 'A free custom spinning wheel for names, meals, games, and everyday decisions.',
  lang: 'en', start_url: '/', scope: '/', display: 'browser',
  background_color: '#080b12', theme_color: '#080b12',
  icons: [192, 512].map(size => ({ src: `/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })),
}, null, 2) + '\n');
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [size, file] of [[48, 'favicon-48'], [180, 'apple-touch-icon'], [192, 'icon-192'], [512, 'icon-512']]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    await page.screenshot({ path: `public/${file}.png`, omitBackground: true });
  }
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(`<!doctype html><html lang="en"><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:radial-gradient(ellipse at 80% 50%,#202c49,#080b12 65%);color:#f1f4fb;font-family:Arial,sans-serif;display:flex;align-items:center;padding:64px;gap:42px}
    .copy{width:590px;flex:none}.brand{font-size:18px;letter-spacing:5px;color:#adb9cf;font-weight:600;margin-bottom:44px}h1{font-size:76px;line-height:1.04;letter-spacing:-4px;margin:0 0 24px;font-weight:700}p{font-size:24px;line-height:1.45;color:#b8c3d6;max-width:470px;margin:0}.pill{margin-top:36px;display:inline-block;padding:12px 20px;border:1px solid #48556b;border-radius:999px;color:#f8cb78;font-size:16px;letter-spacing:1px}.wheel{width:430px;flex:none;filter:drop-shadow(0 20px 30px #0008)}
    </style><body><div class="copy"><div class="brand">MECHANICAL WHEEL</div><h1>Give your choices<br>a spin.</h1><p>Your names. Your options.<br>One satisfying way to decide.</p><div class="pill">FREE • CUSTOMIZABLE • SHAREABLE</div></div><svg class="wheel" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${wheel}</svg></body></html>`);
  await page.screenshot({ path: 'public/social-preview.png' });
} finally {
  await browser.close();
}
console.log('Generated favicon, home-screen icons, manifest, and 1200×630 social preview.');
