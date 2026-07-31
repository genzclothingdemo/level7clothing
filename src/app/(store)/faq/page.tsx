import { Reveal } from "@/components/store/reveal";
import { FaqAccordion } from "@/components/store/faq-accordion";

export const metadata = {
  title: "FAQ",
  description:
    "Answers on sizing and fit, fabric quality, delivery times, cash on delivery and our return policy.",
  alternates: { canonical: "/faq" },
};

const FAQS = [
  {
    q: "What sizes do you offer?",
    a: "Most tees and hoodies come in S, M, L, XL and 2XL. Every product page has a size guide — check it before ordering since our fits run oversized.",
  },
  {
    q: "Are Level7 tees and hoodies true to size?",
    a: "Our pieces are designed with an intentional oversized, drop-shoulder fit. If you prefer a slimmer fit, we'd recommend sizing down by one size.",
  },
  {
    q: "What is your fabric quality?",
    a: "We use heavyweight cotton fabric for a premium look and feel, built to hold its shape and colour wash after wash.",
  },
  {
    q: "Do you offer Cash on Delivery?",
    a: "Yes, Cash on Delivery is available on eligible pin codes alongside prepaid online payment.",
  },
  {
    q: "How long does delivery take?",
    a: "Orders are usually dispatched within 1–2 business days and delivered within 4–7 business days across India, depending on your location.",
  },
  {
    q: "What is your return / exchange policy?",
    a: "We accept returns and exchanges within 7 days of delivery for unused items with tags intact. See our Shipping & Returns page for full details.",
  },
  {
    q: "How do I track my order?",
    a: "Use the Track Order page with your order number, or log in to My Account to see all your order history and live status.",
  },
  {
    q: "Do you do custom or bulk orders?",
    a: "Yes — for custom prints, team merch or bulk orders, reach out via our Contact page and we'll get back to you with pricing and timelines.",
  },
];

export default function FaqPage() {
  return (
    <div className="container-px mx-auto max-w-3xl py-16">
      <Reveal>
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Need help?
          </p>
          <h1 className="mt-3 font-serif text-5xl leading-tight">
            Frequently asked questions
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Everything you need to know about sizing, shipping and returns.
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.08}>
        <div className="mt-12">
          <FaqAccordion items={FAQS} />
        </div>
      </Reveal>
    </div>
  );
}
