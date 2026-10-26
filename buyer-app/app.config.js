// Dynamic Expo config.
//
// The committed app.json holds brand-NEUTRAL defaults (name "Buyer", bundled icons) so the
// real shop identity never lands in the repo. This file layers an OPTIONAL, git-ignored
// local brand override on top — applied only on the build machine:
//
//   • Name  → brand.local.json : { "name": "Rajendran Fruits & Flowers" }
//   • Icons → drop files into assets/brand.local/ (auto-detected, optional):
//        icon.png                 (app icon / iOS / legacy launcher)
//        adaptive-foreground.png  (Android adaptive icon foreground)
//        adaptive-background.png  (Android adaptive icon background, optional)
//
// Both brand.local.json and assets/brand.local/ are git-ignored (see .gitignore). When they
// are absent (CI, other clones), the app builds with the neutral app.json defaults.
//
// Icon/name changes are baked at `expo prebuild` time, so re-run prebuild + build to apply.
const fs = require('fs');
const path = require('path');

/** Return the relative path if the asset exists locally, else null. */
function localAsset(rel) {
  return fs.existsSync(path.join(__dirname, rel)) ? rel : null;
}

module.exports = ({ config }) => {
  let brand = {};
  try {
    brand = require('./brand.local.json');
  } catch {
    // No local brand file — keep the committed neutral defaults from app.json.
  }

  if (brand.name) config.name = brand.name;

  const icon = localAsset('./assets/brand.local/icon.png');
  if (icon) config.icon = icon;

  const foreground = localAsset('./assets/brand.local/adaptive-foreground.png');
  const background = localAsset('./assets/brand.local/adaptive-background.png');
  if (foreground) {
    config.android = config.android || {};
    // Replace the adaptive icon wholesale so the neutral default background/monochrome
    // images don't bleed through. The foreground logo is pre-padded into the safe zone,
    // and sits on the brand green (or a provided brand background image).
    config.android.adaptiveIcon = background
      ? { foregroundImage: foreground, backgroundImage: background }
      : { foregroundImage: foreground, backgroundColor: '#2E7D32' };
  }

  return config;
};
