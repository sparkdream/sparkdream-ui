"use client";

import { usePathname } from "next/navigation";
import SparkField from "./SparkField";
import NebulaField from "./NebulaField";

// Route-aware background layer. Imaginarium shows a cosmic nebula (dreamy
// greens/blues/purples); everywhere else shows the default ember spark field.
export default function BackgroundField() {
  const pathname = usePathname();
  if (pathname?.startsWith("/imaginarium")) return <NebulaField />;
  return <SparkField />;
}
