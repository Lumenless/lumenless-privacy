# Android release build (signed APK)

Stores (Google Play, Solana Mobile dApp Store, etc.) reject APKs signed with the debug keystore. You need a release keystore.

## 1. Create a release keystore

```bash
cd mobile
keytool -genkeypair -v -storetype PKCS12 -keystore lumenless-release.keystore \
  -alias lumenless -keyalg RSA -keysize 2048 -validity 10000
```

Store the keystore in `android/app/` (after prebuild) or another path you’ll reference in Gradle.

## 2. Configure signing

Create or edit `~/.gradle/gradle.properties` (recommended, not committed) or `android/gradle.properties`:

```properties
LUMENLESS_UPLOAD_STORE_FILE=lumenless-release.keystore
LUMENLESS_UPLOAD_KEY_ALIAS=lumenless
LUMENLESS_UPLOAD_STORE_PASSWORD=your_store_password
LUMENLESS_UPLOAD_KEY_PASSWORD=your_key_password
```

- If you use `~/.gradle/gradle.properties`, `LUMENLESS_UPLOAD_STORE_FILE` must be an **absolute path** to the keystore (e.g. `/Users/you/projects/lumenless-privacy/mobile/android/app/lumenless-release.keystore`), or a path relative to `android/app/`.
- If you use `android/gradle.properties`, put the keystore in `android/app/` and use a filename like `lumenless-release.keystore`.

**Important:** Do not commit keystore files or passwords.

## 3. Build

```bash
cd mobile
npm run prebuild
# Copy keystore to android/app/ if it’s not there yet
cd android
./gradlew assembleRelease
```

The signed APK is at `android/app/build/outputs/apk/release/app-release.apk`.
