export function inferProviderKey(provider, model, url) {
  const p = (provider || "").toLowerCase().trim();
  if (p) return p;
  const m = (model || "").toLowerCase();
  if (m.includes("claude") || m.includes("anthropic")) return "anthropic";
  if (m.includes("gpt") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) return "openai";
  if (m.includes("gemini")) return "google";
  if (m.includes("deepseek")) return "deepseek";
  if (m.includes("mistral")) return "mistral";
  if (m.includes("grok")) return "xai";
  if (m.includes("llama")) return "meta";
  const u = (url || "").toLowerCase();
  if (u.includes("anthropic")) return "anthropic";
  if (u.includes("openai")) return "openai";
  if (u.includes("generativelanguage") || u.includes("googleapis")) return "google";
  if (u.includes("deepseek")) return "deepseek";
  if (u.includes("openrouter")) return "openrouter";
  if (u.includes("groq")) return "groq";
  if (u.includes("bedrock") || u.includes("amazonaws")) return "bedrock";
  if (u.includes("azure")) return "azure";
  return "";
}

export function providerChip(provider, model, url) {
  const label = provider || inferProviderKey(provider, model, url) || "?";
  const wrap = document.createElement("span");
  wrap.className = "provider-chip";
  wrap.append(document.createTextNode(label));
  if (model) {
    const m = document.createElement("span");
    m.className = "pmodel";
    m.title = model;
    m.textContent = model;
    wrap.append(m);
  }
  return wrap;
}
