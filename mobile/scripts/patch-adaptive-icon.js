/**
 * Patches Android adaptive icon XML to add an 18dp inset around the foreground.
 * This prevents the icon from appearing "too big" on the device (only the center
 * 72×72 dp is visible in the mask; without inset the full-bleed foreground scales too large).
 *
 * Run after `expo prebuild` (e.g. `expo prebuild && node scripts/patch-adaptive-icon.js`).
 */

const fs = require('fs');
const path = require('path');

const INSET_DP = 18;
const PROJECT_ROOT = path.resolve(__dirname, '..');
const RES = path.join(PROJECT_ROOT, 'android', 'app', 'src', 'main', 'res');
const DRAWABLE_DIR = path.join(RES, 'drawable');
const MIPMAP_V26 = path.join(RES, 'mipmap-anydpi-v26');

const FOREGROUND_INSET_XML = `<?xml version="1.0" encoding="utf-8"?>
<inset xmlns:android="http://schemas.android.com/apk/res/android"
    android:inset="${INSET_DP}dp"
    android:drawable="@mipmap/ic_launcher_foreground" />
`;

const ADAPTIVE_ICON_FOREGROUND_REF = '@drawable/ic_launcher_foreground_inset';

function main() {
  if (!fs.existsSync(RES)) {
    console.warn('patch-adaptive-icon: android res folder not found, skipping (run after expo prebuild).');
    process.exit(0);
    return;
  }

  if (!fs.existsSync(path.join(MIPMAP_V26, 'ic_launcher.xml'))) {
    console.warn('patch-adaptive-icon: ic_launcher.xml not found, skipping.');
    process.exit(0);
    return;
  }

  if (!fs.existsSync(DRAWABLE_DIR)) {
    fs.mkdirSync(DRAWABLE_DIR, { recursive: true });
  }

  const insetPath = path.join(DRAWABLE_DIR, 'ic_launcher_foreground_inset.xml');
  fs.writeFileSync(insetPath, FOREGROUND_INSET_XML, 'utf8');
  console.log('patch-adaptive-icon: wrote', path.relative(PROJECT_ROOT, insetPath));

  for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    const filePath = path.join(MIPMAP_V26, name);
    let xml = fs.readFileSync(filePath, 'utf8');
    xml = xml.replace(
      /<foreground android:drawable="@mipmap\/ic_launcher_foreground"\/>/,
      `<foreground android:drawable="${ADAPTIVE_ICON_FOREGROUND_REF}"/>`
    );
    fs.writeFileSync(filePath, xml, 'utf8');
    console.log('patch-adaptive-icon: patched', path.relative(PROJECT_ROOT, filePath));
  }

  console.log('patch-adaptive-icon: done.');
}

main();
