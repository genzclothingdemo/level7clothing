/**
 * The copy of every email the store ships with, as data.
 *
 * Split out of `lib/automation.ts` (which was 3,800 lines) on 2026-09-28 so
 * the *words* of a message and the *rules* for when it is sent have separate
 * homes — two different kinds of change, usually made by two different people,
 * that used to collide in one file.
 *
 * **Pure data: no directive, no server imports.** A preview, a catalogue or the
 * admin template editor can read it on either side of the RSC boundary.
 * `syncSystemAutomation` in `lib/automation.ts` is what writes these rows into
 * `EmailTemplate`; the owner edits the stored copy from the admin afterwards.
 *
 * ## How the copy reaches the live database
 *
 * Editing this file changes nothing that is already stored — the sync is
 * additive and never rewrites a template's words. `scripts/refresh-email-templates.mts`
 * is what moves improved copy into the database, and it only touches a stored
 * template that is still word-for-word a version this store shipped; anything
 * the owner has edited is reported and left alone.
 *
 * ## What every template here is held to
 *
 * The standard is the order mail from Flipkart or Amazon, and it comes down to
 * seven rules. `scripts/email-catalogue.mts` renders every template through
 * the real engine and checks the ones a script can check.
 *
 * 1. **The subject says which order (or return) and what happened.** It is
 *    read in an inbox list, and it is also the title of the bell entry and the
 *    phone banner. No token that can be blank goes in a subject.
 * 2. **The first paragraph after the greeting is the whole event in one
 *    sentence.** `pushCopyFrom` turns it into the bell and banner text. For the
 *    three templates the owner's bell also uses (`order-delivered`,
 *    `return-picked-up`, `return-received`) it is written in a neutral voice,
 *    because the same sentence is shown to both.
 * 3. **Nothing the engine already prints.** The shell lays out the pieces with
 *    their photographs, sizes, quantities and prices, and a table of the order
 *    total, payment, the advance/balance split, courier, AWB, refund and
 *    return reason. A template line quoting one of those is dropped by
 *    `pruneFactLines` (it matches on the value), so writing one only leaves the
 *    owner a line that never appears.
 * 4. **A token that can be blank sits alone on a `Label: {{token}}` line**, or
 *    on the line under a short introducer ending in a colon. `pruneFactLines`
 *    removes the line — or the pair — when the value is empty. In a sentence a
 *    blank token cannot be removed, so only tokens every trigger fills appear
 *    in prose.
 * 5. **No typed promises about what happens next.** "We'll email you when it
 *    ships" is false the moment it is sent late. The line under the button is
 *    derived from the order's state by the engine (`orderHeadline`,
 *    `returnHeadline`), so templates leave that job to it.
 * 6. **An introducer is under 60 characters** ("See your order any time:").
 *    When the URL below it is the button's own URL, the shell drops the pair;
 *    a longer introducer would be left behind promising a link that is gone.
 * 7. **"Reply to this email" is a promise the store keeps.** Customer mail
 *    carries a reply-to of the store's contact address (see `lib/email.ts`),
 *    because the sending address is not a mailbox anybody reads.
 */

/**
 * **Every email this store sends, as data.**
 *
 * Before this list existed the shipped rules were three rows somebody had typed
 * into the live database by hand, and the mail that actually reached customers
 * was hardcoded HTML in `lib/email.ts` firing *beside* them. Two senders for
 * one event, which is why the seeded order rules had to be switched off.
 *
 * Now there is one place. A message the store sends is a row here, an editable
 * template in the admin, and a rule the owner can pause — and pausing it
 * genuinely stops the mail, because nothing else sends.
 *
 * `key` is the stable handle. It is generated once on create and never written
 * by the form (see `templateRow` in `actions/automation.ts`), which is what
 * stops a system template being renamed into deletability. **Never rename or
 * remove a key** — rules already in the database point at it.
 */
export type SystemTemplate = {
  key: string;
  name: string;
  subject: string;
  body: string;
};

