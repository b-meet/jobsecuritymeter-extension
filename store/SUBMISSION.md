# Chrome Web Store submission

Everything the dashboard asks for, in the order it asks. Copy the quoted blocks
verbatim; they are written to be pasted.

Two rules for keeping this file honest:

- **The manifest is the source of truth.** Every permission justification below
  names a real key in `src/manifest.ts`. Add a permission there and the
  submission is wrong until it is answered here too.
- **The privacy policy has to agree with it.** Reviewers check the listing
  against `https://jobsecuritymeter.com/privacy` §4. If you change what is
  stored, that section changes first.

---

## Before you open the dashboard

```bash
npm test                  # 173 tests
npm run package           # builds, refuses a bad build, writes build/*.zip
```

`npm run package` will not produce a zip if the build is a development build
(loopback in `externally_connectable`), carries no real Supabase publishable
key, is missing a declared icon, or has test files in it. If it printed a zip
path, those four are settled.

Then load `dist/` unpacked at `chrome://extensions` and walk the flow once, on a
real form:

- [ ] Connect from `jobsecuritymeter.com/extension/connect`; the popup shows your email.
- [ ] Open a Greenhouse or Lever posting. The card opens itself once.
- [ ] Fill. Values land, and skipped fields are reported rather than guessed.
- [ ] Focus an empty recognised field. The chip appears inside its right edge.
- [ ] On a company careers page (not a listed ATS): popup → "Fill this page" works.
- [ ] Then "Always run on <host>" → reload → the handle appears by itself.
- [ ] Revoke that site at `chrome://extensions` → it stops appearing.
- [ ] Disconnect. The popup returns to "Not connected yet."

---

## One-time account setup

Account-level, not per-item, and the dashboard blocks submission on all of it.

**Verified contact email and publisher display name** — both under **Account**.
A missing publisher name is the most common trivial rejection there is.

**EEA trader status.** The dashboard interrupts with an "Action required" dialog
asking you to declare trader or non-trader. This comes from the EU Digital
Services Act, which makes marketplaces identify who is trading with EEA
consumers. It is a declaration about the publisher account, not about this
extension.

**Declare: trader.** The test is whether publishing relates to a trade,
business, craft or profession — not whether this particular item is free. Job
Autofill requires an account on jobsecuritymeter.com, which sells roadmaps and
resume rewrites, so it is part of a business. "It's a free extension" is not the
non-trader case, and misdeclaring is grounds for Google restricting or removing
EEA distribution.

**Know this before you click it:** a trader must supply a legal name, full
street address, phone number and email, and Google **publishes them on the store
listing** and verifies them. For a solo maintainer that means a home address
becomes public unless you give it something else — a registered business
address, a virtual mailbox, or a company registration. Decide that first; it is
easier than changing it once it is live.

---

## Store listing

**Name** (45 max)

```
Job Autofill by Job Security Meter
```

**Short description / summary** (132 max — this is `description` in the manifest, already set)

```
Fill job applications from your saved profile. One click across Greenhouse, Lever, Ashby and more.
```

**Category:** Workflow & Planning
**Language:** English (United States)

**Detailed description**

