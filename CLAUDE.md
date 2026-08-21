# Known gotchas

## GHL chat widget sizing — use GHL's own Widget Dimension setting, not CSS

The embedded GHL chat widget (`<chat-widget>` in `templates/demo-page.html`) renders its actual UI (header, messages, input) through Shadow DOM, computed by GHL's own JavaScript. External CSS on our page cannot reach or resize that content correctly — `display:none`, `position:sticky`, and `transform:scale()` (with or without an explicit pre-scale height) were all tried and all failed the same way, confirmed live via DevTools on 2026-08-18/19/20.

To resize the chat widget, use GHL's own **Widget Dimension** setting instead: open the widget in **Sites → Chat Widgets → Style tab → Widget customization → Widget dimension**, select **Custom**, and set width/height there (e.g. 280×420 to match the Talk panel). This is computed by GHL's own JS and works correctly — confirmed live on 2026-08-20.

An earlier test of this same setting was wrongly logged as "has zero effect" — that test ran while a CSS specificity bug was causing both the Talk and Chat panels to render stacked on top of each other at once, which made the real effect of the dimension change impossible to see. Once that bug was fixed and the setting was retested cleanly, it worked as expected. If revisiting chat widget sizing, don't rule this setting out based on that old note.

## `templates/demo-page.html` — `.phone-screen` max-height: 85vh

Keep this as a generous cap, not a small fixed pixel value — it's a safety net for edge cases (very long conversations, the Talk panel's natural size), not the primary sizing mechanism for the chat widget's compact size (that's GHL's own Widget Dimension setting above). Fixed px values (420px, 400px, 320px, 280px, 230px) were tried directly on this element early on, before the Shadow DOM root cause above was understood, and broke the widget's internal input-pinning.

If the phone mockup looks too tall on the page, fix it by shrinking the `header`/`.card` sections above the phone, not this value.
