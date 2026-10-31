# Capacitor / Android

## App identity (change before release)

Edit `capacitor.config.json`:

- `appId` — currently `com.hrms.app` (temporary). Replace with your Play Store ID, e.g. `com.yourcompany.hrms`.
- `appName` — display name (`HRMS`).

After changing `appId`, run:

```bash
npm run build
npx cap sync android
```

Then clean/rebuild the Android project in Android Studio (or Gradle).

## Production API

`VITE_API_BASE_URL` is set in `.env.production` and baked into the JS bundle at build time. It points at the existing Vercel API. No secrets belong in that file.

## Bundle model

The APK loads the Vite `dist/` assets copied into the native project (`npx cap sync`). It does **not** load the Vercel website URL in a WebView.

## Generate a debug APK

From `mobile/`:

```bash
npm run build:android
```

Then either:

**Terminal (Windows):**

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
cd android
.\gradlew.bat assembleDebug
```

APK path:

`android/app/build/outputs/apk/debug/app-debug.apk`

**Android Studio:**

1. `npx cap open android`
2. Wait for Gradle sync
3. **Build → Build Bundle(s) / APK(s) → Build APK(s)**
4. Install on a device/emulator and confirm login against the production API

## Release checklist

1. Change `appId` in `capacitor.config.json` (and re-sync).
2. Confirm `.env.production` API URL.
3. Build a signed release APK/AAB in Android Studio (not covered by the debug flow above).
