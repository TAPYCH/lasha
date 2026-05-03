/**
 * Вытаскивает массивы fallbackTours и fallbackHotels из index.html и пишет JSON в server/data/.
 * Запуск: node scripts/extract-seed.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'index.html');

function extractArrayLiteral(html, constName) {
  const anchor = `const ${constName} = `;
  const a = html.indexOf(anchor);
  if (a < 0) throw new Error(`Не найдено: ${constName}`);
  let i = html.indexOf('[', a);
  if (i < 0) throw new Error(`Нет '[' для ${constName}`);

  let depth = 0;
  let inStr = false;
  let strQuote = '';

  for (; i < html.length; i++) {
    const c = html[i];

    if (inStr) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === strQuote) inStr = false;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      inStr = true;
      strQuote = c;
      continue;
    }

    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        const start = html.indexOf('[', html.indexOf(anchor));
        return html.slice(start, i + 1);
      }
    }
  }

  throw new Error(`Не закрыт массив ${constName}`);
}

function main() {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const toursLit = extractArrayLiteral(html, 'fallbackTours');
  const hotelsLit = extractArrayLiteral(html, 'fallbackHotels');
  const tours = eval(`(${toursLit})`);
  const hotels = eval(`(${hotelsLit})`);

  const dir = path.join(root, 'server', 'data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tours.json'), JSON.stringify(tours, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'hotels.json'), JSON.stringify(hotels, null, 2), 'utf8');
  console.log(`Seed OK: ${tours.length} экскурсий, ${hotels.length} отелей → server/data/`);
}

main();
