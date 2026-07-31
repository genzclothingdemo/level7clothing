import { PolicyLayout, PolicySection } from "@/components/store/policy-layout";

export const metadata = {
  title: "Terms & Conditions",
  description:
    "The terms that apply when you order from Level7 Clothing.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <PolicyLayout
      eyebrow="The fine print"
      title="Terms & Conditions"
      updated="31 July 2026"
    >
      <PolicySection title="Orders">
        <p>
          By placing an order on this site, you confirm that the shipping
          and contact details provided are accurate. We reserve the right to
          cancel any order due to stock unavailability or suspected fraud.
        </p>
      </PolicySection>

      <PolicySection title="Pricing">
        <p>
          All prices are listed in INR and inclusive of applicable taxes
          unless stated otherwise. We may update prices at any time; the
          price shown at checkout is final for that order.
        </p>
      </PolicySection>

      <PolicySection title="Product accuracy">
        <p>
          We try to display product colours and sizing as accurately as
          possible, but slight variations may occur due to screen settings
          and manufacturing.
        </p>
      </PolicySection>

      <PolicySection title="Intellectual property">
        <p>
          All designs, graphics and content on this site are the property of
          Level7 Clothing and may not be reproduced without permission.
        </p>
      </PolicySection>

      <PolicySection title="Governing law">
        <p>
          These terms are governed by the laws of India. Any disputes will
          be subject to the jurisdiction of the courts in our registered
          business location.
        </p>
      </PolicySection>
    </PolicyLayout>
  );
}
