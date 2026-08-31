// Deletes estimate photos older than PHOTO_RETENTION_DAYS.
// Uploads live in dated folders (glenns/estimates/YYYY-MM-DD), so expiry is
// a matter of dropping whole folders. Airtable keeps its own copy of each
// attachment, so the job record survives this.
const CLOUDINARY = "https://api.cloudinary.com/v1_1";

export default async function handler(req, res) {
  const {
    CLOUDINARY_CLOUD_NAME: cloud,
    CLOUDINARY_API_KEY: key,
    CLOUDINARY_API_SECRET: secret,
    CRON_SECRET,
    PHOTO_RETENTION_DAYS = "90"
  } = process.env;

  // Vercel Cron sends this header automatically when CRON_SECRET is set.
  if (CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!cloud || !key || !secret) {
    return res.status(500).json({ error: "Cloudinary not configured" });
  }

  const auth = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
  const cutoff = new Date(Date.now() - Number(PHOTO_RETENTION_DAYS) * 86400000)
    .toISOString()
    .slice(0, 10);

  try {
    const list = await fetch(`${CLOUDINARY}/${cloud}/folders/glenns/estimates`, {
      headers: { Authorization: auth }
    });
    if (!list.ok) throw new Error(`list ${list.status}`);
    const { folders = [] } = await list.json();

    // Folder names are ISO dates, so a string compare is a date compare.
    const stale = folders
      .map(f => f.name)
      .filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n) && n < cutoff);

    const deleted = [];
    for (const day of stale) {
      const prefix = `glenns/estimates/${day}/`;
      const del = await fetch(
        `${CLOUDINARY}/${cloud}/resources/image?prefix=${encodeURIComponent(prefix)}`,
        { method: "DELETE", headers: { Authorization: auth } }
      );
      if (!del.ok) {
        console.error(`cleanup: assets ${day} -> ${del.status}`);
        continue;
      }
      await fetch(`${CLOUDINARY}/${cloud}/folders/glenns/estimates/${day}`, {
        method: "DELETE", headers: { Authorization: auth }
      });
      deleted.push(day);
    }

    console.log(`cleanup: cutoff ${cutoff}, removed ${deleted.length} day(s)`);
    return res.status(200).json({ cutoff, deleted });
  } catch (e) {
    console.error("cleanup failed:", e.message);
    return res.status(500).json({ error: e.message });
  }
}