```
Applying for jobs means typing the same forty fields into a different form every time. Job Autofill fills them for you, from one profile you write once.

HOW IT WORKS

1. Save your profile at jobsecuritymeter.com — contact details, links, work history, skills, notice period, salary expectations.
2. Connect the extension to your account. One click; no second password.
3. Open an application form. A small button appears. Press it, and the fields it recognises are filled.

WHAT IT FILLS

Name, email, phone, address, LinkedIn and GitHub, current company and title, years of experience, skills, notice period, earliest start date, salary expectations, work authorisation, and the voluntary equal-opportunity questions if — and only if — you chose to answer them.

WHERE IT WORKS

Automatically on the major applicant tracking systems: Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Keka, Darwinbox, Zoho Recruit, Freshteam, Workable, BambooHR, iCIMS, Taleo, SuccessFactors, Jobvite, Recruitee, Personio, Teamtailor, Breezy, JazzHR, Pinpoint, Avature, Eightfold, Phenom and join.com.

Most companies run their own careers page, so anywhere else you can either press "Fill this page" in the popup — which works on any site, with no permission prompt and no standing access — or grant one site permanently if you apply through it often.

IT WILL LEAVE A FIELD BLANK RATHER THAN GUESS

This is the design decision everything else follows from. Filling the wrong value into a job application is worse than filling nothing, because you may not notice before you submit. So when the extension is not confident what a field is for, it tells you it skipped it. Your name will not end up in the box asking for your last employer, and the salary you want will not end up in the box asking what you earn now.

It never submits anything. Every fill happens because you pressed a button, and you should always read the form before sending it.

PRIVACY

- No analytics. No tracking. No advertising code. None.
- It does not read the pages you visit. It looks at the fields of a form to work out which it could fill, and that happens entirely in your browser.
- Nothing about the pages you open or the jobs you look at is sent to us or to anyone else.
- Nothing broad is requested when you install it. Standing access to a site is yours to grant and yours to revoke.

Full detail: https://jobsecuritymeter.com/privacy

NOT AFFILIATED

Greenhouse, Lever, Ashby, Workday, Keka, Zoho Recruit and the other platforms named above are trademarks of their respective owners. Job Autofill is not affiliated with, endorsed by, or sponsored by any of them. We name them only to say where the extension works.

KNOWN LIMITS, STATED UP FRONT

- Workday is detected but only partially supported; its multi-step wizard is a different problem from the others.
- It does not attach your resume file yet. It fills the form fields, not the upload.
- Job sites change their forms. When one breaks, most fixes ship from our server without you updating anything.

Free to use. You need a Job Security Meter account, which is also free.
```

**Homepage URL:** `https://jobsecuritymeter.com` (also `homepage_url` in the manifest)
**Support URL:** `https://jobsecuritymeter.com/support`
**Privacy policy URL:** `https://jobsecuritymeter.com/privacy`

### Graphics

| Asset | Size | Required | File |
| :--- | :--- | :--- | :--- |
| Store icon | 128×128 | yes | `public/icons/icon-128.png` |
| Screenshot | 1280×800 | at least 1, up to 5 | `store/assets/screenshot-*.png` |
| Small promo tile | 440×280 | for featuring | `store/assets/promo-small-440x280.png` |
| Marquee | 1400×560 | for featuring | not made |

See `store/assets/README.md` for how the screenshots were produced and what to
check before uploading them.

---

## Privacy practices tab

### Single purpose

The dashboard wants one narrow purpose, and it is checked against what the
extension actually does. Do not broaden this to cover things it might do later.

```
Job Autofill fills the standard fields of an online job application form — contact details, links, work history, skills, and availability — from a profile the user has saved to their Job Security Meter account. That is its only function. It does not submit applications, and it does nothing on a page until the user presses a button.
```

### Permission justifications

One per permission, matching `src/manifest.ts`. The dashboard will not let you
submit with any of these blank.

**`storage`**

```
Stores four things locally: the sign-in token for the user's account so they do not have to reconnect on every fill, an ETag-cached copy of our public form-layout list (identical for every user, containing no user data), which window edge the user dragged the on-page button to, and which sites they chose to hide it on. The user's profile is not stored on the device — it is fetched when a fill needs it.
```

**`activeTab`**

```
Most job applications are not on the applicant tracking systems we list, because companies host their own careers pages. Pressing "Fill this page" in the popup is the user gesture that grants access to that one tab, for that one visit, so the extension can read the form's fields and fill them. This is what lets us avoid requesting broad host access at install: access is scoped to the tab the user is looking at, at the moment they ask, and does not persist.
```

**`scripting`**

```
Used with activeTab to inject the content script into a page that the manifest does not cover, when the user presses "Fill this page". It is also used to register a content script for a site after the user has explicitly granted that site through Chrome's own permission prompt. It never runs on a page the user did not ask for.
```

**Host permissions** (the applicant tracking system list)

```
These are the applicant tracking systems that host the application form itself, so the extension can detect the form and offer to fill it without the user having to find the toolbar icon. Every entry is an ATS whose forms live on a per-company subdomain, which is why the wildcards are narrow in practice: *.keka.com reaches careers pages, not anything else the user has open. jobsecuritymeter.com is included so the extension can receive the session handed over by our own connect page. This is a curated list rather than <all_urls> deliberately — the extension asks for nothing broad at install.
```

**Optional host permissions** (`https://*/*`, `http://*/*`)

