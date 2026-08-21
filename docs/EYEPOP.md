# Wiring up EyePop.ai

The brief's **Option A, the portion counter**: a chef photographs the surplus
tray, EyePop counts what is in it, and the app fills in the quantity.

It is already built and wired into the claim flow. What is missing is a Pop and
a key.

## Why option A

It sits exactly where the friction is. Nobody wants to type at 10pm, and the
quantity field is the one thing standing between a restaurant and a completed
claim. It also has **no ethical exposure**: the camera is pointed at food, in a
kitchen, by the person who owns it.

Option B (photographing drop points to score conditions) is a real build too,
but it photographs the street, which needs the privacy framing front and centre.
Pick one — the brief is right that doing both badly is worse than one well.

**Not doing, ever:** scanning street imagery to find where people sleep. It is
surveillance of people who cannot consent, and it would sink an otherwise strong
project.

## The seam

```js
window.SurplusVision.adapter = {
  detect: (file) => Promise /* -> EyePop's prediction object, unchanged */
};
window.SurplusVision.portionsPerObject = 2;   // meals per detected item
window.SurplusVision.minConfidence = 0.4;
```

`detect` returns EyePop's own prediction shape, so their SDK result passes
straight through with no reshaping:

```json
{
  "source_width": 1920,
  "source_height": 1080,
  "objects": [
    { "classLabel": "tray", "confidence": 0.91, "x": 100, "y": 50,
      "width": 80, "height": 200 }
  ]
}
```

The app filters by `minConfidence`, counts what is left, multiplies by
`portionsPerObject`, and writes the result into the quantity field — which stays
editable. A chef looking at the tray outranks a model, always.

With no adapter the button runs in **demo mode** and says so on screen in amber.
A made-up number presented as computer vision is worse than no feature.

## The key must not be in the browser

EyePop's own docs are explicit:

> Do not put `EYEPOP_API_KEY` in browser bundles, mobile app bundles, or public
> repositories

So the flow is three steps, and the middle one is the backend your teammate is
already building:

```
browser  --(1) ask for a session-------->  Edge Function  (holds EYEPOP_API_KEY)
browser  <--(2) short-lived session token--
browser  --(3) upload photo------------->  EyePop worker endpoint
```

### Supabase Edge Function

```ts
// supabase/functions/eyepop-session/index.ts
import EyePop from "npm:@eyepop.ai/eyepop";

Deno.serve(async (req) => {
  // Require a signed-in restaurant; a session token is a spendable credential.
  const jwt = req.headers.get("Authorization");
  if (!jwt) return new Response("unauthorized", { status: 401 });

  const endpoint = await EyePop.workerEndpoint({
    auth: { secretKey: Deno.env.get("EYEPOP_API_KEY")! },
    popId: Deno.env.get("EYEPOP_POP_ID")!,
  }).connect();

  const session = await endpoint.session();
  await endpoint.disconnect();

  return new Response(JSON.stringify(session), {
    headers: { "Content-Type": "application/json" },
  });
});
```

```bash
supabase secrets set EYEPOP_API_KEY=eyp_... EYEPOP_POP_ID=...
supabase functions deploy eyepop-session
```

### Browser adapter

```html
<script src="https://cdn.jsdelivr.net/npm/@eyepop.ai/javascript-sdk/dist/eyepop.min.js"></script>
```

```js
let ep = null;

async function getEndpoint() {
  if (ep) return ep;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/eyepop-session`, {
    headers: { Authorization: `Bearer ${supabaseSession.access_token}` }
  });
  const session = await res.json();
  ep = await EyePop.workerEndpoint({ auth: { session } }).connect();
  return ep;
}

window.SurplusVision.adapter = {
  detect: async (file) => {
    const endpoint = await getEndpoint();
    const results = await endpoint.process({ file });
    for await (const r of results) return r;   // first frame is the photo
    return { objects: [] };
  }
};
```

**Confirm the upload call against your SDK version.** The session/auth flow above
is from EyePop's documentation, but I could not verify the exact browser
file-upload signature (`process({ file })` vs `upload()`) — that is the one line
to check against a real endpoint. Everything on this side of the adapter is
tested.

## Calibrating the count

Two numbers decide whether the estimate is any good, and both depend on the Pop:

| | |
|---|---|
| `portionsPerObject` | If the Pop detects **trays**, one tray is several meals — set 8, 10, whatever a tray holds. If it detects **portions** directly, leave it at 1. |
| `minConfidence` | Default 0.4. Raise it if the demo miscounts on a cluttered pass. |

Calibrate by photographing a known tray and adjusting until the number matches.
Say that number out loud in the pitch — "we photographed 20 trays and it was
within one" is worth more than any slide.

## What was tested

Against a stub returning EyePop's documented shape:

- 12 trays + 5 loaves at high confidence, one tray at `0.12` →
  **"Counted 12 tray, 5 bread loaf. Suggested 34 meals"**. The low-confidence
  detection was correctly dropped.
- Adapter rejecting → *"Could not read the photo. Type the number instead."*
  The field stays editable and the claim still completes. **A vision failure
  must never block a food drop.**
- No adapter → demo mode, labelled as such.

## It stays optional

The page makes zero external requests by default and works offline. The camera
button previews the photo from a local object URL; nothing leaves the browser
unless an adapter is configured. If the network is down at 10pm, the app is a
manual-entry tool, which is exactly what it was before this feature existed.
