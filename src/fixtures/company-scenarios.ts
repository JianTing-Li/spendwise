import { Dataset, type CompanyId } from "../contracts";
import { baseline, companyExtras, injectedDataset } from "./scenarios";

const contexts = {
  hubspot: {
    vendors: [
      ["Summit Cloud Security", "Security subscriptions"],
      ["Meridian CRM Consulting", "CRM consulting"],
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

const extras = {
  hubspot: companyExtras("hubspot:", [
    { key: "hosting", name: "Skyline Cloud Hosting", category: "Cloud hosting", code: "SK", day: 3, sep: 1420000, oct: 1510000, item: "Cloud servers and storage", note: "Engineering note: October usage rose with the new customer onboarding launch." },
    { key: "cowork", name: "Officeline Coworking", category: "Office rent", code: "OC", day: 1, sep: 980000, oct: 980000, item: "Team office, 30 desks" },
    { key: "payroll", name: "PeopleFirst Payroll", category: "Payroll service", code: "PF", day: 15, sep: 115000, oct: 115000, item: "Payroll processing fee" },
    { key: "helpdesk", name: "Helpdesk Hub", category: "Support software", code: "HH", day: 7, sep: 240000, oct: 240000, item: "Customer support software seats" },
    { key: "fiber", name: "Metro Fiber Internet", category: "Internet and phone", code: "MF", day: 19, sep: 64000, oct: 64000, item: "Office internet and phone lines" },
    { key: "recruit", name: "Brightpath Recruiting", category: "Recruiting", code: "BR", day: 22, sep: 450000, oct: 225000, item: "Engineering recruiting fee" },
  ], { key: "legal", name: "Clearview Legal", category: "Legal counsel", code: "CL", monthly: 350000, item: "Monthly legal retainer", late: 720000, lateItem: "Customer contract reviews — August", note: "Accounts payable note: Clearview sent the August contract-review invoice late, so it was paid with the October payment run." },
  { key: "laptops", name: "Bluebird Laptop Leasing", category: "Laptop leasing", code: "BL", quarterly: 660000, item: "laptop lease (40 laptops)", note: "Vendor note: Bluebird moved to a new billing system in October and re-sent recent invoices with new numbers." }),
  gxo: companyExtras("gxo:", [
    { key: "fuel", name: "Interstate Fuel Supply", category: "Diesel fuel", code: "IF", day: 5, sep: 1840000, oct: 1990000, item: "Diesel for yard trucks", note: "Operations note: October fuel volume rose with peak-season shipments." },
    { key: "lease", name: "Harborview Warehouse Leasing", category: "Warehouse rent", code: "HW", day: 1, sep: 3200000, oct: 3200000, item: "East and west warehouse lease" },
    { key: "power", name: "PowerGrid Electric", category: "Electricity", code: "PG", day: 17, sep: 730000, oct: 785000, item: "Warehouse electricity" },
    { key: "pallets", name: "Northgate Pallet Co.", category: "Pallets", code: "NP", day: 8, sep: 310000, oct: 275000, item: "Wood pallets" },
    { key: "gps", name: "RouteTrack GPS", category: "Fleet tracking", code: "RT", day: 12, sep: 120000, oct: 120000, item: "Yard truck GPS tracking" },
    { key: "insure", name: "SafeHaul Insurance", category: "Cargo insurance", code: "SH", day: 20, sep: 475000, oct: 475000, item: "Monthly cargo insurance premium" },
  ], { key: "staffing", name: "Swift Temp Staffing", category: "Temporary workers", code: "ST", monthly: 1100000, item: "Temporary warehouse staff", late: 840000, lateItem: "Peak-season overtime staff — August", note: "Accounts payable note: Swift sent the August overtime invoice late, so it was paid with the October payment run." },
  { key: "inspect", name: "Keystone Safety Inspections", category: "Safety inspections", code: "KS", quarterly: 580000, item: "forklift and racking safety inspection", note: "Vendor note: Keystone moved to a new billing system in October and re-sent recent invoices with new numbers." }),
};

/** Preserve Roast fixtures exactly; new demos have distinct IDs and evidence. */
export function companyDataset(company: CompanyId, injected = false): Dataset {
  if (company === "roast") return structuredClone(injected ? injectedDataset() : baseline);
  const all = injected ? injectedDataset() : baseline;
  const original = new Set(["vendor-renewal", "vendor-duplicate", "vendor-lookalike"]);
  const source = {
    vendors: all.vendors.filter(v => original.has(v.id)),
    payments: all.payments.filter(p => original.has(p.vendorId)),
    invoices: all.invoices.filter(i => original.has(i.vendorId)),
    notes: all.notes.filter(n => original.has(n.vendorId)),
  };
  const c = contexts[company];
  const x = extras[company];
  const id = (value: string) => `${company}:${value}`;
  const vendorKeys = ["vendor-renewal", "vendor-duplicate", "vendor-lookalike"];
  const invoiceKeys = ["inv-renewal", "inv-advisory", "inv-design-a", "inv-design-b"];
  const monthly = (key: string) => key.startsWith("inv-renewal-") || (key.startsWith("pay-renewal-") && key !== "pay-renewal-annual");
  const amount = (key: string) => key === "inv-renewal" || key === "pay-renewal-annual" ? c.annual : monthly(key) ? c.monthly : key.includes("advisory") ? c.duplicate : c.separate;
  const month = (date: string) => date.startsWith("2026-09") ? "September" : "October";
  return Dataset.parse({
    vendors: [...source.vendors.map(v => { const position = vendorKeys.indexOf(v.id); return { id: id(v.id), name: c.vendors[position][0], category: c.vendors[position][1] }; }), ...x.vendors],
    payments: [...source.payments.map(p => ({ ...p, id: id(p.id), vendorId: id(p.vendorId), invoiceId: p.invoiceId ? id(p.invoiceId) : null,
      amountCents: amount(p.id), description: p.id === "pay-renewal-annual" ? c.annualText : monthly(p.id) ? `${c.monthlyText} — ${month(p.date)}` : p.id.includes("advisory") ? c.duplicateText : c.separateText })),
      ...x.baseline.payments, ...(injected ? x.injected.payments : [])],
    invoices: [...source.invoices.map(i => monthly(i.id)
      ? { ...i, id: id(i.id), vendorId: id(i.vendorId), number: `${c.invoiceNumbers[0].split("-")[0]}-${i.date.slice(5, 7)}01`, amountCents: c.monthly, lineItems: [`${c.monthlyText} — ${month(i.date)}`] }
      : (() => { const position = invoiceKeys.indexOf(i.id); return { ...i, id: id(i.id), vendorId: id(i.vendorId), number: c.invoiceNumbers[position], amountCents: amount(i.id), lineItems: [c.items[position]] }; })()),
      ...x.baseline.invoices, ...(injected ? x.injected.invoices : [])],
    notes: [...source.notes.map(n => ({ ...n, id: id(n.id), vendorId: id(n.vendorId), text: c.note, paymentIds: n.paymentIds.map(id), invoiceIds: n.invoiceIds.map(id) })),
      ...x.baseline.notes, ...(injected ? x.injected.notes : [])],
  });
}
