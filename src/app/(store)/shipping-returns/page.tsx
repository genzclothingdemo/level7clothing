import { PolicyLayout, PolicySection } from "@/components/store/policy-layout";

export const metadata = {
  title: "Shipping & Returns",
  description:
    "Delivery timelines across India, cash on delivery availability, and our 7-day return and exchange policy.",
  alternates: { canonical: "/shipping-returns" },
};

export default function ShippingReturnsPage() {
  return (
    <PolicyLayout
      eyebrow="Good to know"
      title="Shipping & Returns"
      updated="31 July 2026"
    >
      <PolicySection title="Shipping">
        <p>
          Orders are processed within 1–2 business days and delivered within
          4–7 business days across India, depending on your location. You
          will receive a tracking link by email/SMS once your order ships.
        </p>
        <p>
          Cash on Delivery (COD) is available on eligible pin codes. Prepaid
          orders may qualify for free shipping — check the announcement bar
          on our homepage for current offers.
        </p>
      </PolicySection>

      <PolicySection title="Returns & exchanges">
        <p>
          We accept returns and exchanges within 7 days of delivery, provided
          the item is unused, unwashed and has its original tags attached.
          Custom or made-to-order pieces are not eligible for return unless
          defective.
        </p>
        <p>
          To start a return or exchange, contact us with your order number
          and reason for return. Once approved, we&apos;ll arrange a pickup
          or share return instructions.
        </p>
      </PolicySection>

      <PolicySection title="Refunds">
        <p>
          Refunds for prepaid orders are processed to the original payment
          method within 5–7 business days of us receiving the returned item.
          COD order refunds are processed via bank transfer or UPI.
        </p>
      </PolicySection>

      <PolicySection title="Damaged or wrong items">
        <p>
          If you receive a damaged, defective or incorrect item, contact us
          within 48 hours of delivery with photos of the product and
          packaging, and we&apos;ll make it right — replacement or refund, no
          questions asked.
        </p>
      </PolicySection>
    </PolicyLayout>
  );
}
