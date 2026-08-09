import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { PolicyLayout, PolicySection } from "@/components/store/policy-layout";

export const metadata: Metadata = {
  title: "Shipping, Returns & Refunds",
  description:
    "Dispatch times, delivery estimates and free shipping across India, plus our returns, exchange and refund policy on tees and hoodies.",
  alternates: { canonical: "/shipping-returns" },
};

export default async function ShippingReturnsPage() {
  const s = await getSettings();

  return (
    <PolicyLayout
      eyebrow="Help"
      title="Shipping, Returns & Refunds"
      updated="1 August 2026"
      intro="How your parcel reaches you, and what happens if something is wrong with it."
    >
      <PolicySection title="Dispatch time">
        <p>
          Ready-made pieces are dispatched within <strong>2–4 business days</strong>{" "}
          of your order being confirmed. Custom commissions take longer — we
          agree a timeline with you before starting, typically 2–3 weeks
          depending on size and curing time.
        </p>
      </PolicySection>

      <PolicySection title="Delivery estimates">
        <p>
          Once dispatched, delivery usually takes:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Metro cities — 2–4 business days</li>
          <li>Other cities and towns — 4–7 business days</li>
          <li>Remote and north-eastern pincodes — 7–10 business days</li>
        </ul>
        <p>
          You will get a tracking number by email as soon as the parcel is
          handed to the courier.
        </p>
      </PolicySection>

      <PolicySection title="Shipping charges">
        <p>
          Shipping is calculated live at checkout from your pincode and the
          parcel&apos;s weight and size — no flat guesswork.
          {s.freeShippingThreshold
            ? ` Orders above ${"₹"}${s.freeShippingThreshold} ship free.`
            : ""}
        </p>
      </PolicySection>

      <PolicySection title="Packaging">
        <p>
          Every order ships in a sealed, tamper-evident poly mailer so your
          garment arrives clean and dry. If a parcel reaches you already open or
          visibly damaged, photograph it before unpacking — that photo makes a
          damage claim straightforward.
        </p>
      </PolicySection>

      <PolicySection title="Damaged or wrong items">
        <p>
          If your piece arrives broken, chipped, or is not what you ordered,
          tell us within <strong>48 hours of delivery</strong> with photographs
          of the item and its packaging. We will replace it, or refund you in
          full if a replacement is not possible. You pay nothing in this case.
        </p>
      </PolicySection>

      <PolicySection title="Returns">
        {/* Window and availability come from Admin > Returns so this page can
            never contradict what the order page actually allows. */}
        {s.returnsEnabled ? (
          <>
            <p>
              We accept returns on unworn, unwashed items with their original
              tags still attached. Got the size wrong? We will exchange it once,
              free of charge — see our{" "}
              <Link href="/terms" className="text-accent underline">
                terms
              </Link>
              .
            </p>
            <p className="text-foreground">
              Raise a return within{" "}
              <strong>
                {s.returnWindowDays} day{s.returnWindowDays === 1 ? "" : "s"} of
                delivery
              </strong>{" "}
              from your order page — open the confirmation link we emailed you, or
              find the order under{" "}
              <Link href="/account" className="text-accent underline">
                your account
              </Link>
              . Please keep the original packaging and add photos of the issue.
            </p>
            <p>
              Innerwear, socks and any personalised or made-to-order piece
              cannot be returned once dispatched, for hygiene reasons.
            </p>
            <p className="text-foreground">
              Whether a given item is returnable is shown on its product page.
            </p>
          </>
        ) : (
          <>
            <p className="text-foreground">
              We aren&apos;t accepting return requests online at the moment.
            </p>
            <p>
              If your piece arrived damaged, defective or incorrect, message us
              on WhatsApp or use the{" "}
              <Link href="/contact" className="text-accent underline">
                contact form
              </Link>{" "}
              with photos and we will put it right.
            </p>
          </>
        )}
      </PolicySection>

      <PolicySection title="Refunds">
        <p>
          Approved refunds are issued to the original payment method within{" "}
          <strong>5–7 business days</strong> of us receiving the returned item
          or approving a damage claim. Bank processing can add a few days at
          their end.
        </p>
        <p>
          For cash-on-delivery orders we refund by bank transfer — we will ask
          for your account details over email.
        </p>
      </PolicySection>

      <PolicySection title="Cancellations">
        <p>
          You can cancel any time before dispatch for a full refund. After
          dispatch, cancellation is not possible — refuse the delivery instead
          and we will refund once the parcel returns to us, minus the courier&apos;s
          return charge.
        </p>
      </PolicySection>

      <PolicySection title="Still need help?">
        <p>
          Email{" "}
          <a href={`mailto:${s.contactEmail}`} className="text-accent underline">
            {s.contactEmail}
          </a>
          {s.contactPhone ? ` or call ${s.contactPhone}` : ""}. Have your order
          number ready and we will sort it out.
        </p>
      </PolicySection>
    </PolicyLayout>
  );
}
