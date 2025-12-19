app.get("/admin/run", async (req, res) => {
  try {
    const token = req.query.token || req.get("x-admin-token");
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
      return res.status(401).send("Unauthorized");
    }

    const { spawnSync } = require("child_process");

    const run = (label, args) => {
      const r = spawnSync(process.execPath, args, {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      return {
        label,
        status: r.status,
        stdout: (r.stdout || "").slice(-8000),
        stderr: (r.stderr || "").slice(-8000),
      };
    };

    const r1 = run("ingest", ["scripts/ingest.js"]);
    if (r1.status !== 0) return res.status(500).json(r1);

    const r2 = run("summarize", ["scripts/summarize_batch.js"]);
    if (r2.status !== 0) return res.status(500).json(r2);

    return res.json({ ok: true, ingest: r1.status, summarize: r2.status });
  } catch (e) {
    return res.status(500).send(e.message);
  }
});