require("dotenv").config();

/**
 * Summarize using OpenAI Chat Completions.
 * - Uses only headline + URL (no invented details).
 * - OUTPUT DOES NOT INCLUDE FULL URL anywhere.
 * - Exactly ONE final line: "Source: <domain>"
 */
async function summarizeWithOpenAI({ title, url }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY in environment");

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  // Derive clean source domain like "theverge.com"
  let sourceDomain = "unknown";
  try {
    const u = new URL(url);
    sourceDomain = (u.hostname || "unknown").replace(/^www\./, "");
  } catch (_) {}

  const prompt = `
You write for an ironic negative-news portal called "fearporn.world".

IMPORTANT: You only know the HEADLINE and LINK. Do NOT invent details, numbers, locations, motives, quotes, or identities not present in the headline.
If the headline is vague, speak in general terms and say what is *unclear*.

CRITICAL OUTPUT RULE:
- DO NOT print the full URL anywhere in the output.
- DO NOT print "http", "https", or any long link text.
- Only print the source domain (example: "theverge.com") on the final line.

STYLE (very important):
- Write like a sharp tabloid columnist, not a neutral reporter.
- Avoid explanatory or academic language.
- Short sentences. Fragments are fine.
- Imply more than you explain.
- Mock institutions, PR language, incentives, and hypocrisy.
- Do NOT moralize or lecture.
- Do NOT sound balanced or careful.
- If something is absurd, let the absurdity stand without explaining it.
- Think: raised eyebrow, dry sarcasm, "sure, this will end well".
- If it sounds like a policy brief, rewrite it.

OUTPUT FORMAT (exact):
1) One-line strapline (max 12 words) and start it with 1 emoji.
2) One short paragraph (3–5 sentences) written as a reaction, not a summary.
3) Closing line: one short sarcastic sentence that ends with "What could possibly go wrong?"
   - include exactly 1 emoji in the closing line
4) Final line: Source: ${sourceDomain}

EMOJI RULES (important):
- Use 3 to 5 emojis total.
- Emojis should be expressive and emotionally informative, not decorative.
- Prefer emojis that signal danger, escalation, instability, absurdity, or tension.
- Typical good choices: 😬 🔥 🧨 ⚠️ 🌍 💥 📉 📈 🏛️ 🕵️ 🧠 🧯 🧊 🌀
- It is okay to use slightly ironic or uneasy emojis (😬, 🤷‍♂️, 🙃) if appropriate.
- Do NOT use emojis that celebrate harm, mock victims, or target protected groups.
- If unsure, default to tension/danger emojis rather than playful ones.

If the paragraph sounds like generic AI journalism, rewrite it to be sharper, shorter, and more opinionated.

Headline: ${title}
Source domain to print: ${sourceDomain}
`.trim();

  async function callOpenAI(userPrompt, { temperature = 0.6, max_tokens = 280 } = {}) {
    const controller = new AbortController();
    const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 30000);
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: userPrompt }],
          temperature,
          max_tokens,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`OpenAI error ${res.status}: ${txt || res.statusText}`);
      }

      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() || "";
    } finally {
      clearTimeout(t);
    }
  }

  let out = await callOpenAI(prompt, { temperature: 0.6, max_tokens: 280 });

  /**
   * HARD GUARANTEE:
   * - Remove ALL Source lines the model may have added
   * - Remove ALL URLs just in case
   * - Append exactly ONE final Source line
   */
  function normalizeSource(text) {
    let cleaned = String(text || "");

    // Remove any Source: lines anywhere
    cleaned = cleaned.replace(/^Source:.*$/gim, "");

    // Strip any URLs that slipped through
    cleaned = cleaned.replace(/https?:\/\/\S+/gi, "");

    cleaned = cleaned.trim();

    return `${cleaned}\n\nSource: ${sourceDomain}`.trim();
  }

  out = normalizeSource(out);

  // Retry once if model still leaks URLs
  if (/https?:\/\//i.test(out)) {
    const retryPrompt =
      prompt +
      "\n\nYOU VIOLATED THE RULE. REMOVE ALL URLS. PRINT ONLY ONE FINAL SOURCE LINE.";
    const retryOut = await callOpenAI(retryPrompt, {
      temperature: 0.5,
      max_tokens: 280,
    });
    if (retryOut) out = normalizeSource(retryOut);
  }

  return out;
}

module.exports = { summarizeWithOpenAI };