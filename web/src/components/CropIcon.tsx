const ICON: Record<string, string> = {
  maize: "🌽",
  sorghum: "🌾",
  millet: "🌾",
  beans: "🫘",
  cowpeas: "🫘",
  green_grams: "🫛",
  cassava_chips: "🥔",
  sweet_potato: "🍠",
  rice: "🍚",
  wheat_flour: "🌾",
  hermetic_bag: "🛍️",
  drip_kit: "💧",
  hand_tools: "⛏️",
};

export default function CropIcon({ cropId, form, big }: { cropId: string; form?: "food" | "seed" | "tool"; big?: boolean }) {
  return (
    <span className={`crop-icon ${big ? "big" : ""} ${form ?? ""}`} aria-hidden>
      {form === "seed" ? "🌱" : ICON[cropId] ?? "🌾"}
    </span>
  );
}
