import { prisma } from "../prisma.js";

let cache: Map<string, string> | null = null;

async function load(): Promise<Map<string, string>> {
  if (cache) return cache;
  const rows = await prisma.appSetting.findMany();
  cache = new Map(rows.map((r) => [r.key, r.value]));
  return cache;
}

export function clearSettingsCache() {
  cache = null;
}

export async function getSetting(key: string): Promise<string | undefined> {
  return (await load()).get(key);
}

export async function getAllSettings(): Promise<Record<string, string>> {
  return Object.fromEntries(await load());
}

export async function setSettings(
  record: Record<string, string | undefined>
): Promise<void> {
  const entries = Object.entries(record).filter(
    ([, v]) => v !== undefined
  ) as [string, string][];
  for (const [key, value] of entries) {
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
  clearSettingsCache();
}