export const SYSTEM_TEMPLATES: SystemTemplate[] = [
  /* ---- Orders, forward ---- */
  {
    key: "order-received",
    name: "Order received",
    subject: "We've received your order {{order.number}}",
    body: `Hi {{customer.firstName}},

Thank you for shopping with {{store.name}} — your order {{order.number}} has been placed.

Delivering to: {{order.address}}
Phone: {{customer.phone}}
Your note: {{order.note}}

See your order any time:
{{order.url}}

Team {{store.name}}`,
  },
  {
    key: "order-admin-new",
    name: "New order (to you)",
    // The method is the raw code on purpose: to the owner "COD" is the fact
    // that decides whether to ring before packing.
    subject: "New order {{order.number}} — {{order.total}} · {{order.paymentMethod}}",
    body: `{{customer.name}} just placed order {{order.number}}.

Phone: {{customer.phone}}
Email: {{customer.email}}
Ship to: {{order.address}}
Customer's note: {{order.note}}

The pieces and sizes are below. Confirm, pack and ship it from Orders in your admin.`,
  },
  {
    key: "order-confirmed",
    name: "Order confirmed",
    subject: "Order {{order.number}} is confirmed",
    body: `Hi {{customer.firstName}},

Good news — your order {{order.number}} is confirmed and we're getting it ready.

Delivering to: {{order.address}}

See your order any time:
{{order.url}}

Team {{store.name}}`,
  },
  {
    key: "order-shipped",
    name: "Order shipped",
    subject: "Order {{order.number}} has shipped",
    // Two links, and the shell keeps only the one the button is not. With an
    // AWB the button tracks the parcel, so the order page stays as the second
    // link; without one the tracking pair is pruned and the button opens the
    // order page.
    body: `Hi {{customer.firstName}},

Your order {{order.number}} is on its way to you.

Delivering to: {{order.address}}

Track your parcel:
{{order.trackingUrl}}

See your order any time:
{{order.url}}

Team {{store.name}}`,
  },
  {
    key: "order-delivered",
    name: "Order delivered",
    subject: "Order {{order.number}} has been delivered",
    // The opening line is also the owner's bell entry ("Show me deliveries in
    // the bell"), so it states the fact and nothing addressed to the customer.
    body: `Hi {{customer.firstName}},

Order {{order.number}} has been delivered.

We hope you love it. If anything isn't right, reply to this email and we'll sort it out.

See your order any time:
{{order.url}}

Team {{store.name}}`,
  },
  {
    key: "order-cancelled",
    name: "Order cancelled",
    subject: "Order {{order.number}} has been cancelled",
    body: `Hi {{customer.firstName}},

Your order {{order.number}} has been cancelled.

If you didn't ask for this, or you'd still like the pieces, reply to this email and we'll put it right.

See your order any time:
{{order.url}}

Team {{store.name}}`,
  },
  {
    key: "order-reopened",
    name: "Order back to pending",
    subject: "Order {{order.number}}: we're taking another look",
    body: `Hi {{customer.firstName}},

We've moved your order {{order.number}} back a step while we check a detail on it.

You don't need to do anything. If we need something from you we'll be in touch, and if you have a question, just reply to this email.

See your order any time:
{{order.url}}

Team {{store.name}}`,
  },

  /* ---- The money, which moves on its own ---- */
  //
  // **Two customer templates, not one, and that is the whole point of them.**
  // A prepaid order and a part-paid one fail differently: prepaid means the
  // entire total did not go through, partial means only the *advance* did and
  // the balance was never going online at all. One template covering both would
  // have to be vague exactly where a worried customer needs a number. The
  // amounts themselves are in the engine's table — the total, or the advance
  // and the balance — so neither template repeats them. The rules that carry
  // them are conditioned on `paymentMethod`, so neither can reach the wrong
  // order.
  //
  // Nothing here says "declined". The bank's reason is not visible to us, and
  // guessing at it in an inbox preview — where a subject line is read before
  // the mail is opened — is how a customer concludes their card is blocked
  // when the app simply timed out.
  {
    key: "payment-failed-prepaid",
    name: "Payment didn't go through",
    subject: "Payment for order {{order.number}} didn't go through",
    body: `Hi {{customer.firstName}},

The online payment for your order {{order.number}} didn't go through, so the order isn't confirmed yet.

No money has been taken. If your bank shows a pending debit, it's a temporary hold that reverses on its own, usually within 5–7 working days.

The quickest fix is to place the order again — a different card or UPI app usually works first time:
{{store.url}}

Still stuck? Reply to this email and we'll help you complete the order.

Team {{store.name}}`,
  },
  {
    key: "payment-failed-partial",
    name: "Advance payment didn't go through",
    subject: "Advance payment for order {{order.number}} didn't go through",
    body: `Hi {{customer.firstName}},

The advance payment for your order {{order.number}} didn't go through, so the order isn't confirmed yet.

Only the advance was due online — the rest was always going to be paid in cash on delivery. No money has been taken. If your bank shows a pending debit, it's a temporary hold that reverses on its own, usually within 5–7 working days.

The quickest fix is to place the order again — a different card or UPI app usually works first time:
{{store.url}}

Would you rather not pay an advance online? Reply to this email and we'll find a way that works for you.

Team {{store.name}}`,
  },
  {
    key: "payment-failed-admin",
    name: "A payment failed (to you)",
    // **Not a single token in the subject or the opening line that can come
    // back blank**, and that is a rule rather than a style. This one rule has
    // no `paymentMethod` condition — the owner should hear about a failed
    // payment whatever the method — so it is the one template that can be
    // reached by an order where nothing was ever charged online (an admin
    // marking a cash order's payment failed). `order.total` and the customer's
    // name are filled on every order; the amounts that differ by method are in
    // the engine's table.
    subject: "Payment failed on order {{order.number}} — {{order.total}}",
    body: `{{customer.name}}'s payment for order {{order.number}} didn't go through. The order is unconfirmed and nothing has been collected.

Phone: {{customer.phone}}
Email: {{customer.email}}

They chose their pieces, entered an address and got as far as paying — a quick call usually saves the sale.`,
  },

  /* ---- The parcel that turned around ---- */
  //
  // **None of the customer copy may call the order "cancelled", and that is
  // the bug these exist to fix.** `mapNimbusStatus` stores a completed RTO as
  // the order status `cancelled`, so before the `order.rto` trigger existed
  // the customer was emailed "your order has been cancelled" for a parcel they
  // had not cancelled, that was physically travelling back, and that they may
  // have already paid for.
  //
  // The voice is the one CLAUDE.md sets for the reverse leg: a parcel going the
  // other way is not an order making progress, so none of this borrows the
  // forward wording. What a customer wants to know is that they have not lost
  // their money and can still have the thing; what the owner wants to know is
  // that stock is coming back and a refund may be owed. The courier's raw scan
  // ("RTO In Transit") is jargon to a customer, so only the owner's copy
  // quotes it.
  {
    key: "order-rto-returning",
    name: "Parcel coming back (RTO)",
    subject: "Order {{order.number}} couldn't be delivered",
    body: `Hi {{customer.firstName}},

We couldn't deliver your order {{order.number}}, so the courier is bringing it back to us. Your order isn't lost, and we can send it out again.

This usually happens when nobody was home, the rider couldn't find the address, or the parcel was refused at the door by mistake.

Want it delivered? Reply to this email with a phone number that's reachable during the day and we'll ship it straight back out. If you'd rather not go ahead, tell us and we'll refund anything you've paid online.

Team {{store.name}}`,
  },
  {
    key: "order-rto-returned",
    name: "Parcel back with us (RTO)",
    subject: "Order {{order.number}} has come back to us",
    body: `Hi {{customer.firstName}},

The courier couldn't deliver your order {{order.number}}, and the parcel is now back with us. You can still have it.

Reply to this email and tell us which you'd like:

• Send it again — to the same address or a new one.
• A refund of anything you've paid online, to your original payment method.

Team {{store.name}}`,
  },
  {
    key: "order-rto-admin",
    name: "A parcel came back to you (to you)",
    subject: "RTO: order {{order.number}} is back with you",
    body: `Order {{order.number}} couldn't be delivered and the parcel has come back to you.

{{customer.name}} didn't cancel it. The order reads "cancelled" only because there is no separate RTO status to store.

Courier's last update: {{rto.scan}}
Last scanned at: {{rto.location}}
Phone: {{customer.phone}}
Email: {{customer.email}}

Next: put the pieces back into stock, then either ship it again or refund anything paid online.`,
  },

  /* ---- Carts ---- */
  {
    key: "lead-admin-new",
    name: "Something went in a cart (to you)",
    subject: "Added to cart: {{cart.productName}}",
    // A cart lead is often anonymous, so every detail about the person is on
    // a label line and simply disappears when the shopper gave none.
    body: `Someone just added {{cart.productName}} to their cart.

Name: {{customer.name}}
Phone: {{customer.phone}}
Email: {{customer.email}}

Everyone who has shown interest is listed under Interested customers in your admin — a friendly message there often turns a cart into an order.`,
  },
  {
    key: "abandoned-cart",
    name: "Abandoned cart nudge",
    subject: "Still thinking about {{cart.productName}}?",
    body: `Hi {{customer.firstName}},

You left {{cart.productName}} in your cart. It's still waiting for you — but our drops are small and sizes sell out fast.

Pick up where you left off:
{{cart.url}}

Changed your mind? No problem — you can ignore this email.

Team {{store.name}}`,
  },

  /* ---- Returns: the parcel coming back ---- */
  //
  // Until these existed a return could be raised, approved, collected,
  // delivered back and refunded without the customer hearing a word — the only
  // sender that existed spoke about an order moving *forward* ("your order has
  // shipped"), which is actively wrong for a parcel travelling the other way.
  //
  // The piece, its photograph, the order number, the reason given, the refund
  // and the pickup courier and AWB are all printed by the engine, so these
  // stay short: what happened, and anything only a person could add (the
  // owner's note).
  {
    key: "return-requested",
    name: "Return received",
    subject: "Return request {{return.number}} received",
    body: `Hi {{customer.firstName}},

We've received your request to return {{return.productName}} from order {{order.number}}.

Our team will review it and email you with the next step.

See your order any time:
{{order.url}}

Team {{store.name}}`,
  },
  {
    key: "return-admin-new",
    name: "A return was requested (to you)",
    subject: "Return requested: {{return.number}} on order {{order.number}}",
    body: `{{customer.name}} wants to return {{return.productName}} × {{return.quantity}}.

Phone: {{customer.phone}}
Email: {{customer.email}}

Approve or decline it under Returns in your admin — nothing moves until you decide.`,
  },
  {
    key: "return-approved",
    name: "Return approved",
    subject: "Return {{return.number}} approved",
    body: `Hi {{customer.firstName}},

Good news — your return of {{return.productName}} from order {{order.number}} has been approved.

Note from us: {{return.note}}

See your order any time:
{{order.url}}

Team {{store.name}}`,
  },
  //
  // **The two endings a return can have that are not a refund**, and the pair
  // this store had no words for at all. Both statuses were reachable — from
  // `decideReturn` and from the admin's status control — and both raised
  // `return.status_changed` perfectly well; there was simply no rule listening
  // on either, so the trigger fired into an empty room and the customer heard
  // nothing about a request they were waiting on. A refusal nobody is told
  // about is worse than a refusal.
  //
  // Neither subject line says "rejected" or "cancelled". An inbox preview is
  // read before the mail is opened, and a one-word verdict there is a worse
  // way to learn this than a sentence inside.
  {
    key: "return-rejected",
    name: "Return declined",
    subject: "About your return request {{return.number}}",
    body: `Hi {{customer.firstName}},

We've reviewed your request to return {{return.productName}} from order {{order.number}}, and unfortunately we can't accept this return.

Our reason: {{return.note}}

See your order any time:
{{order.url}}

Team {{store.name}}`,
  },
  {
    key: "return-cancelled",
    name: "Return closed",
    subject: "Return request {{return.number}} closed",
    body: `Hi {{customer.firstName}},

Your request to return {{return.productName}} from order {{order.number}} has been closed, so nothing further will happen with it.

Note from us: {{return.note}}

If that isn't what you expected, reply to this email and we'll pick it back up.

Team {{store.name}}`,
  },
  {
    key: "return-picked-up",
    name: "Return collected",
    subject: "Return {{return.number}} picked up",
    // Also the owner's bell entry ("Show me collected returns in the bell"):
    // the opening line is the fact, in a voice that reads right to both.
    body: `Hi {{customer.firstName}},

The courier has collected {{return.productName}} for return {{return.number}}.

See your order any time:
{{order.url}}

Team {{store.name}}`,
  },
  {
    key: "return-received",
    name: "Return arrived with us",
    subject: "Return {{return.number}} has reached us",
    // The owner's bell uses this one too — the entry that says a refund can
    // now safely be paid.
    body: `Hi {{customer.firstName}},

{{return.productName}} from return {{return.number}} has arrived back with us.

See your order any time:
{{order.url}}

Team {{store.name}}`,
  },
  {
    key: "return-refunded",
    name: "Refund sent",
    subject: "Refund sent for return {{return.number}}",
    body: `Hi {{customer.firstName}},

We've sent your refund for {{return.productName}} (return {{return.number}}).

Thank you for your patience — and for shopping with us.

See your order any time:
{{order.url}}

Team {{store.name}}`,
  },

  /* ---- Chat: the only event here that is not about an order ---- */
  //
  // **Both of these open with the message itself, on its own paragraph, and
  // that is deliberate.** `pushCopyFrom` takes the subject as the banner title
  // and the *opening paragraph* as the banner body, so writing anything else
  // first ("You have a new message.") would spend the one line a phone shows
  // on something the title already said. Quoting it first means the banner
  // carries what was actually written — which is the whole difference between
  // a notification worth tapping and a notification worth muting.
  //
  // The quote marks are load-bearing too: they stop the greeting filter in
  // `pushCopyFrom` from eating "Hi there," off the front of a real reply, and
  // they are what the email shell recognises to set the message apart.
  {
    key: "chat-admin-new",
    name: "Somebody wrote in chat (to you)",
    subject: "New chat message on {{store.name}}",
    body: `"{{chat.message}}"

From: {{customer.name}}
Email: {{customer.email}}
Phone: {{customer.phone}}
Unread messages: {{chat.unread}}

Reply from your admin:
{{chat.url}}`,
  },
  {
    key: "chat-reply",
    name: "We replied in chat",
    subject: "{{store.name}} replied to your message",
    body: `"{{chat.message}}"

That's our reply to your message. The chat on our website picks up right where you left off.

Continue the conversation:
{{chat.url}}

Or simply reply to this email.

Team {{store.name}}`,
  },

  /* ---- Stock: the owner's stockroom alert ---- */
  //
  // Written for somebody standing at a shelf with a phone: which unit (the SKU
  // is what is printed on the label) and where to fix it. The numbers that
  // matter — available, on the shelf, promised to open orders, and the line
  // this size is measured against — are the engine's table, because "2 on the
  // shelf, 2 promised" is an empty shelf and only the table puts them side by
  // side. The photograph and the size are its item card.
  //
  // The rule that sends it lives with the inventory work (`inventory.low_stock`
  // in `lib/automation.ts`). The tokens are the contract agreed with it:
  // `inventory.state` is "Low stock" | "Out of stock" | "Oversold",
  // `inventory.url` is an absolute link to the product in Admin → Inventory,
  // and the SKU is always filled — it names the size, so the bell entry says
  // which one even though it only shows the opening line. `inventory.variant`,
  // `.available`, `.onHand`, `.reserved` and `.threshold` are populated too,
  // for an owner who wants them in their own wording.
  {
    key: "inventory-low-stock",
    name: "Stock running low (to you)",
    subject: "{{inventory.state}}: {{inventory.productName}} ({{inventory.sku}})",
    body: `{{inventory.productName}} ({{inventory.sku}}) needs restocking.

Restock it or correct the count in Inventory:
{{inventory.url}}`,
  },
];
