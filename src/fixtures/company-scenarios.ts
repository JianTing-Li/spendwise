import { Dataset, type CompanyId } from "../contracts";
import { baseline, injectedDataset } from "./scenarios";

const contexts = {
  hubspot: {
    vendors: [
      ["Summit Cloud Security", "Security subscriptions"],
      ["Meridian Revenue Operations", "Implementation consulting"],
      ["Beacon Campaign Studio", "Campaign production"],
    ],
    monthly: 200000, annual: 2400000, duplicate: 600000, separate: 200000,
    monthlyText: "Monthly security monitoring", annualText: "Annual endpoint security platform subscription",
    duplicateText: "Revenue-operations migration consulting", separateText: "Campaign production payment",
    invoiceNumbers: ["SC-2026", "MR-101", "BC-201", "BC-202"],
    items: ["Annual endpoint security platform subscription", "CRM data migration and workflow configuration", "Product launch email campaign artwork", "Customer education webinar production"],
    note: "Synthetic finance note: Annual endpoint security subscription renewal of $24,000, covering October 2026 through September 2027. Monthly monitoring is a separate service.",
  },
  gxo: {
    vendors: [
      ["Atlas Automation Services", "Warehouse automation servicing"],
      ["Dockside Equipment Care", "Forklift repairs"],
      ["Clearway Facility Services", "Warehouse facilities"],
    ],
    monthly: 400000, annual: 1800000, duplicate: 450000, separate: 220000,
    monthlyText: "Monthly conveyor monitoring", annualText: "Annual warehouse robotics service coverage",
    duplicateText: "Forklift hydraulic repair payment", separateText: "Warehouse facility cleaning payment",
    invoiceNumbers: ["AA-2026", "DE-101", "CF-201", "CF-202"],
    items: ["Annual warehouse robotics service coverage", "Forklift FL-17 hydraulic system repair", "East warehouse loading-area deep clean", "West warehouse storage-area deep clean"],
    note: "Synthetic finance note: Annual warehouse robotics service coverage of $18,000, covering October 2026 through September 2027. Monthly conveyor monitoring is a separate service.",
  },
} as const;

/** Preserve Roast fixtures exactly; new demos have distinct IDs and evidence. */
export function companyDataset(company: CompanyId, injected = false): Dataset {
  if (company === "roast") return structuredClone(injected ? injectedDataset() : baseline);
  const source = injected ? injectedDataset() : baseline;
  const c = contexts[company];
  const id = (value: string) => `${company}:${value}`;
  const vendorKeys = ["vendor-renewal", "vendor-duplicate", "vendor-lookalike"];
  const invoiceKeys = ["inv-renewal", "inv-advisory", "inv-design-a", "inv-design-b"];
  const amount = (key: string) => key === "inv-renewal" || key === "pay-renewal-annual" ? c.annual : key.startsWith("pay-renewal-") ? c.monthly : key.includes("advisory") ? c.duplicate : c.separate;
  return Dataset.parse({
    vendors: source.vendors.map(v => { const position = vendorKeys.indexOf(v.id); return { id: id(v.id), name: c.vendors[position][0], category: c.vendors[position][1] }; }),
    payments: source.payments.map(p => ({ ...p, id: id(p.id), vendorId: id(p.vendorId), invoiceId: p.invoiceId ? id(p.invoiceId) : null,
      amountCents: amount(p.id), description: p.id === "pay-renewal-annual" ? c.annualText : p.id.startsWith("pay-renewal-") ? `${c.monthlyText} — ${p.date.startsWith("2026-09") ? "September" : "October"}` : p.id.includes("advisory") ? c.duplicateText : c.separateText })),
    invoices: source.invoices.map(i => { const position = invoiceKeys.indexOf(i.id); return { ...i, id: id(i.id), vendorId: id(i.vendorId), number: c.invoiceNumbers[position], amountCents: amount(i.id), lineItems: [c.items[position]] }; }),
    notes: source.notes.map(n => ({ ...n, id: id(n.id), vendorId: id(n.vendorId), text: c.note, paymentIds: n.paymentIds.map(id), invoiceIds: n.invoiceIds.map(id) })),
  });
}
