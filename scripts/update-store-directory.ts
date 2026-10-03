import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStoreDirectory } from "../src/directory.ts";

const url = "https://family.map.com.tw/famiport/api/dropdownlist/Select_StoreName";
const output = fileURLToPath(new URL("../public/store-directory.json", import.meta.url));

async function updateDirectory() {
  await rm(output, { force: true });
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ store: "" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`官方店舖目錄 HTTP ${response.status}；停止發布。`);
  const payload: unknown = await response.json();
  const directory = buildStoreDirectory(payload, new Date().toISOString());

  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(directory)}\n`, "utf8");
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(
    `店舖目錄快照：${directory.stores.length} 間，${directory.unlocatedCount} 筆座標異常，更新於 ${directory.updatedAt}`,
  );
}

updateDirectory().catch((error: unknown) => {
  console.error("無法驗證並產生官方店舖目錄快照；保留前一次 Pages 部署：", error);
  process.exitCode = 1;
});
