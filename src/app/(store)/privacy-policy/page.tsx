import { PolicyLayout, PolicySection } from "@/components/store/policy-layout";

export const metadata = {
  title: "Privacy Policy",
  description:
    "How Level7 Clothing collects, uses and protects your personal data.",
  alternates: { canonical: "/privacy-policy" },
};

export default function PrivacyPolicyPage() {
  return (
    <PolicyLayout
      eyebrow="Your data"
      title="Privacy Policy"
      updated="31 July 2026"
    >
      <PolicySection title="What we collect">
        <p>
          When you place an order or contact us, we collect your name,
          email, phone number, shipping address and order details. We never
          store your card details — payments are processed securely by our
          payment partner.
        </p>
      </PolicySection>

      <PolicySection title="How we use your data">
        <p>
          We use your information to process and deliver orders, send order
          updates, respond to enquiries, and — only with your consent — send
          you offers and new-drop announcements.
        </p>
      </PolicySection>

      <PolicySection title="Sharing">
        <p>
          We share order details only with the courier and payment partners
          needed to fulfil your order. We never sell your personal data to
          third parties.
        </p>
      </PolicySection>

      <PolicySection title="Your rights">
        <p>
          You can request a copy of, correction to, or deletion of your
          personal data at any time by contacting us at the email listed on
          our Contact page.
        </p>
      </PolicySection>
    </PolicyLayout>
  );
}
