"use client";

import { usePathname } from "next/navigation";
import SparkField from "./SparkField";
import NebulaField from "./NebulaField";
import JewelField from "./JewelField";

// Route-aware background layer. Imaginarium shows a cosmic nebula (dreamy
// greens/blues/purples); Wonders shows a glinty jewel box (crystal pools +
// twinkling facets); everywhere else shows the default ember spark field.
export default function BackgroundField() {
  const pathname = usePathname();
  if (pathname?.startsWith("/imaginarium")) return <NebulaField />;
  if (pathname?.startsWith("/wonders")) return <JewelField />;
  return <SparkField />;
}
