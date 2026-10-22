// Merges optional local-only overrides into the Expo config.
//
// `app.local.json` is gitignored and holds private values (e.g. notifyUrl) that
// must not be committed. When it is absent the app still builds — notifyUrl
// falls back to '' and push/email become a graceful no-op.
//
// Copy app.local.example.json -> app.local.json and fill it in.
let localExtra = {};
try {
  localExtra = require('./app.local.json');
} catch {
  // no local overrides present
}

module.exports = ({ config }) => ({
  ...config,
  extra: { ...config.extra, ...localExtra },
});