```
Optional, and never granted at install — nothing here appears in the install-time permission warning. Companies run their own careers pages and the long tail of smaller ATSs cannot be enumerated, so a user who applies through one site repeatedly can grant that single origin through Chrome's own prompt, one at a time, and the extension will then show its button there automatically. Each grant is per-origin and revocable from chrome://extensions at any time; the extension reconciles against the permission list on every startup and every change, so revoking takes effect immediately. Users who do not want this never need it: "Fill this page" works everywhere via activeTab.
```

### Remote code

**Answer: No, I am not using remote code.**

Everything executed ships inside the package. The CSP in the manifest
(`script-src 'self'`) enforces it, and there is no `eval`, no injected `<script>`
tag, and no CDN import anywhere in the source.

If a reviewer asks about `/api/vault/field-map`: it returns **JSON data** — CSS
selectors for known form layouts, so a broken selector can be fixed from our
server rather than through a store review. It is parsed as data and never
executed. That is configuration, not remote code.

### Data usage

Tick these, and no others:

| Category | Declare | Why |
| :--- | :--- | :--- |
| Personally identifiable information | **Yes** | Name, email, phone, postal address, links. |
| Health information | **Yes** | The voluntary EEO block includes disability status. Only if the user answers it — it defaults to "prefer not to say" — but the capability exists, so it is declared. |
| Financial and payment information | **Yes** | Current and expected salary. Not payment data, and no card ever touches the extension, but salary is close enough to this category that declaring it is the safer reading. |
| Authentication information | **Yes** | The sign-in token in `chrome.storage.local`, sent to our API to authorise the profile request. |
| Personal communications | No | The default cover letter is a document the user wrote for themselves, not a message to or from anyone. |
| Location | No | The postal address is self-entered contact information, declared under PII. No geolocation, no IP-based location, nothing derived from the device. |
| Web history | No | Never collected. Browsing is not read, recorded, or transmitted. |
| User activity | No | No analytics, no telemetry, no clickstream, no keystroke monitoring. |
| Website content | No | Form field labels and attributes are read **on the device** to decide what a field is for, and never leave it. The declaration covers data that is collected — i.e. transmitted off the device — and none of this is. |

Two of these are judgment calls made deliberately toward over-declaring
(health, financial). Under-declaring is a policy violation; over-declaring is
not, and neither one produces an install-time warning.

### Certifications

All three are true, and all three can be ticked:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

There is no data sale, no advertising, no data broker, and no third-party
recipient. Sub-processors are our own infrastructure (Supabase for the database
and token refresh), disclosed in the privacy policy.

---

## What a reviewer is most likely to question

Answers ready, rather than improvised under a rejection notice.

**"Why do you need optional access to every site?"**
It is optional and per-origin. Nothing is granted at install; the user grants one
origin at a time through Chrome's prompt. The alternative — shipping
`<all_urls>` — asks every user to trust us with every tab so they can fill in a
job application. The one-off path (`activeTab`) needs no grant at all and is the
default.

**"`web_accessible_resources` matches `<all_urls>`."**
That key states which pages may load a file we deliberately put there; it grants
access to no site. It has to be `<all_urls>` because the content script the
bundler emits is a loader whose dynamic `import()` is fetched with the *page* as
initiator, so on an injected page the real module is blocked without it — and
`executeScript` reports success while the script never runs. Host access is
`host_permissions`, which stays a curated list. Scoped to `assets/*` and
nothing more.

**"Justify collecting disability status."**
US application forms ask it, so the profile has somewhere to keep the answer.
Every one of the four EEO fields defaults to declining, we never pre-select,
they are filled only into the equivalent voluntary question on a form, and they
feed no score, no model, and no analytics. See the privacy policy §4, which
says exactly this.

**"Your privacy policy does not match the manifest."**
It does, and it is written to be diffed against it: §4 names each permission and
each of the four locally stored keys. If this comes back, the manifest changed
and the policy did not.

---

## After it is published

1. Put the published extension id in `NEXT_PUBLIC_EXTENSION_ID` in the main
   repo. `lib/shared/extension.ts` derives the store URL and the connect
   handshake target from it, and both are inert until it is set — the connect
   page cannot address the extension without it.
2. Check the connect handshake against the **published** build. An unpacked
   build has a different id, so this is the one step that cannot be tested
   before publishing.
3. Bump `version` in `src/manifest.ts` for every subsequent upload. The
   dashboard rejects a version it has already seen.
