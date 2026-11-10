import type { CompanyId } from "./contracts";

export const companies = [
  { id: "roast", name: "Roast & Co. Coffee", industry: "Coffee shop operations", context: "A fictional coffee business reviewing POS subscriptions, tax advisory and creative services.", examples: "Annual POS renewal · repeated advisory invoice · separate design projects" },
  { id: "hubspot", name: "HubSpot", industry: "Software & digital services", context: "Hypothetical U.S. business unit: security subscriptions, revenue-operations consulting and campaign production.", examples: "Annual security renewal · repeated consulting invoice · separate campaign projects" },
  { id: "gxo", name: "GXO Logistics", industry: "Warehousing & distribution", context: "Hypothetical U.S. business unit: automation servicing, equipment repair and facility cleaning.", examples: "Annual automation coverage · repeated repair invoice · separate warehouse jobs" },
] as const;

/** Fixed server-owned mapping. Vendor IDs, not model text, identify the demo. */
export const companyStateId = (id: CompanyId) => ({ roast: 1, hubspot: 2, gxo: 3 })[id];
export const vendorCompany = (id: string): CompanyId => id.startsWith("hubspot:") ? "hubspot" : id.startsWith("gxo:") ? "gxo" : "roast";
