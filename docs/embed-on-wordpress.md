# Embedding the loan application on firstequityfundingllc.com

This is the paste-ready snippet for embedding `https://firstequity.irongateportals.com/apply` inside an iframe on any page of `firstequityfundingllc.com`.

## Where to paste it

Open the WordPress page you want the application to appear on, add a **Custom HTML** block where you want the form to sit, and paste the snippet below. Save / publish the page. That's all.

## The snippet

```html
<iframe
  id="fef-loan-application"
  src="https://firstequity.irongateportals.com/apply?embed=1"
  title="Loan Application"
  loading="lazy"
  style="width:100%; min-height:800px; border:0; display:block;"
  allow="payment; clipboard-write"
></iframe>

<script>
(function () {
  var iframe = document.getElementById('fef-loan-application');
  if (!iframe) return;
  // Admin test mode: if THIS page is opened with ?testkey=... in its URL,
  // forward that secret to the embedded app so the admin-only Test mode
  // toggle unlocks inside the iframe. Normal visitors never have this param,
  // so they always see the standard live form. The secret only ever lives in
  // the admin's address bar, never in this page's HTML.
  try {
    var pk = new URLSearchParams(window.location.search).get('testkey');
    if (pk) {
      var u = new URL(iframe.src);
      u.searchParams.set('testkey', pk);
      iframe.src = u.toString();
    }
  } catch (e) {}
  window.addEventListener('message', function (event) {
    if (event.origin !== 'https://firstequity.irongateportals.com') return;
    var data = event.data;
    if (data && data.type === 'fef-apply-height' && typeof data.height === 'number') {
      iframe.style.height = data.height + 'px';
    }
  });
})();
</script>
```

## What each piece does

| Line | Why it's there |
|---|---|
| `?embed=1` on the iframe src | Enables embed mode: hides the FEF logo + wordmark by default (your WordPress page already brands the section), sizes the iframe correctly, and reports height to the parent for auto-resize. The three security badges stay visible on every step. |
| `&header=1` (optional) | Opts the FEF logo + wordmark header back IN while embedded, for hosts that want the branding shown inside the iframe. Omit it to keep the logo hidden. |
| New-vs-returning chooser in the embed | `/apply` opens on the "new vs returning borrower" gate. "New borrower" continues in the iframe. "Returning customer" breaks the browser out to the portal to sign in (`/apply?returning=1`), because login cookies do not work inside a cross-site iframe; after signing in there, the borrower gets their pre-filled application on the portal. |
| `style="width:100%; min-height:800px; border:0; display:block;"` | Full-width, no border. The `min-height` is a fallback for the brief moment before the first height message lands so the iframe isn't collapsed to zero on slow connections. |
| `allow="payment"` | Required for the Square credit-card form on Step 5 to load. Without it, the browser blocks the Square SDK. |
| `allow="clipboard-write"` | Lets any "copy to clipboard" buttons inside the form work. |
| The `<script>` block | Listens for height messages from the app and resizes the iframe so it grows and shrinks naturally with the form. No internal scrollbar, no fixed-height awkwardness. |
| `event.origin === 'https://firstequity.irongateportals.com'` check | Prevents any other site from spoofing height messages to your page. |

## Test plan after pasting

1. Open the published WordPress page in an incognito window.
2. The form should render with the security badges at the top but no FEF logo (your page header still shows your FEF branding).
3. Click through Step 1 → Step 2 → Step 3 → etc. The iframe should grow / shrink to fit each step. No internal scrollbar.
4. On Step 5, the Square card input should render normally.

## Admin test mode (embedded)

Inside the iframe the form is cross-site, so your admin login cookie never reaches it and the normal admin Test mode toggle stays hidden for everyone. To run a **test submission** from the live embedded page, the snippet forwards a secret `testkey` from the page URL into the iframe.

**To use it:** open the embed page with `?testkey=<EMBED_TEST_KEY>` appended, e.g.

```
https://firstequityfundingllc.com/apply-now-new?testkey=YOUR_SECRET_HERE
```

The **Test mode** toggle then appears at the top of the embedded form. Flip it on, fill the form (or pick a test scenario), and submit. Test submissions send to the override email addresses only and never create a real loan; they're rate-limited to 10/min.

- Without the param, the page is the normal live form. No toggle, no test path.
- The secret only lives in the admin's address bar, never in the page HTML, so it isn't exposed to ordinary visitors.
- The secret is the `EMBED_TEST_KEY` Vercel environment variable. To rotate it, change that value (and use the new value in the URL). Get the current value from the dev team / Vercel project settings.

## Security posture

- The application is **locked** to embedding from `firstequityfundingllc.com` (apex + any subdomain) and our own portal via a CSP `frame-ancestors` header. Any other site trying to embed it will be blocked by the browser.
- If you ever want to embed on a different marketing site or partner page, contact the dev team to add that origin to the allowlist. It's a one-line config change.

## Maintenance

Any change shipped to `/apply` (new field, copy tweak, bug fix) automatically lands inside the iframe on the next portal deploy. No separate maintenance on the WordPress side.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Iframe shows up blank or shows a "refused to connect" error | The CSP `frame-ancestors` is blocking. Confirm the WordPress page is on a `firstequityfundingllc.com` subdomain (not `firstequityfundingllc.wpengine.com` or similar staging URL). If on a staging URL, contact the dev team to add it temporarily. |
| Iframe shows but doesn't resize, stuck at the min-height | The `<script>` block didn't paste / WordPress's editor stripped it. Try using a **Custom HTML** block specifically (not a paragraph block), and verify the script tag is present when you view the published source. |
| Square card form on Step 5 doesn't load | Missing `allow="payment"` on the iframe attribute. Re-check the iframe tag. |
| Form scrollbar appears inside the iframe | Auto-resize isn't running. See above. As a temporary fallback, bump the `min-height` from `800px` to something like `2400px` so the form fits without scrolling even if the script doesn't run. |
