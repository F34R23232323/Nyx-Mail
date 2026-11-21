/**
 * Applies the native Android customisations that Expo prebuild does not own:
 *  - release signing from credentials/keystore.properties
 *  - TLS-only network security config (local emulator loopback excepted)
 *  - arm64 + armeabi-v7a + x86_64 APK ABIs
 *
 * Safe to run repeatedly. Run after `npx expo prebuild`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const android = path.join(root, "android");
if (!existsSync(android)) {
  console.error("android/ not found. Run `npx expo prebuild --platform android` first.");
  process.exit(1);
}

const manifestPath = path.join(android, "app/src/main/AndroidManifest.xml");
const buildGradlePath = path.join(android, "app/build.gradle");
const gradlePropsPath = path.join(android, "gradle.properties");
const xmlDir = path.join(android, "app/src/main/res/xml");
const networkConfigPath = path.join(xmlDir, "network_security_config.xml");

// --- Manifest ---------------------------------------------------------------
const manifest = readFileSync(manifestPath, "utf8");
if (!manifest.includes("networkSecurityConfig")) {
  writeFileSync(
    manifestPath,
    manifest.replace(
      "<application ",
      '<application android:networkSecurityConfig="@xml/network_security_config" ',
    ),
  );
  console.log("manifest: network security config linked");
}

// --- Network security config ------------------------------------------------
mkdirSync(xmlDir, { recursive: true });
writeFileSync(
  networkConfigPath,
  `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- TLS is mandatory. Cleartext is limited to local development hosts. -->
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">10.0.2.2</domain>
        <domain includeSubdomains="false">10.0.3.2</domain>
        <domain includeSubdomains="false">localhost</domain>
        <domain includeSubdomains="false">127.0.0.1</domain>
    </domain-config>
</network-security-config>
`,
);
console.log("network security config written");

// --- Gradle signing ---------------------------------------------------------
let gradle = readFileSync(buildGradlePath, "utf8");
if (!gradle.includes("keystore.properties")) {
  gradle = gradle.replace(
    /    signingConfigs \{\n        debug \{[\s\S]*?\n        \}\n    \}/,
    `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            def keystorePropertiesFile = rootProject.file("../credentials/keystore.properties")
            if (keystorePropertiesFile.exists()) {
                def keystoreProperties = new Properties()
                keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
                storeFile rootProject.file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }`,
  );
  gradle = gradle.replace(
    /        release \{\n            \/\/ Caution![\s\S]*?signingConfig signingConfigs\.debug/,
    `        release {
            // Uses credentials/keystore.properties when present, otherwise the
            // local debug key for an unsigned demo build.
            signingConfig signingConfigs.release.storeFile != null
                ? signingConfigs.release
                : signingConfigs.debug`,
  );
  writeFileSync(buildGradlePath, gradle);
  console.log("gradle: release signing configured");
}

// --- ABIs -------------------------------------------------------------------
let props = readFileSync(gradlePropsPath, "utf8");
props = props.replace(
  /^reactNativeArchitectures=.*$/m,
  "reactNativeArchitectures=arm64-v8a,armeabi-v7a,x86_64",
);
writeFileSync(gradlePropsPath, props);

// --- SDK path ---------------------------------------------------------------
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(homedir(), "android-sdk");
writeFileSync(path.join(android, "local.properties"), `sdk.dir=${sdk}\n`);
console.log(`local.properties: sdk.dir=${sdk}`);
console.log("android project patched");
