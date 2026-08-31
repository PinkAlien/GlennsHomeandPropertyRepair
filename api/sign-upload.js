// Returns a short-lived Cloudinary upload signature.
// The browser uploads photos straight to Cloudinary; bytes never touch this server.
import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    return res.status(500).json({ error: "Cloudinary not configured" });
  }

  const timestamp = Math.round(Date.now() / 1000);
  const folder = `glenns/estimates/${new Date().toISOString().slice(0, 10)}`;

  // Params must be sorted alphabetically and joined before signing.
  const toSign = `folder=${folder}&timestamp=${timestamp}`;
  const signature = crypto
    .createHash("sha1")
    .update(toSign + CLOUDINARY_API_SECRET)
    .digest("hex");

  res.status(200).json({
    signature,
    timestamp,
    folder,
    apiKey: CLOUDINARY_API_KEY,
    cloudName: CLOUDINARY_CLOUD_NAME
  });
}
