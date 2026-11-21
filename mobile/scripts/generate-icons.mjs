import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const root = new URL("../assets/", import.meta.url);
await mkdir(root, { recursive: true });

const envelope = (color = "#FFFFFF") => `
  <path d="M2.6 6.4 12 12.8l9.4-6.4" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M2.5 7.1v9.4c0 1.1.9 2 2 2h15c1.1 0 2-.9 2-2V7.1c0-1.4-1.6-2.2-2.7-1.4L12 10.5 5.2 5.7C4.1 4.9 2.5 5.7 2.5 7.1Z" fill="${color}" fill-opacity=".96"/>
`;

const mark = (size = 560, x = 232, y = 232) => `
  <g transform="translate(${x} ${y})">
    <rect width="${size}" height="${size}" rx="168" fill="url(#g)"/>
    <g transform="translate(${size * 0.18} ${size * 0.18}) scale(${size * 0.64 / 24})">
      ${envelope("#FFFFFF")}
    </g>
    <rect x="0" y="0" width="${size}" height="${size * 0.2}" rx="168" fill="#FFFFFF" fill-opacity=".08"/>
  </g>
`;

const backdrop = `
  <rect width="1024" height="1024" fill="#08090D"/>
  <circle cx="800" cy="180" r="380" fill="#8A78FF" fill-opacity=".22"/>
  <circle cx="180" cy="880" r="300" fill="#FF5E8E" fill-opacity=".10"/>
`;

const svg = (content) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#B6A8FF"/>
      <stop offset=".5" stop-color="#8A78FF"/>
      <stop offset="1" stop-color="#5B3DE0"/>
    </linearGradient>
  </defs>
  ${content}
</svg>`;

await sharp(Buffer.from(svg(`${backdrop}${mark()}`))).png().toFile(new URL("icon.png", root).pathname);
await sharp(Buffer.from(svg(backdrop))).png().toFile(new URL("android-icon-background.png", root).pathname);
await sharp(Buffer.from(svg(mark(620, 202, 202)))).png().toFile(new URL("android-icon-foreground.png", root).pathname);
await sharp(
  Buffer.from(
    svg(`<g transform="translate(232 232)"><g transform="translate(100 100) scale(15)">${envelope("#FFFFFF")}</g></g>`),
  ),
)
  .png()
  .toFile(new URL("android-icon-monochrome.png", root).pathname);

const splash = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#B6A8FF"/><stop offset=".5" stop-color="#8A78FF"/><stop offset="1" stop-color="#5B3DE0"/>
  </linearGradient></defs>
  <g transform="translate(56 56)">
    <rect width="400" height="400" rx="120" fill="url(#g)"/>
    <g transform="translate(72 72) scale(10.6667)">${envelope("#FFFFFF")}</g>
  </g>
</svg>`;
await sharp(Buffer.from(splash)).png().toFile(new URL("splash-icon.png", root).pathname);
await sharp(Buffer.from(svg(`${backdrop}${mark()}`))).resize(64, 64).png().toFile(new URL("favicon.png", root).pathname);

console.log("icons generated");
