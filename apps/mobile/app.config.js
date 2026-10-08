// The app's configuration is app.json. This file adds the two things that
// depend on where and how the app is being built, which a plain JSON file
// cannot decide for itself. Expo reads app.json first and hands it in here as
// `config`. (Tools such as `eas init` still write to app.json.)

const fs = require('node:fs');
const path = require('node:path');

module.exports = ({ config }) => {
  // 1. Plain "http://" addresses.
  // Android refuses to talk to a server over plain http unless the app says it
  // may. The test build (the "preview" profile in eas.json) talks to the API
  // running on the office PC over Wi-Fi, which is plain http, so that profile
  // sets ECCS_ALLOW_HTTP=1. The production profile does not, and a real server
  // must be reached over https.
  const allowHttp = process.env.ECCS_ALLOW_HTTP === '1';

  // 2. Firebase's file for push notifications on Android.
  // `google-services.json` is downloaded from the Firebase console and placed
  // beside this file (see docs/APK_BUILD.md). GOOGLE_SERVICES_JSON is for the
  // day it is kept as a secret file at expo.dev instead of in the repository.
  const beside = path.join(__dirname, 'google-services.json');
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? (fs.existsSync(beside) ? './google-services.json' : undefined);

  // Without that file the app builds but can never receive a push, and says
  // nothing about why. Better to stop the cloud build at once with the reason.
  if (process.env.EAS_BUILD_PLATFORM === 'android' && !googleServicesFile) {
    throw new Error(
      'apps/mobile/google-services.json is missing. Download it from the Firebase console and put it in apps/mobile ' +
        '(docs/APK_BUILD.md, step 3), then build again.',
    );
  }

  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile && { googleServicesFile }),
    },
    plugins: [...(config.plugins ?? []), ['expo-build-properties', { android: { usesCleartextTraffic: allowHttp } }]],
  };
};
