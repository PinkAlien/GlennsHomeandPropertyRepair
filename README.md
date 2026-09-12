# GlennsHomeandPropertyRepair

Website for Glenn's Home & Property Repair LLC in Piqua, Ohio.

Static site, deployed on Vercel at glennshomeandpropertyrepair.com.
Domain registered at Porkbun; DNS stays at Porkbun (A record on root,
CNAME on www) so email authentication records live in the same place.

Static HTML/CSS with Vercel functions for estimate intake, signed photo uploads,
and authenticated photo retention. No client-side pricing calculator.

## Checks and previews

Run `npm test` with Node 24. Tests stub provider calls and do not contact Airtable,
Resend, or Cloudinary. Run `npm run dev` for a local browser check: its intake uses
the real handler with simulated providers and photo uploads deliberately disabled.
Use `TEST_RECEIPT=both-fail npm run dev` to exercise the unsuccessful receipt path.

Git branches deploy through the existing Vercel GitHub integration. Preview
deployments refuse intake, upload-signing, and cleanup side effects, even if
production credentials are also available in Preview. Verify the live provider
configuration separately before production. Customer receipt emails only send
after Airtable saves the request or the notification to Jesse succeeds.
