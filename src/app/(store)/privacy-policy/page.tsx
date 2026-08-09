import type { Metadata } from "next";
import { getSettings } from "@/lib/settings";
import { PolicyLayout, PolicySection } from "@/components/store/policy-layout";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How we collect, use and protect your personal information when you shop with us — payments, shipping, cookies and your rights.",
  alternates: { canonical: "/privacy-policy" },
};

export default async function PrivacyPolicyPage() {
  const s = await getSettings();

  return (
    <PolicyLayout
      eyebrow="Legal"
      title="Privacy Policy"
      updated="1 August 2026"
      intro={`This policy explains what ${s.brandName} collects when you browse or buy, why we collect it, and what control you have over it.`}
    >
      <PolicySection title="What we collect">
        <p>
          When you place an order we collect your name, email address, phone
          number and delivery address. That is the minimum required to make and
          deliver a physical parcel to you.
        </p>
        <p>
          If you create an account we also store a securely hashed version of
          your password. We never store your password in readable form and
          cannot recover it for you — only reset it.
        </p>
        <p>
          We do <strong>not</strong> collect or store your card, UPI or netbanking
          details at any point. Online payments are handled entirely by Razorpay
          on their own systems.
        </p>
      </PolicySection>

      <PolicySection title="How we use it">
        <ul className="list-disc space-y-2 pl-5">
          <li>To process, pack and deliver your order.</li>
          <li>To send order confirmations and delivery updates.</li>
          <li>To respond when you contact us about a piece or an order.</li>
          <li>To meet tax and accounting obligations under Indian law.</li>
        </ul>
        <p>
          We do not sell, rent or trade your personal information to anyone, for
          any purpose.
        </p>
      </PolicySection>

      <PolicySection title="Who we share it with">
        <p>
          Your details are shared only with the partners needed to complete your
          order, and only the parts they need:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Our courier partner</strong> — your name, address and phone
            number, so the parcel can reach you.
          </li>
          <li>
            <strong>Razorpay</strong> — handles the payment directly; we receive
            only a confirmation that it succeeded.
          </li>
          <li>
            <strong>Our email provider</strong> — delivers order and account
            emails to your inbox.
          </li>
        </ul>
      </PolicySection>

      <PolicySection title="Cookies">
        <p>
          We use a small number of cookies to keep you signed in, remember your
          cart between visits, and remember whether you prefer light or dark
          mode. Blocking them in your browser will not stop you browsing, but
          your cart and session will not persist.
        </p>
      </PolicySection>

      <PolicySection title="How long we keep it">
        <p>
          Order records are retained as long as required for tax and accounting
          purposes. Account details are kept until you ask us to delete them.
        </p>
      </PolicySection>

      <PolicySection title="Your rights">
        <p>
          You can ask us to show you what we hold about you, correct anything
          wrong, or delete your account and its data. Write to{" "}
          <a href={`mailto:${s.contactEmail}`} className="text-accent underline">
            {s.contactEmail}
          </a>{" "}
          and we will respond within 30 days. Deletion requests cannot remove
          invoice records we are legally required to retain.
        </p>
      </PolicySection>

      <PolicySection title="Contact">
        <p>
          Questions about this policy? Email{" "}
          <a href={`mailto:${s.contactEmail}`} className="text-accent underline">
            {s.contactEmail}
          </a>
          {s.contactPhone ? ` or call ${s.contactPhone}` : ""}.
          {s.address ? ` Our studio address is ${s.address}.` : ""}
        </p>
      </PolicySection>
    </PolicyLayout>
  );
}
