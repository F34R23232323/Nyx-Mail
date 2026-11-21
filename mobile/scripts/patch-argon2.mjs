/**
 * Adds the namespace required by AGP 8+ to react-native-argon2's Android
 * library, and replaces the deprecated jcenter repository.
 *
 * The package itself is unmaintained at the Gradle level but its native Argon2
 * binding (argon2kt) is correct and dramatically faster than pure JS on device.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const file = path.resolve(import.meta.dirname, "../node_modules/react-native-argon2/android/build.gradle");
if (!existsSync(file)) {
  console.log("react-native-argon2 not installed; skipping native patch");
  process.exit(0);
}
let gradle = readFileSync(file, "utf8");
if (!gradle.includes("namespace")) {
  gradle = gradle.replace(
    "android {",
    "android {\n    namespace 'com.poowf.argon2'",
  );
}
gradle = gradle.replace(/buildscript \{[\s\S]*?\n\}\n\n/, "");
gradle = gradle.replace(/jcenter\(\)/g, "mavenCentral()");
gradle = gradle.replace(
  /compileSdkVersion safeExtGet\('compileSdkVersion', \d+\)/,
  "compileSdkVersion safeExtGet('compileSdkVersion', 36)",
);
gradle = gradle.replace(
  /targetSdkVersion safeExtGet\('targetSdkVersion', \d+\)/,
  "targetSdkVersion safeExtGet('targetSdkVersion', 36)",
);
writeFileSync(file, gradle);

const manifest = path.resolve(
  import.meta.dirname,
  "../node_modules/react-native-argon2/android/src/main/AndroidManifest.xml",
);
if (existsSync(manifest)) {
  const xml = readFileSync(manifest, "utf8").replace(/\spackage="com\.poowf\.argon2"/, "");
  writeFileSync(manifest, xml);
}
console.log("react-native-argon2 Android library patched");
