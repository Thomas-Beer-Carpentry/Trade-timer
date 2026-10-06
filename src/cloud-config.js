export const CLOUD_CONFIG_KEY = "trade-timer:cloud-config";
export function validateCloudConfig(config) {
  const url = new URL(config.url);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".supabase.co") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  )
    throw new Error(
      "Use your HTTPS Supabase Project URL, ending in .supabase.co.",
    );
  const key = String(config.key || "").trim();
  if (!key.startsWith("sb_publishable_")) {
    let role;
    try {
      role = JSON.parse(
        atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
      ).role;
    } catch {
      /* Invalid public key. */
    }
    if (role !== "anon")
      throw new Error(
        "Use a publishable key or legacy anon key. Never use a secret or service_role key in this app.",
      );
  }
  if (key.length < 30)
    throw new Error("Enter the complete public publishable key.");
  return { url: url.origin, key };
}
export function readCloudConfig(storage, env = {}) {
  const saved = storage.getItem(CLOUD_CONFIG_KEY);
  if (saved) return validateCloudConfig(JSON.parse(saved));
  if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY)
    return validateCloudConfig({
      url: env.VITE_SUPABASE_URL,
      key: env.VITE_SUPABASE_PUBLISHABLE_KEY,
    });
  return null;
}
