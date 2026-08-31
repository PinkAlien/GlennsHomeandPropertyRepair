# Setup

## 1. Email forwarding (Porkbun)

Porkbun's MX records are already on the domain. In Porkbun, open the domain →
**Email Hosting → Manage → Email Forwarding**, and add:

| Forward from | To |
|---|---|
| `jesse@glennshomeandpropertyrepair.com` | `glennhomeimprovement@gmail.com` |

Free, unlimited, and Jesse changes nothing about how he reads email.

Optional but worth it: set up "send as" in Gmail so replies come from the
jesse@ address rather than the gmail one. Gmail → Settings → Accounts →
Add another email address. It will ask for SMTP details — Porkbun forwarding
alone can't send, so this needs Resend SMTP or Gmail's own relay. Skip it if
it fights back; incoming forwarding is the part that matters.

## 2. Resend (sending)

Sending from the root domain would conflict with Porkbun's existing SPF record.
Use a subdomain instead — Resend recommends this and it keeps the two systems
apart.

1. Resend → Domains → Add `send.glennshomeandpropertyrepair.com`
2. Add the DKIM and SPF records it gives you to **Porkbun** DNS
3. Do NOT touch the existing `v=spf1 include:_spf.porkbun.com ~all` record
4. Wait for verification, then create an API key

## 3. Airtable

Create a base with a table named `Requests` and these fields, spelled exactly:

| Field | Type |
|---|---|
| Name | Single line text |
| Phone | Phone |
| Email | Email |
| Preferred Contact | Single select — Call me / Text me / Email me |
| Town | Single line text |
| Job Type | Single select — Roofing, Siding, Addition or outbuilding, Deck fence or ramp, Kitchen, Bathroom, Flooring, Something else |
| Timeline | Single select — As soon as possible / Within a month / Within three months / Still planning |
| Budget | Single select — the five ranges on the form |
| Details | Long text |
| Photos | Attachment |
| Stage | Single select — Lead, Qualified, Site visit, Estimating, Quote sent, Accepted, Scheduled, Active, Complete |
| Received At | Date (include time) |

Then create a personal access token with `data.records:write` scoped to this base.

## 4. Vercel environment variables

Project → Settings → Environment Variables. All environments.

```
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
AIRTABLE_TOKEN
AIRTABLE_BASE_ID          app...
AIRTABLE_TABLE            Requests
RESEND_API_KEY
MAIL_FROM                 Glenn's Home & Property Repair <jesse@send.glennshomeandpropertyrepair.com>
NOTIFY_TO                 glennhomeimprovement@gmail.com,you@example.com
CRON_SECRET               any long random string you make up
PHOTO_RETENTION_DAYS      90
ALERT_TO                  optional — where failure alerts go. Defaults to the
                          first NOTIFY_TO address. Set this to your own address
                          once Jesse is on NOTIFY_TO, so he isn't the one
                          receiving error reports.
```

`NOTIFY_TO` takes a comma-separated list. Jesse's address goes first — it's the
one used as reply-to on the customer's auto-reply, so their replies reach him
and not everyone on the list. Drop the second address when you're done watching;
it's an env var change and a redeploy, no code edit.

Redeploy after adding them — Vercel doesn't pick up new variables on an
existing deployment.

## 5. Test before it's public

Submit the form once with a real email, two photos, and a fake name. Check:
a row lands in Airtable with the photos attached, Jesse's inbox gets the
notification, and the auto-reply arrives without going to spam.

`noindex` stays in `index.html` until Jesse has approved the site.

## 6. Photo retention

`/api/cleanup` runs daily at 9am UTC via Vercel Cron and deletes any estimate
photos older than `PHOTO_RETENTION_DAYS`. Uploads go into dated folders, so it
drops whole days rather than checking files one by one.

Two things this does not do, on purpose:

- **Airtable keeps its own copy.** Airtable downloads attachments when it
  receives a URL, so the job record survives. If the goal is that photos of a
  customer's house genuinely go away, the Airtable record has to be cleared
  too — decide that with Jesse rather than assuming.
- **Email links break at expiry.** The notification contains links, not
  attachments. After the retention window, those links 404. Ninety days is
  well past any quote going cold, but it's the reason not to set this to 14.

Set `PHOTO_RETENTION_DAYS` to a large number to effectively disable it. There
is no undo — deleted is deleted.
