// Receives an estimate request: writes it to Airtable, emails Jesse, replies to the customer.
const AIRTABLE_API = "https://api.airtable.com/v0";
const RESEND_API = "https://api.resend.com/emails";

const FIELDS = [
  "name", "phone", "email", "preferred_contact",
  "city", "job_type", "timeline", "budget", "details"
];

const clean = (v, max = 2000) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE = "Requests",
    RESEND_API_KEY, NOTIFY_TO, MAIL_FROM, ALERT_TO
  } = process.env;

  const body = req.body || {};
  const data = {};
  for (const f of FIELDS) data[f] = clean(body[f]);

  // Honeypot: real people leave this empty. Bots fill it.
  if (clean(body.website)) return res.status(200).json({ ok: true });

  if (!data.name || !data.phone || !data.details) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const photos = Array.isArray(body.photos)
    ? body.photos.filter(u => typeof u === "string" && u.startsWith("https://res.cloudinary.com/")).slice(0, 6)
    : [];

  const errors = [];

  // 1. Airtable — the record is the thing that must not be lost.
  let airtableOk = false;
  try {
    const r = await fetch(`${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        // typecast lets Airtable match or create select options, so a small
        // wording drift between the form and the base can't lose a lead.
        typecast: true,
        fields: {
          Name: data.name,
          Phone: data.phone,
          Email: data.email,
          "Preferred Contact": data.preferred_contact,
          Town: data.city,
          "Job Type": data.job_type,
          Timeline: data.timeline,
          Budget: data.budget,
          Details: data.details,
          Photos: photos.map(url => ({ url })),
          Stage: "Lead",
          "Received At": new Date().toISOString()
        }
      })
    });
    airtableOk = r.ok;
    if (!r.ok) errors.push(`airtable:${r.status} ${await r.text()}`);
  } catch (e) {
    errors.push(`airtable:${e.message}`);
  }

  const sendMail = async (to, subject, text, replyTo) => {
    const recipients = (Array.isArray(to) ? to : [to])
      .flatMap(v => String(v).split(","))
      .map(v => v.trim())
      .filter(Boolean);
    if (!recipients.length) throw new Error("no recipient");
    const r = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: recipients,
        subject,
        text,
        ...(replyTo ? { reply_to: replyTo } : {})
      })
    });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  };

  // 2. Tell Jesse. This must survive an Airtable failure — the email is the
  // backstop, so a bad field name can never cost a lead.
  const line = (label, value) => (value ? `${label}: ${value}\n` : "");
  const jesseBody =
    (airtableOk
      ? ""
      : "HEADS UP: this request did NOT save to the project board. " +
        "Everything you need is below, but you'll have to add it by hand.\n\n") +
    `New estimate request from the website.\n\n` +
    line("Name", data.name) +
    line("Phone", data.phone) +
    line("Email", data.email) +
    line("Best contact", data.preferred_contact) +
    line("Town", data.city) +
    line("Job", data.job_type) +
    line("Timeline", data.timeline) +
    line("Budget", data.budget) +
    `\nWhat they need:\n${data.details}\n` +
    (photos.length ? `\nPhotos:\n${photos.join("\n")}\n` : "\nNo photos attached.\n");

  let notifyOk = false;
  try {
    await sendMail(NOTIFY_TO, `${airtableOk ? "" : "[NOT SAVED] "}Estimate request — ${data.name}, ${data.city || "no town given"}`, jesseBody, data.email || undefined);
    notifyOk = true;
  } catch (e) {
    errors.push(`notify:${e.message}`);
  }

  // 3. Reply to the customer. Nothing here promises work that hasn't happened.
  if (data.email) {
    const reply =
      `${data.name.split(" ")[0]},\n\n` +
      `Thanks for reaching out. I have your request for ${data.job_type ? data.job_type.toLowerCase() : "the work"}` +
      `${data.city ? ` in ${data.city}` : ""}, and it's on my list.\n\n` +
      `I'm usually on a jobsite during the day, so estimates aren't always same-day. You'll hear back from me ` +
      `within two business days. If it's urgent, call me at (937) 726-0254.\n\n` +
      (photos.length
        ? `I've got the ${photos.length === 1 ? "photo" : `${photos.length} photos`} you sent — that helps.\n\n`
        : `If you can send photos of the area, reply to this email with them. It usually saves a trip.\n\n`) +
      `Jesse Glenn\nGlenn's Home & Property Repair LLC\nPiqua, Ohio\n(937) 726-0254`;

    try {
      // reply-to is the first NOTIFY_TO address only, so customer replies go to Jesse.
      const primary = String(NOTIFY_TO || "").split(",")[0].trim();
      await sendMail(data.email, "I got your request — Glenn's Home & Property Repair", reply, primary || undefined);
    } catch (e) {
      errors.push(`autoreply:${e.message}`);
    }
  }

  // 4. If anything went wrong, say so somewhere a person will actually look.
  // Vercel logs are where failures go to be ignored.
  if (errors.length) {
    console.error("submit errors:", errors.join(" | "));
    const alertTo = ALERT_TO || String(NOTIFY_TO || "").split(",")[0].trim();
    try {
      await sendMail(
        alertTo,
        `Intake problem — ${data.name || "unknown"}`,
        `Something failed while handling a website estimate request.\n\n` +
          `Saved to Airtable: ${airtableOk ? "yes" : "NO"}\n` +
          `Emailed Jesse: ${notifyOk ? "yes" : "NO"}\n\n` +
          `Errors:\n${errors.join("\n")}\n\n` +
          `Full submission, so nothing is lost:\n` +
          JSON.stringify({ ...data, photos }, null, 2)
      );
    } catch (e) {
      console.error("alert failed:", e.message);
    }
  }

  // The customer sees success if the request reached Jesse by either route.
  // Only a total failure justifies telling them to call instead.
  if (airtableOk || notifyOk) return res.status(200).json({ ok: true });
  return res.status(500).json({ error: "Could not save request" });
}
