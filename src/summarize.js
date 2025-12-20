require("dotenv").config();

async function summarizeWithOpenAI({ title, url }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY in .env");

  const prompt = `
You write for an ironic negative-news portal called "fearporn.world".
IMPORTANT: You only know the HEADLINE and LINK. Do NOT invent details, motivations, quotes, or identities not present in the headline.
If the headline is vague, speak in general terms and say what is *unclear*.

STYLE (very important):
- Write like a sharp tabloid columnist, not a neutral reporter.
- Avoid explanatory or academic language.
- Short sentences. Fragments are fine.
- Keep it punchy, sarcastic, and darkly funny (but not hateful).
- No slurs. No attacks on protected groups. No celebration of violence.

FORMAT (exact):
1) One short headline-like line (not the original headline) + 1 emoji
2) Blank line
3) A short paragraph (3–6 sentences). Be opinionated.
4) Blank line
5) Final line: "What could possibly go wrong?" + 1 emoji

IMPORTANT OUTPUT RULES:
- DO NOT include the original article URL anywhere in the output.
- DO NOT include a "Source:" line anywhere in the output.
- Do NOT add extra sections, bullet points, or disclaimers.
- Do NOT include the source, URL, or domain anywhere in the output.
- Do NOT write lines like "Source:", "Via", or similar.

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
Link (for your private reference only, DO NOT print it): ${url}
`.trim();

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: prompt,
      temperature: 0.9,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${text}`);
  }

  const data = await resp.json();

  // Responses API: safest extraction across formats
  let out = "";
  if (typeof data.output_text === "string") out = data.output_text;
  if (!out && Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c && c.type === "output_text" && typeof c.text === "string") {
            out += c.text;
          }
        }
      }
    }
  }

  out = (out || "").trim();

  // Hard safety: strip any accidental "Source:" line if the model ignores instructions
  out = out
    .split("\n")
    .filter((line) => !/^source\s*:/i.test(line.trim()))
    .join("\n")
    .trim();

  return out;
}

module.exports = { summarizeWithOpenAI };