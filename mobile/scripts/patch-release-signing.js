/**
 * Patches Android build.gradle to use a release keystore for release builds.
 * Without this, release builds are signed with the debug keystore and stores reject them.
 *
 * Before building:
 * 1. Generate a keystore:
 *    keytool -genkeypair -v -storetype PKCS12 -keystore android/app/lumenless-release.keystore \
 *      -alias lumenless -keyalg RSA -keysize 2048 -validity 10000
 *
 * 2. Add to android/gradle.properties (or ~/.gradle/gradle.properties, do NOT commit):
 *    LUMENLESS_UPLOAD_STORE_FILE=lumenless-release.keystore
 *    LUMENLESS_UPLOAD_KEY_ALIAS=lumenless
 *    LUMENLESS_UPLOAD_STORE_PASSWORD=your_store_password
 *    LUMENLESS_UPLOAD_KEY_PASSWORD=your_key_password
 *
 * Run after expo prebuild.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const BUILD_GRADLE = path.join(PROJECT_ROOT, 'android', 'app', 'build.gradle');

const SIGNING_CONFIGS = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            if (project.hasProperty('LUMENLESS_UPLOAD_STORE_FILE')) {
                storeFile file(project.property('LUMENLESS_UPLOAD_STORE_FILE'))
                storePassword project.property('LUMENLESS_UPLOAD_STORE_PASSWORD')
                keyAlias project.property('LUMENLESS_UPLOAD_KEY_ALIAS')
                keyPassword project.property('LUMENLESS_UPLOAD_KEY_PASSWORD')
            }
        }
    }`;

const RELEASE_SIGNING_LINE =
    '            signingConfig project.hasProperty(\'LUMENLESS_UPLOAD_STORE_FILE\') ? signingConfigs.release : signingConfigs.debug';

function main() {
  if (!fs.existsSync(BUILD_GRADLE)) {
    console.warn('patch-release-signing: android/app/build.gradle not found, skipping (run after expo prebuild).');
    process.exit(0);
    return;
  }

  let content = fs.readFileSync(BUILD_GRADLE, 'utf8');

  // Already patched
  if (content.includes('LUMENLESS_UPLOAD_STORE_FILE')) {
    console.log('patch-release-signing: already patched, skipping.');
    process.exit(0);
    return;
  }

  // Match signingConfigs { debug { ... } } with flexible whitespace
  const signingConfigsRegex = /(    signingConfigs \{\s*debug \{[^}]*storeFile file\('debug\.keystore'\)[^}]*\}\s*\})/s;
  const match = content.match(signingConfigsRegex);
  if (!match) {
    console.warn('patch-release-signing: signingConfigs block not found, skipping.');
    process.exit(0);
    return;
  }

  content = content.replace(match[1], SIGNING_CONFIGS);

  // Match release block's signingConfig line (capture full next line)
  const releaseSigningRegex = /(            )signingConfig signingConfigs\.debug(\n            def enableShrinkResources[^\n]*)/;
  if (!releaseSigningRegex.test(content)) {
    console.warn('patch-release-signing: release signingConfig line not found, skipping.');
    process.exit(0);
    return;
  }
  content = content.replace(
    releaseSigningRegex,
    `$1${RELEASE_SIGNING_LINE.trim()}$2`
  );

  fs.writeFileSync(BUILD_GRADLE, content, 'utf8');
  console.log('patch-release-signing: patched android/app/build.gradle for release signing.');
  console.log('patch-release-signing: Add LUMENLESS_UPLOAD_* to gradle.properties to sign release builds.');
}

main();
