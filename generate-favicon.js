const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const svgData = fs.readFileSync(path.join(__dirname, 'public/favicon.svg'), 'utf8');

// Generate 32x32 PNG (standard favicon)
const resvg32 = new Resvg(svgData, { fitTo: { mode: 'width', value: 32 } });
const png32 = resvg32.render().asPng();
fs.writeFileSync(path.join(__dirname, 'public/favicon-32.png'), png32);

// Generate 192x192 PNG (high-res / app icon)
const resvg192 = new Resvg(svgData, { fitTo: { mode: 'width', value: 192 } });
const png192 = resvg192.render().asPng();
fs.writeFileSync(path.join(__dirname, 'public/favicon-192.png'), png192);

// Generate 180x180 PNG (Apple touch icon)
const resvg180 = new Resvg(svgData, { fitTo: { mode: 'width', value: 180 } });
const png180 = resvg180.render().asPng();
fs.writeFileSync(path.join(__dirname, 'public/apple-touch-icon.png'), png180);

// Overwrite the main favicon.png at 64x64
const resvg64 = new Resvg(svgData, { fitTo: { mode: 'width', value: 64 } });
const png64 = resvg64.render().asPng();
fs.writeFileSync(path.join(__dirname, 'public/favicon.png'), png64);

console.log('Favicons generated: favicon.png (64), favicon-32.png (32), favicon-192.png (192), apple-touch-icon.png (180)');
