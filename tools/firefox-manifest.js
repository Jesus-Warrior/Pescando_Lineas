const fs = require('fs');
const file = process.argv[2];
if (!file) {
  console.error('Usage: node tools/firefox-manifest.js <manifest-output>');
  process.exit(1);
}
const m = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
delete m.minimum_chrome_version;
// Set to true to keep service_worker (Firefox 140+) alongside scripts.
// Set to false to remove service_worker and force event-page (scripts) mode.
const KEEP_SERVICE_WORKER = process.env.FIREFOX_KEEP_SW === '1';
if (!KEEP_SERVICE_WORKER && m.background && m.background.service_worker) {
  delete m.background.service_worker;
  m.background.scripts = ["background.js"]; // <-- Agregado para Firefox
}
m.browser_specific_settings = {
  gecko: {
    id: 'crt-lineas-mx-2026@pescandolineas',
    strict_min_version: '140.0',
    data_collection_permissions: { required: ['none'], optional: [] }
  }
};
fs.writeFileSync(file, JSON.stringify(m, null, 2));
console.log('Wrote', file);
