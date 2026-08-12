import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

function javaMajor(javaExecutable) {
  const result = spawnSync(javaExecutable, ["-version"], { encoding: "utf8", windowsHide: true });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const match = output.match(/version\s+"(\d+)(?:\.(\d+))?/i);
  if (!match) return 0;
  return Number(match[1]) === 1 ? Number(match[2]) : Number(match[1]);
}

function javaInHome(home) {
  if (!home) return null;
  const executable = join(home, "bin", process.platform === "win32" ? "java.exe" : "java");
  return existsSync(executable) && javaMajor(executable) >= 21 ? { home, executable } : null;
}

function homesInside(root) {
  if (!root || !existsSync(root)) return [];
  const direct = javaInHome(root);
  if (direct) return [direct];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => javaInHome(join(root, entry.name)))
    .filter(Boolean);
}

function findJava() {
  const configured = javaInHome(process.env.JAVA_HOME);
  if (configured) return configured;

  if (javaMajor("java") >= 21) return { home: null, executable: "java" };

  const roots = process.platform === "win32"
    ? [
        "C:\\tmp\\pixel-rally-temurin21-jre",
        "C:\\Program Files\\Eclipse Adoptium",
        "C:\\Program Files\\Java",
        "C:\\Program Files\\Microsoft",
      ]
    : ["/tmp/pixel-rally-temurin21-jre", "/usr/lib/jvm"];

  for (const root of roots) {
    const found = homesInside(root)[0];
    if (found) return found;
  }
  return null;
}

const java = findJava();
if (!java) {
  console.error("Firebase Emulator SuiteにはJava 21以上が必要です。");
  console.error("Java 21をインストールするか、JAVA_HOMEをJava 21のフォルダーへ設定してください。");
  process.exit(1);
}

const firebaseCli = resolve("node_modules", "firebase-tools", "lib", "bin", "firebase.js");
if (!existsSync(firebaseCli)) {
  console.error("Firebase CLIがありません。先に npm install を実行してください。");
  process.exit(1);
}

const environment = {
  ...process.env,
  FUNCTIONS_DISCOVERY_TIMEOUT: process.env.FUNCTIONS_DISCOVERY_TIMEOUT || "60",
};
if (java.home) {
  environment.JAVA_HOME = java.home;
  environment.PATH = `${join(java.home, "bin")}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`;
}

console.log(`Using Java ${javaMajor(java.executable)}: ${java.executable}`);
const child = spawn(
  process.execPath,
  [firebaseCli, "emulators:start", ...process.argv.slice(2)],
  { cwd: process.cwd(), env: environment, stdio: "inherit", windowsHide: true },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
