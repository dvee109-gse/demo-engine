# Known gotchas

## `templates/demo-page.html` — `.phone-screen` must stay `max-height: 85vh`

Never change this to a fixed pixel value (420px, 400px, 320px, 280px, 230px have all been tried). GHL's embedded chat widget correctly pins its own input row and scrolls its message list internally, but only when its container isn't squeezed below the widget's natural layout height. Every fixed px value broke that internal behavior and clipped the "Type a message" input off-screen — confirmed live and re-broken multiple times across 2026-08-18/19.

If the phone mockup looks too tall on the page, fix it by shrinking the `header`/`.card` sections above the phone, not this value.
