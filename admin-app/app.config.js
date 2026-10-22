// Resolves config values that must not live in version control.
//
// Locally: `app.local.json` (gitignored) supplies private values such as
// notifyUrl, and google-services.json sits next to this file.
//
// On EAS Build: only git-tracked files are uploaded, so both come from EAS
// environment variables instead:
//   GOOGLE_SERVICES_JSON  (type: file)    -> android.googleServicesFile
//   NOTIFY_URL            (type: string)  -> extra.notifyUrl
//
// When neither is present the app still builds: notifyUrl falls back to '' and
// push/email become a graceful no-op.
let localExtra = {};
try {
  localExtra = require('./app.local.json');
} catch {
  // no local overrides present
}

module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON ?? config.android?.googleServicesFile,
  },
  extra: {
    ...config.extra,
    ...localExtra,
    ...(process.env.NOTIFY_URL ? { notifyUrl: process.env.NOTIFY_URL } : {}),
  },
});
