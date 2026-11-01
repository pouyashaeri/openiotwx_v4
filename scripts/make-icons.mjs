#!/usr/bin/env node
/**
 * Render the site icons from public/favicon.svg:
 *   public/favicon-32.png        32x32, for browsers that ignore SVG icons
 *   public/apple-touch-icon.png  180x180, full square (iOS rounds the corners itself)
 *   public/favicon.ico           16 and 32 px, for anything that still asks for /favicon.ico
 *
 *   node scripts/make-icons.mjs
 *
 * It uses the browser Playwright already has (set PW_CHANNEL=msedge or chrome if needed).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const svg = readFileSync("public/favicon.svg", "utf8");
const square = svg.replace(' rx="14"', ""); // the apple icon is a full square

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function render(markup, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`);
  return page.screenshot({ type: "png", omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

const png32 = await render(svg, 32);
const png16 = await render(svg, 16);
writeFileSync("public/favicon-32.png", png32);
writeFileSync("public/apple-touch-icon.png", await render(square, 180));
await browser.close();

// An .ico is a small directory of images; PNG data is allowed inside it.
function ico(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const dirs = images.map(({ size, data }) => {
    const d = Buffer.alloc(16);
    d.writeUInt8(size, 0);
    d.writeUInt8(size, 1);
    d.writeUInt16LE(1, 4); // colour planes
    d.writeUInt16LE(32, 6); // bits per pixel
    d.writeUInt32LE(data.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += data.length;
    return d;
  });
  return Buffer.concat([head, ...dirs, ...images.map((i) => i.data)]);
}
writeFileSync("public/favicon.ico", ico([{ size: 16, data: png16 }, { size: 32, data: png32 }]));
console.log("wrote public/favicon-32.png, public/apple-touch-icon.png, public/favicon.ico");
