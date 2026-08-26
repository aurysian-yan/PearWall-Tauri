import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputPath = path.join(
  desktopRoot,
  "ui/src/generated/openSourceLicenses.json",
);

function runJson(command, args) {
  const output = execFileSync(command, args, {
    cwd: desktopRoot,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(output);
}

function normalizePerson(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  const name = typeof value.name === "string" ? value.name : "";
  const email = typeof value.email === "string" ? ` <${value.email}>` : "";
  return `${name}${email}`.trim() || undefined;
}

function normalizeRepository(value) {
  const raw =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && typeof value.url === "string"
        ? value.url
        : undefined;
  if (!raw) return undefined;
  const normalized = raw
    .replace(/^git\+/, "")
    .replace(/^git:\/\/github\.com\//, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");
  return /^https?:\/\//.test(normalized) ? normalized : undefined;
}

function generateFrontendLicenses() {
  const grouped = runJson("pnpm", ["licenses", "list", "--prod", "--json"]);
  const result = [];

  for (const [license, records] of Object.entries(grouped)) {
    for (const record of records) {
      const versions = Array.isArray(record.versions) ? record.versions : [];
      const paths = Array.isArray(record.paths) ? record.paths : [];
      const count = Math.max(versions.length, paths.length, 1);

      for (let index = 0; index < count; index += 1) {
        const packageDir = paths[index] ?? paths[0];
        const version = versions[index] ?? versions[0] ?? "unknown";
        let packageJson = {};

        if (packageDir) {
          const packageJsonPath = path.join(packageDir, "package.json");
          if (fs.existsSync(packageJsonPath)) {
            packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
          }
        }

        result.push({
          id: `frontend:${record.name}@${version}`,
          name: record.name,
          version,
          license: license || packageJson.license || "Unknown",
          authors: [
            normalizePerson(packageJson.author ?? record.author),
          ].filter(Boolean),
          repository:
            normalizeRepository(packageJson.repository) ??
            normalizeRepository(record.repository) ??
            packageJson.homepage ??
            record.homepage,
        });
      }
    }
  }

  return result.sort(
    (a, b) =>
      a.name.localeCompare(b.name, "en") ||
      a.version.localeCompare(b.version, "en") ||
      a.id.localeCompare(b.id, "en"),
  );
}

const output = {
  schemaVersion: 1,
  frontend: generateFrontendLicenses(),
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`);
console.log(`已生成 ${output.frontend.length} 项前端依赖许可信息。`);
