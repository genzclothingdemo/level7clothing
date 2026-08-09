// 1. Attributes (Layer 2)
export type Attribute = {
  name: string;      // e.g., "Design", "Size"
  values: string[];  // e.g., ["Pink", "White"]
};

// 2. Property Modules
export type PropertyDependencies = {
  price: string[];    // e.g., ["Design", "Size"]
  images: string[];   // e.g., ["Design"]
  stock: string[];    // e.g., ["Design", "Size", "Bowls"]
  weight: string[];   // e.g., ["Size"]
};

// 3. Rules (Layer 3)
export type RuleMatch = Record<string, string>; // e.g., { Design: "Pink", Size: "8" }

export type Rule<T> = {
  match: RuleMatch;
  value: T;
};

export type ProductRules = {
  price: Rule<number>[];
  images: Rule<string[]>[];
  stock: Rule<number>[];
  weight: Rule<number>[];
};

// 4. Generated Sellable Variants
export type SellableVariant = {
  id: string; // SKU or hash
  combo: Record<string, string>;
  price: number;
  images: string[];
  stock: number;
  weight: number;
  available: boolean;
};

// Keeping ProductOption / OptionChoice for backwards compatibility or rename them
export type ProductOption = {
  name: string;
  choices: OptionChoice[];
};
export type OptionChoice = {
  label: string;
  priceDelta?: number;
};

// legacy (ignored, but kept in types for compilation / db schema)
export type VariantPrice = { combo: Record<string, string>; price: number };
export type Variant = {
  combo: Record<string, string>;
  price: number;
  available: boolean;
  images: string[];
  previewImage?: string | null;
};
/** One admin-added video link: a title and the URL it was copied from. */
export type ProductVideo = { title: string; url: string };

// A customer's picked option on a cart/order line, e.g. { name: "Size", value: "Large" }
export type SelectedOption = { name: string; value: string };

// Which checkout modes a product supports.
export type PaymentMode = "prepaid" | "cod" | "partial" | "direct";

export type CartItem = {
  lineId: string; // productId + selected options — unique per variant combination
  productId: string;
  slug: string;
  name: string;
  image: string;
  price: number; // unit price INCLUDING selected option price deltas
  quantity: number;
  stock: number;
  options?: SelectedOption[];
  note?: string;
};

export type MediaDTO = {
  id: string;
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  slot?: string;
  variantValue?: string | null;
  /** Position within its (variant/common) group; used to order the gallery. */
  sortOrder?: number;
  // Variant tagging metadata
  variantAttribute?: string | null;
  subcategoryName?: string | null;
};

/**
 * Represents one visual variant's gallery in the new Media tab.
 * e.g. { variantValue: "Pink", images: [...], previewImage: "..." }
 */
export type VisualVariantGallery = {
  /** null means "Common" gallery — images shown for all variants */
  variantValue: string | null;
  images: string[];
  previewImage: string | null;
};

/** A photo item returned by the media API, enriched with smart tags. */
export type MediaLibraryItem = {
  id: string;
  url: string;
  file: string;
  category: string;
  group: string;
  source: "repo" | "blob" | "external";
  variantAttribute: string | null;
  variantValue: string | null;
  subcategoryName: string | null;
  size?: number | null;
  width?: number | null;
  height?: number | null;
  createdAt?: string;
};

export type ProductDTO = {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  secondaryCategory: string | null;
  /** Group inside the primary category; null = shown directly on the category page. */
  subcategoryId: string | null;
  tags: string[];
  options: ProductOption[];
  attributes?: Attribute[];
  propertyModules?: PropertyDependencies;
  rules?: ProductRules;
  sellableVariants?: SellableVariant[];
  variantPrices: VariantPrice[];
  variants: Variant[];
  price: number;
  compareAtPrice: number | null;
  images: string[];
  media?: MediaDTO[];
  stock: number;
  paymentModes: PaymentMode[];
  advancePercent: number | null;
  weightGrams: number | null;
  lengthCm: number | null;
  breadthCm: number | null;
  heightCm: number | null;
  shippingType: string;
  shippingFee: number;
  shippingMarkup: number;
  /**
   * Product-page info blocks. `null` = inherit the store default from
   * SettingsDTO.default*; a string overrides it for this product. One line per
   * bullet. Resolve with `resolveProductInfo()` — never read these directly.
   */
  materialsCare: string | null;
  shippingInfo: string | null;
  returnsInfo: string | null;
  /** null = inherit SettingsDTO.defaultReturnable. Resolve via resolveReturnPolicy(). */
  returnable: boolean | null;
  /** Admin-added social/video links, rendered as the Video previews rail. */
  videos: ProductVideo[];
  isFeatured: boolean;
  isActive: boolean;
};

export type SettingsDTO = {
  brandName: string;
  tagline: string;
  logoUrl: string | null;
  heroHeadline: string;
  heroSubtext: string;
  aboutText: string;
  contactEmail: string;
  contactPhone: string;
  whatsapp: string | null;
  address: string | null;
  instagram: string | null;
  facebook: string | null;
  adminNotifyEmail: string;
  currency: string;
  freeShippingThreshold: number | null;
  codEnabled: boolean;
  prepaidEnabled: boolean;
  partialEnabled: boolean;
  directEnabled: boolean;
  razorpayEnabled: boolean;
  nimbusEnabled: boolean;
  announcement: string | null;
  /**
   * Store-wide defaults for the product page's info accordion — used by every
   * product that doesn't override them. One line per bullet; blank hides the
   * section on the product page.
   */
  defaultMaterialsCare: string;
  defaultShippingInfo: string;
  defaultReturnsInfo: string;
  /** Returns — see resolveReturnPolicy(). Managed in Admin > Returns. */
  returnsEnabled: boolean;
  defaultReturnable: boolean;
  returnWindowDays: number;
};
