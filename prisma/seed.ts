import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-");
}

// -------------------------------------------------------------------------
// Level7 Clothing real product catalogue (mirrored from level7clothing.com).
// Prices/options can be edited anytime from Admin → Products.
// category matches the real site's collections (Minimalistic/Premium tees, Hoodies).
// -------------------------------------------------------------------------
type SeedProduct = {
  name: string;
  category: string;
  secondaryCategory?: string | null;
  price: number;
  compareAtPrice?: number | null;
  description: string;
  tags: string[];
  stock: number;
  isFeatured?: boolean;
  isActive?: boolean; // false = hidden from the storefront
  images?: string[];
  options?: {
    name: string;
    choices: { label: string; priceDelta: number }[];
  }[];
};

const products: SeedProduct[] = [
  {
    name: "LEVEL7 Field Unisex Oversized T-Shirt",
    category: "Minimalistic Oversized T-shirts",
    price: 977,
    compareAtPrice: 1577,
    description: "Bottle green represents stability, balance, and grounding. A muted shade drawn from nature, chosen for its calm presence and versatility. The oversized, drop-shoulder silhouette keeps the design relaxed while maintaining a clean, considered form. Simple by design. Intentional in use.",
    tags: ["unisex","t-shirt","oversized","minimalistic","t-shirts"],
    stock: 60,
    isFeatured: true,
    images: [
          "/products/level7/BottleGreenFront2.png",
          "/products/level7/BottleGreenBack.png",
          "/products/level7/BottleGreenBack2.png",
          "/products/level7/BottleGreenFront3.png",
          "/products/level7/BottleGreenTexture.png",
          "/products/level7/BottleGreenFront.png"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "LEVEL7 Reserve Unisex Oversized T-Shirt",
    category: "Minimalistic Oversized T-shirts",
    price: 977,
    compareAtPrice: 1577,
    description: "Wine reflects depth, restraint, and maturity. A composed tone designed to feel deliberate rather than loud. The oversized, drop-shoulder fit gives the piece structure and ease, making it suitable for everyday wear without visual noise. Built for comfort. Defined by proportion.",
    tags: ["unisex","t-shirt","oversized","minimalistic","t-shirts"],
    stock: 60,
    isFeatured: true,
    images: [
          "/products/level7/Level7_Wine_Basic_Front_2.png",
          "/products/level7/Level7_Wine_Basic_Front.png",
          "/products/level7/Level7_Wine_Basic_Back_2.png",
          "/products/level7/Level7_Wine_Basic_Back.png",
          "/products/level7/Level7_Wine_Basic_Texture.png",
          "/products/level7/Level7_Wine_Basic_Full.png"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "LEVEL7 Axis Unisex Drop-Shoulder Hoodie",
    category: "Oversized Drop-Shoulder Hoodies",
    price: 1777,
    compareAtPrice: 3077,
    description: "Steel grey represents balance, precision, and restraint. A neutral tone designed to hold everything together—calm, stable, and uninterrupted. The color reflects focus without severity, making it adaptable across moments and settings. Constructed in an oversized, drop-shoulder silhouette that prioritizes structure, comfort, and proportion. Built to last. Designed to stay relevant.",
    tags: ["unisex","hoodie","oversized","drop-shoulder","hoodies"],
    stock: 0,
    isFeatured: false,
    isActive: false,
    images: [
          "/products/level7/Level7_Axis_Front.png",
          "/products/level7/Level7_Axis_Front2.png",
          "/products/level7/Level7_Axis_FrontStand.png",
          "/products/level7/Level7_Axis.png",
          "/products/level7/Level7_Axis_Side2.png"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "LEVEL7 Planetary Reset Unisex Drop-Shoulder Hoodie",
    category: "Oversized Drop-Shoulder Hoodies",
    price: 1977,
    compareAtPrice: 3577,
    description: "A visual exploration of reset and renewal. The planetary graphic represents cycles breaking and reforming—movement after stillness, clarity after chaos. Set against a warm tan base, the design balances cosmic scale with grounded tone, making the statement intentional rather than loud. Built on an oversized, drop-shoulder silhouette for relaxed structure and everyday wear.",
    tags: ["unisex","hoodie","oversized","drop-shoulder","hoodies"],
    stock: 60,
    isFeatured: false,
    images: [
          "/products/level7/Level7_Planet_Front.png",
          "/products/level7/Level7_PlanetBack.png",
          "/products/level7/Level7_Planet_FrontStand.png",
          "/products/level7/Level7_Planet_Seat.png"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "LEVEL7 Grounded Unisex Drop-Shoulder Hoodie",
    category: "Oversized Drop-Shoulder Hoodies",
    price: 1777,
    compareAtPrice: 3077,
    description: "Coffee reflects steadiness, warmth, and control. A neutral tone designed to anchor the look and slow the pace. Built for everyday wear where consistency matters more than attention.",
    tags: ["unisex","hoodie","oversized","drop-shoulder","hoodies"],
    stock: 60,
    isFeatured: false,
    images: [
          "/products/level7/Level7_Coffee_Grounded_Front.png",
          "/products/level7/Level7_Coffee_Grounded.png",
          "/products/level7/Level7_Coffee_Grounded_Back.png",
          "/products/level7/Level7_Coffee_Grounded_Side.png",
          "/products/level7/Level7_Coffee_Grounded_Side2.png"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "LEVEL7 Core Unisex Oversized Hoodie",
    category: "Oversized Drop-Shoulder Hoodies",
    price: 1777,
    compareAtPrice: 3077,
    description: "Black represents focus, discipline, and absolute clarity. Removed of distraction. Reduced to essentials. Designed to disappear—so your intent doesn’t.",
    tags: ["unisex","hoodie","oversized","drop-shoulder","hoodies"],
    stock: 60,
    isFeatured: true,
    images: [
          "/products/level7/Level7_Core_Front2.png",
          "/products/level7/Level7_Core.png",
          "/products/level7/Level7_Core_Back.png",
          "/products/level7/Level7_Core_Front.png",
          "/products/level7/Level7_Core_Side.png",
          "/products/level7/Level7_Core_Stand.png",
          "/products/level7/Level7_Core_Style.png",
          "/products/level7/Level7_Core_Walk.png"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "LEVEL7 Reserve Unisex Oversized Hoodie",
    category: "Oversized Drop-Shoulder Hoodies",
    price: 1777,
    compareAtPrice: 3077,
    description: "Wine reflects depth, maturity, and emotional control. A color associated with patience, restraint, and inner certainty. Designed for those who move with intention, not urgency.",
    tags: ["unisex","hoodie","oversized","drop-shoulder","hoodies"],
    stock: 60,
    isFeatured: false,
    images: [
          "/products/level7/Level7_Reserve.png",
          "/products/level7/Level7_Reserve_Back.png",
          "/products/level7/Level7_Reserve_Front.png",
          "/products/level7/Level7_Reserve_Front2.png",
          "/products/level7/Level7_Reserve_Side.png",
          "/products/level7/Level7_Reserve_Side2.png"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "LEVEL7 Foundation Unisex Drop-Shoulder Hoodie",
    category: "Oversized Drop-Shoulder Hoodies",
    price: 1777,
    compareAtPrice: 3077,
    description: "Royal blue stands for composure, depth, and quiet authority. Designed for clarity of mind and control of pace. No graphics. No excess. Just presence.",
    tags: ["unisex","hoodie","oversized","drop-shoulder","hoodies"],
    stock: 60,
    isFeatured: false,
    images: [
          "/products/level7/Level7_Foundation_Front.png",
          "/products/level7/Level7_Foundation.png",
          "/products/level7/Level7_Foundation_Back.png",
          "/products/level7/Level7_Foundation_Side.png",
          "/products/level7/Level7_Foundation_Side2.png"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "You are Loved Unisex Minimalistic Oversized T-shirt",
    category: "Minimalistic Oversized T-shirts",
    price: 1177,
    compareAtPrice: 1977,
    description: "Spread love with our 'You Are Loved' T-shirt. This inspiring design features the phrase \"You Are Loved\" surrounded by other elements, symbolizing the importance of love and its ability to connect people. Share love with the world and make a difference.",
    tags: ["unisex","t-shirt","oversized","minimalistic","t-shirts"],
    stock: 60,
    isFeatured: false,
    images: [
          "/products/level7/05.10.2024-171.jpg",
          "/products/level7/05.10.2024-163.jpg",
          "/products/level7/05.10.2024-160.jpg",
          "/products/level7/05.10.2024-167.jpg"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0},{"label":"2XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "Perception Unisex Minimalistic Oversized T-shirt",
    category: "Minimalistic Oversized T-shirts",
    price: 1177,
    compareAtPrice: 1577,
    description: "Change your perspective with our 'Perception' T-shirt. This inspiring graphic showcases the word \"Perception\" in a dynamic layout, encouraging you to challenge your assumptions and see things from a new angle. Expand your worldview.",
    tags: ["unisex","t-shirt","oversized","minimalistic","t-shirts"],
    stock: 60,
    isFeatured: false,
    images: [
          "/products/level7/05.10.2024-134.jpg",
          "/products/level7/05.10.2024-131.jpg",
          "/products/level7/05.10.2024-129.jpg",
          "/products/level7/05.10.2024-132.jpg",
          "/products/level7/05.10.2024-133.jpg"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0},{"label":"2XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "The Original Black Magic: Coffee Unisex Minimalistic Oversized T-shirt",
    category: "Minimalistic Oversized T-shirts",
    price: 1177,
    compareAtPrice: 2777,
    description: "Fuel your day with our 'Coffee: The Original Black Magic' T-shirt. This playful design features the phrase \"Black Magic\" in bold, highlighting the energizing power of coffee. Start your day off right with a cup of your favorite brew.",
    tags: ["unisex","t-shirt","oversized","minimalistic","t-shirts"],
    stock: 60,
    isFeatured: false,
    images: [
          "/products/level7/05.10.2024-099.jpg",
          "/products/level7/05.10.2024-108.jpg",
          "/products/level7/05.10.2024-102.jpg",
          "/products/level7/05.10.2024-103.jpg",
          "/products/level7/05.10.2024-105.jpg"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0},{"label":"2XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "Optimism Unisex Minimalistic Oversized T-shirt",
    category: "Minimalistic Oversized T-shirts",
    price: 1177,
    compareAtPrice: 1977,
    description: "Find your inner strength with our 'Optimism' T-shirt. This uplifting design features the word \"optimism\" in a bold font, encouraging you to maintain a positive outlook and see the bright side of life. Stay hopeful and persevere through challenges.",
    tags: ["unisex","t-shirt","oversized","minimalistic","t-shirts"],
    stock: 60,
    isFeatured: false,
    images: [
          "/products/level7/05.10.2024-093.jpg",
          "/products/level7/05.10.2024-087.jpg",
          "/products/level7/05.10.2024-084.jpg",
          "/products/level7/05.10.2024-090.jpg",
          "/products/level7/05.10.2024-091.jpg"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0},{"label":"2XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "Rizz Unisex Minimalistic Oversized T-shirt",
    category: "Minimalistic Oversized T-shirts",
    price: 1177,
    compareAtPrice: 1877,
    description: "Unleash your potential with our 'Rizz' T-shirt. This motivational graphic showcases the message that vision is key to success. Believe in yourself, find your vision and make it a reality.",
    tags: ["unisex","t-shirt","oversized","minimalistic","t-shirts"],
    stock: 60,
    isFeatured: false,
    images: [
          "/products/level7/05.10.2024-094.jpg",
          "/products/level7/05.10.2024-083.jpg",
          "/products/level7/05.10.2024-074.jpg",
          "/products/level7/05.10.2024-078.jpg",
          "/products/level7/05.10.2024-077.jpg",
          "/products/level7/05.10.2024-081.jpg"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0},{"label":"2XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "Stay Resilient Unisex Minimalistic Oversized T-shirt",
    category: "Minimalistic Oversized T-shirts",
    price: 1177,
    compareAtPrice: 2777,
    description: "Embrace resilience with our 'Stay Resilient' T-shirt. This empowering design features the word \"resilient\" in bold, inspiring you to overcome challenges and bounce back stronger. Build your resilience and face adversity with courage.",
    tags: ["unisex","t-shirt","oversized","minimalistic","t-shirts"],
    stock: 0,
    isFeatured: false,
    isActive: false,
    images: [
          "/products/level7/05.10.2024-029.jpg",
          "/products/level7/05.10.2024-045.jpg",
          "/products/level7/05.10.2024-031.jpg",
          "/products/level7/05.10.2024-033.jpg",
          "/products/level7/05.10.2024-042.jpg",
          "/products/level7/05.10.2024-063.jpg"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0},{"label":"2XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "Make it 7 Unisex Premium Oversized T-shirt",
    category: "Premium Oversized T-shirts",
    price: 1477,
    compareAtPrice: 2477,
    description: "Embrace the challenge and make it 7 with our 'Just Make It 7' T-shirt. This motivational design features a basketball surrounded by energy, symbolizing the determination and perseverance needed to succeed. Step up to the challenge and prove yourself.",
    tags: ["unisex","t-shirt","oversized","premium","t-shirts"],
    stock: 60,
    isFeatured: false,
    images: [
          "/products/level7/05.10.2024-097.jpg",
          "/products/level7/05.10.2024-071.jpg",
          "/products/level7/05.10.2024-064.jpg",
          "/products/level7/05.10.2024-066.jpg",
          "/products/level7/05.10.2024-069.jpg"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0},{"label":"2XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "Checkmate Knight Unisex Premium Oversized T-shirt",
    category: "Premium Oversized T-shirts",
    price: 1477,
    compareAtPrice: 2997,
    description: "Dominate the board with our 'Checkmate Knight' T-shirt. This captivating graphic showcases a knight leading a charge across the chessboard, symbolizing victory, strategy, and tactical brilliance. Achieve checkmate and reign supreme.",
    tags: ["unisex","t-shirt","oversized","premium","t-shirts"],
    stock: 60,
    isFeatured: true,
    images: [
          "/products/level7/05.10.2024-175.jpg",
          "/products/level7/05.10.2024-182.jpg",
          "/products/level7/05.10.2024-174.jpg",
          "/products/level7/05.10.2024-177.jpg",
          "/products/level7/05.10.2024-180.jpg"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0},{"label":"2XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "Chase Dream Unisex Premium Oversized T-shirt",
    category: "Premium Oversized T-shirts",
    price: 1477,
    compareAtPrice: 2277,
    description: "Soar to new heights with our 'Chase Dreams' T-shirt. This inspiring design features a butterfly taking flight, symbolizing transformation, freedom, and the pursuit of dreams. Believe in yourself and let your imagination take you anywhere.",
    tags: ["unisex","t-shirt","oversized","premium","t-shirts"],
    stock: 60,
    isFeatured: false,
    images: [
          "/products/level7/05.10.2024-191.jpg",
          "/products/level7/05.10.2024-188.jpg",
          "/products/level7/05.10.2024-185.jpg",
          "/products/level7/05.10.2024-189.jpg",
          "/products/level7/05.10.2024-190.jpg"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0},{"label":"2XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "Off the Wall Unisex Premium Oversized T-shirt",
    category: "Premium Oversized T-shirts",
    price: 1477,
    compareAtPrice: 2177,
    description: "Challenge the status quo with our 'Off the Wall' T-shirt. This bold graphic showcases a bulldog defying expectations, perfect for those who dare to be different. Embrace your individuality and skate outside the box.",
    tags: ["unisex","t-shirt","oversized","premium","t-shirts"],
    stock: 60,
    isFeatured: false,
    images: [
          "/products/level7/05.10.2024-138.jpg",
          "/products/level7/05.10.2024-148.jpg",
          "/products/level7/05.10.2024-142.jpg",
          "/products/level7/05.10.2024-143.jpg",
          "/products/level7/05.10.2024-141.jpg"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0},{"label":"2XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "Samurai Unisex Premium Oversized",
    category: "Premium Oversized T-shirts",
    price: 1477,
    compareAtPrice: 2377,
    description: "Master the art of stealth with our 'Samurai' T-shirt. This graphic features a legendary samurai, ready for battle, symbolizing courage, strength, and unwavering dedication. Channel the power of the samurai and become a force to be reckoned with.",
    tags: ["unisex","t-shirt","oversized","premium","t-shirts"],
    stock: 60,
    isFeatured: true,
    images: [
          "/products/level7/05.10.2024-124.jpg",
          "/products/level7/05.10.2024-128.jpg",
          "/products/level7/05.10.2024-122.jpg",
          "/products/level7/05.10.2024-123.jpg",
          "/products/level7/05.10.2024-126.jpg"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0},{"label":"2XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "Knight Warrior Unisex Premium Oversized T-shirts",
    category: "Premium Oversized T-shirts",
    price: 1477,
    compareAtPrice: 2397,
    description: "Become a part of the warrior's creed with our 'Knight Warriors' T-shirt. This inspiring design features a knight standing tall, embodying the qualities of courage, strength, and perseverance. It's a must-have for anyone who seeks to live a life of honor and integrity.",
    tags: ["unisex","t-shirt","oversized","premium","t-shirts"],
    stock: 60,
    isFeatured: false,
    images: [
          "/products/level7/05.10.2024-056.jpg",
          "/products/level7/05.10.2024-049.jpg",
          "/products/level7/05.10.2024-047.jpg",
          "/products/level7/05.10.2024-052.jpg",
          "/products/level7/05.10.2024-055.jpg"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0},{"label":"2XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "Explore Unisex Premium Oversized T-shirt",
    category: "Premium Oversized T-shirts",
    price: 1477,
    compareAtPrice: 2777,
    description: "Experience the freedom of the open road with our 'Wander on Wheels' T-shirt. This bold graphic showcases a rider on a sleek electric scooter, ready to explore the city at your own pace. It's a perfect way to express your love for adventure and urban living",
    tags: ["unisex","t-shirt","oversized","premium","t-shirts"],
    stock: 60,
    isFeatured: false,
    images: [
          "/products/level7/05.10.2024-114.jpg",
          "/products/level7/05.10.2024-119.jpg",
          "/products/level7/05.10.2024-110.jpg",
          "/products/level7/05.10.2024-117.jpg",
          "/products/level7/05.10.2024-113.jpg"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0},{"label":"2XL","priceDelta":0}],
      },
    ],
  },
  {
    name: "Voyager Space Unisex Premium Oversized T-shirt",
    category: "Premium Oversized T-shirts",
    price: 1477,
    compareAtPrice: 3377,
    description: "Unleash your inner explorer with our 'Voyager Space' Premium Oversized T-shirt. Featuring a bold spaceship and brave astronaut, this futuristic design will transport you to the stars. Made with premium materials, it's the perfect addition to any stylish wardrobe. Are you ready to take on the universe",
    tags: ["unisex","t-shirt","oversized","premium","t-shirts"],
    stock: 0,
    isFeatured: true,
    isActive: false,
    images: [
          "/products/level7/05.10.2024-011.jpg",
          "/products/level7/05.10.2024-021.jpg",
          "/products/level7/05.10.2024-012.jpg",
          "/products/level7/05.10.2024-018.jpg",
          "/products/level7/05.10.2024-017.jpg",
          "/products/level7/05.10.2024-027.jpg"
    ],
    options: [
      {
        name: "Size",
        choices: [{"label":"S","priceDelta":0},{"label":"M","priceDelta":0},{"label":"L","priceDelta":0},{"label":"XL","priceDelta":0},{"label":"2XL","priceDelta":0}],
      },
    ],
  },
];

async function main() {
  // Settings (single row)
  await prisma.siteSettings.upsert({
    where: { id: "main" },
    update: {},
    create: { id: "main" },
  });
  console.log("✓ Site settings ready");

  // Admin user
  const email = (process.env.ADMIN_EMAIL || "admin@level7clothing.com").toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "level7admin123";
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.adminUser.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash, name: "Admin" },
  });
  console.log(`✓ Admin ready → ${email} / ${password}`);

  // Demo customer account (for trying the login + order tracking flow)
  const demoEmail = "customer@level7clothing.com";
  const demoPassword = "customer123";
  await prisma.user.upsert({
    where: { email: demoEmail },
    update: {},
    create: {
      email: demoEmail,
      name: "Demo Customer",
      phone: "+91 90000 11111",
      passwordHash: await bcrypt.hash(demoPassword, 10),
    },
  });
  console.log(`✓ Demo customer → ${demoEmail} / ${demoPassword}`);

  // -----------------------------------------------------------------------
  // Products: reset the catalogue to Level7 Clothing's real product list.
  // (Removes any old demo/sample products so the store shows only real items.)
  // NOTE: this replaces ALL products — once you start editing products in the
  // admin panel, don't re-run the seed or it will reset them to this list.
  // -----------------------------------------------------------------------
  await prisma.product.deleteMany({});
  for (const p of products) {
    const slug = slugify(p.name);
    await prisma.product.create({
      data: {
        name: p.name,
        slug,
        description: p.description,
        category: p.category,
        secondaryCategory: p.secondaryCategory ?? null,
        tags: p.tags,
        price: p.price,
        compareAtPrice: p.compareAtPrice ?? null,
        images: p.images ?? [],
        options: p.options ?? [],
        stock: p.stock,
        isFeatured: p.isFeatured ?? false,
        isActive: p.isActive ?? true,
      },
    });
  }
  console.log(`✓ Loaded ${products.length} real Level7 Clothing products`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
