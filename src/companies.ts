import type { CompanyId } from "./contracts";

/** Display names are fictional. IDs are internal and stay stable for stored data. */
export const companies = [
  { id: "roast", slug: "roast", name: "Roast & Co. Coffee", industry: "Coffee shop", context: "A neighborhood coffee shop paying its regular suppliers." },
  { id: "hubspot", slug: "larkspur", name: "Larkspur Software", industry: "B2B software", context: "A software company paying for hosting, offices and services." },
  { id: "gxo", slug: "ironbridge", name: "Ironbridge Logistics", industry: "Warehousing", context: "A warehouse operator paying for fuel, staff and equipment upkeep." },
] as const;
/** Accepts a public slug or an internal ID from the page URL. */
export const companyFromParam = (value: unknown): CompanyId | null =>
  companies.find(c => c.slug === value || c.id === value)?.id ?? null;

/** Fixed server-owned mapping. Vendor IDs, not model text, identify the demo. */
export const companyStateId = (id: CompanyId) => ({ roast: 1, hubspot: 2, gxo: 3 })[id];
export const vendorCompany = (id: string): CompanyId => id.startsWith("hubspot:") ? "hubspot" : id.startsWith("gxo:") ? "gxo" : "roast";
