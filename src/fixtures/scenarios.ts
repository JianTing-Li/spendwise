import { Faker, en } from "@faker-js/faker";
import { Dataset, type Payment } from "../contracts";

export const FIXTURE_VERSION = "demo-v1";
export const REFERENCE_DATE = "2026-11-01T00:00:00.000Z";
const faker = new Faker({ locale: [en] });
faker.seed(20261101);
faker.setDefaultRefDate(REFERENCE_DATE);
export const businessName = "Example Roast & Co. Coffee (fictional)";
const vendors = [
  {
    id: "vendor-renewal",
    name: "Northstar POS Cloud",
    category: "Point-of-Sale & SaaS",
  },
  {
    id: "vendor-duplicate",
    name: "Harbor Tax & Advisory",
    category: "Quarterly Tax & Audit",
  },
  {
    id: "vendor-lookalike",
    name: "Fieldwork Creative Studio",
    category: "Packaging & Store Design",
  },
];
function payment(
  id: string,
  vendorId: string,
  date: string,
  amountCents: number,
  invoiceId: string | null,
  description = "Synthetic vendor payment",
): Payment {
  return {
    id,
    vendorId,
    date,
    amountCents,
    invoiceId,
    currency: "USD",
    status: "completed",
    entryType: "outgoing",
    reversalReference: null,
    description,
  };
}
const monthlyPos = [
  invoice("inv-renewal-sep", "vendor-renewal", "NS-0901", "2026-09-01", 100000, "Monthly cafe POS terminal usage — September", "2026-09-01 / 2026-09-30"),
  invoice("inv-renewal-oct", "vendor-renewal", "NS-1001", "2026-10-01", 100000, "Monthly cafe POS terminal usage — October", "2026-10-01 / 2026-10-31"),
];
export function invoice(
  id: string,
  vendorId: string,
  number: string,
  date: string,
  amountCents: number,
  lineItem: string,
  servicePeriod: string | null = null,
) {
  return { id, vendorId, number, date, amountCents, currency: "USD" as const, lineItems: [lineItem], servicePeriod };
}

/** An ordinary vendor: one invoiced payment in September and one in October. */
export type Everyday = { key: string; name: string; category: string; code: string; day: number; sep: number; oct: number; item: string; note?: string };
/** A bill for earlier work (August) paid with the October run, on top of a steady monthly bill. */
export type LateBill = { key: string; name: string; category: string; code: string; monthly: number; item: string; late: number; lateItem: string; note: string };
/** A quarterly bill re-issued under a new number and paid again in October. */
export type Reissued = { key: string; name: string; category: string; code: string; quarterly: number; item: string; note: string };
type Parts = Pick<Dataset, "invoices" | "payments" | "notes">;
const empty = (): Parts => ({ invoices: [], payments: [], notes: [] });
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Synthetic background and case records for one company. `prefix` namespaces
 * IDs ("" for Roast, "hubspot:" or "gxo:" for the other demos). Baseline parts
 * exist before injection; injected parts arrive with "Simulate new payments".
 */
export function companyExtras(prefix: string, everyday: Everyday[], late: LateBill, reissued: Reissued) {
  const id = (value: string) => `${prefix}${value}`;
  const baselineParts = empty();
  const injectedParts = empty();
  const vendorList = [...everyday, late, reissued].map((v) => ({ id: id(`vendor-${v.key}`), name: v.name, category: v.category }));
  for (const v of everyday) {
    const vendorId = id(`vendor-${v.key}`);
    for (const [month, amount, label] of [["09", v.sep, "September"], ["10", v.oct, "October"]] as const) {
      const invoiceId = id(`inv-${v.key}-${month}`);
      const end = month === "09" ? "30" : "31";
      baselineParts.invoices.push(invoice(invoiceId, vendorId, `${v.code}-${month}01`, `2026-${month}-01`, amount, `${v.item} — ${label}`, `2026-${month}-01 / 2026-${month}-${end}`));
      baselineParts.payments.push(payment(id(`pay-${v.key}-${month}`), vendorId, `2026-${month}-${pad(v.day)}`, amount, invoiceId, `${v.item} — ${label}`));
    }
    if (v.note)
      baselineParts.notes.push({ id: id(`note-${v.key}`), vendorId, date: "2026-10-01", text: v.note, paymentIds: [id(`pay-${v.key}-10`)], invoiceIds: [id(`inv-${v.key}-10`)] });
  }
  {
    const vendorId = id(`vendor-${late.key}`);
    for (const [month, label, end] of [["09", "September", "30"], ["10", "October", "31"]] as const) {
      const invoiceId = id(`inv-${late.key}-${month}`);
      baselineParts.invoices.push(invoice(invoiceId, vendorId, `${late.code}-${month}${end}`, `2026-${month}-01`, late.monthly, `${late.item} — ${label}`, `2026-${month}-01 / 2026-${month}-${end}`));
      baselineParts.payments.push(payment(id(`pay-${late.key}-${month}`), vendorId, `2026-${month}-10`, late.monthly, invoiceId, `${late.item} — ${label}`));
    }
    const lateInvoice = id(`inv-${late.key}-aug`);
    injectedParts.invoices.push(invoice(lateInvoice, vendorId, `${late.code}-0831`, "2026-08-31", late.late, late.lateItem, "2026-08-01 / 2026-08-31"));
    injectedParts.payments.push(payment(id(`pay-${late.key}-aug`), vendorId, "2026-10-21", late.late, lateInvoice, late.lateItem));
    injectedParts.notes.push({ id: id(`note-${late.key}-late`), vendorId, date: "2026-10-20", text: late.note, paymentIds: [id(`pay-${late.key}-aug`)], invoiceIds: [lateInvoice] });
  }
  {
    const vendorId = id(`vendor-${reissued.key}`);
    const q3 = id(`inv-${reissued.key}-q3`), q4 = id(`inv-${reissued.key}-q4`), q3r = id(`inv-${reissued.key}-q3r`);
    baselineParts.invoices.push(invoice(q3, vendorId, `${reissued.code}-0905`, "2026-09-05", reissued.quarterly, `Q3 ${reissued.item}`, "2026-07-01 / 2026-09-30"));
    baselineParts.invoices.push(invoice(q4, vendorId, `${reissued.code}-1001`, "2026-10-01", reissued.quarterly, `Q4 ${reissued.item}`, "2026-10-01 / 2026-12-31"));
    baselineParts.payments.push(payment(id(`pay-${reissued.key}-q3`), vendorId, "2026-09-12", reissued.quarterly, q3, `Q3 ${reissued.item}`));
    baselineParts.payments.push(payment(id(`pay-${reissued.key}-q4`), vendorId, "2026-10-02", reissued.quarterly, q4, `Q4 ${reissued.item}`));
    injectedParts.invoices.push(invoice(q3r, vendorId, `${reissued.code}-1008`, "2026-10-08", reissued.quarterly, `Q3 ${reissued.item} (re-issued invoice)`, "2026-07-01 / 2026-09-30"));
    injectedParts.payments.push(payment(id(`pay-${reissued.key}-q3r`), vendorId, "2026-10-14", reissued.quarterly, q3r, `${reissued.name} invoice ${reissued.code}-1008`));
    injectedParts.notes.push({ id: id(`note-${reissued.key}-billing`), vendorId, date: "2026-10-08", text: reissued.note, paymentIds: [], invoiceIds: [q3r] });
  }
  return { vendors: vendorList, baseline: baselineParts, injected: injectedParts };
}

const roastExtras = companyExtras("", [
  { key: "beans", name: "Highland Coffee Roasters", category: "Coffee beans", code: "HC", day: 4, sep: 840000, oct: 910000, item: "Espresso and drip coffee beans", note: "Supplier note: the fall blend price list took effect October 1." },
  { key: "rent", name: "Main Street Properties", category: "Rent", code: "MS", day: 1, sep: 650000, oct: 650000, item: "Cafe lease, 412 Main St." },
  { key: "utilities", name: "Bright Electric & Gas", category: "Utilities", code: "BE", day: 18, sep: 138000, oct: 142000, item: "Electricity and gas" },
  { key: "payroll", name: "GreenLeaf Payroll", category: "Payroll service", code: "GL", day: 15, sep: 45000, oct: 45000, item: "Payroll processing fee" },
  { key: "bakery", name: "Crumb & Co. Bakery", category: "Pastries", code: "CB", day: 6, sep: 215000, oct: 238000, item: "Daily pastry deliveries" },
  { key: "cleaning", name: "CleanSweep Janitorial", category: "Cleaning", code: "CS", day: 20, sep: 90000, oct: 90000, item: "Nightly cafe cleaning" },
  { key: "cups", name: "CupCraft Packaging", category: "Cups and lids", code: "CC", day: 9, sep: 124000, oct: 161000, item: "Paper cups, lids and sleeves" },
], { key: "dairy", name: "Valley Dairy Co.", category: "Milk and dairy", code: "VD", monthly: 240000, item: "Milk and cream deliveries", late: 620000, lateItem: "Milk and cream deliveries — August", note: "Accounts payable note: the dairy sent the August invoice late, so it was paid with the October payment run." },
{ key: "espresso", name: "Summit Espresso Service", category: "Espresso machine upkeep", code: "SE", quarterly: 600000, item: "espresso machine maintenance (3 machines)", note: "Vendor note: Summit Espresso moved to a new billing system in October and re-sent recent invoices with new numbers." });

export const baseline = Dataset.parse({
  vendors: [...vendors, ...roastExtras.vendors],
  invoices: [...monthlyPos, ...roastExtras.baseline.invoices],
  notes: [...roastExtras.baseline.notes],
  payments: [...roastExtras.baseline.payments,
    payment(
      "pay-renewal-sep",
      "vendor-renewal",
      "2026-09-15",
      100000,
      "inv-renewal-sep",
      "Monthly cafe POS terminal usage — September",
    ),
    payment(
      "pay-renewal-oct",
      "vendor-renewal",
      "2026-10-15",
      100000,
      "inv-renewal-oct",
      "Monthly cafe POS terminal usage — October",
    ),
  ],
});
export const scenario = Dataset.parse({
  vendors: [...vendors, ...roastExtras.vendors],
  invoices: [
    ...roastExtras.injected.invoices,
    {
      id: "inv-renewal",
      vendorId: "vendor-renewal",
      number: "NS-2026",
      date: "2026-10-01",
      amountCents: 1200000,
      currency: "USD",
      lineItems: [
        "Annual enterprise POS platform subscription",
      ],
      servicePeriod: "2026-10-01 / 2027-09-30",
    },
    {
      id: "inv-advisory",
      vendorId: "vendor-duplicate",
      number: "HA-101",
      date: "2026-10-05",
      amountCents: 300000,
      currency: "USD",
      lineItems: [
        "Q3 multi-state sales tax filing & nexus compliance review",
      ],
      servicePeriod: null,
    },
    {
      id: "inv-design-a",
      vendorId: "vendor-lookalike",
      number: "FS-201",
      date: "2026-10-10",
      amountCents: 150000,
      currency: "USD",
      lineItems: [
        "Holiday roast coffee bag & gift-box packaging artwork",
      ],
      servicePeriod: null,
    },
    {
      id: "inv-design-b",
      vendorId: "vendor-lookalike",
      number: "FS-202",
      date: "2026-10-12",
      amountCents: 150000,
      currency: "USD",
      lineItems: [
        "Winter cafe menu boards & window signage",
      ],
      servicePeriod: null,
    },
  ],
  payments: [
    ...roastExtras.injected.payments,
    payment(
      "pay-renewal-annual",
      "vendor-renewal",
      "2026-10-20",
      1200000,
      "inv-renewal",
      "Annual enterprise POS platform subscription",
    ),
    payment(
      "pay-advisory-a",
      "vendor-duplicate",
      "2026-10-08",
      300000,
      "inv-advisory",
      "Tax advisory payment",
    ),
    payment(
      "pay-advisory-b",
      "vendor-duplicate",
      "2026-10-10",
      300000,
      "inv-advisory",
      "Tax advisory payment",
    ),
    payment(
      "pay-design-a",
      "vendor-lookalike",
      "2026-10-14",
      150000,
      "inv-design-a",
      "Studio design payment",
    ),
    payment(
      "pay-design-b",
      "vendor-lookalike",
      "2026-10-16",
      150000,
      "inv-design-b",
      "Studio design payment",
    ),
  ],
  notes: [
    ...roastExtras.injected.notes,
    {
      id: "note-renewal",
      vendorId: "vendor-renewal",
      date: "2026-10-01",
      text: "Finance note (M. Chen, FP&A): Annual POS platform subscription renewal of $12,000, covering October 2026 through September 2027.",
      paymentIds: ["pay-renewal-annual"],
      invoiceIds: ["inv-renewal"],
    },
  ],
});
export function injectedDataset(): Dataset {
  return Dataset.parse({
    vendors: baseline.vendors,
    invoices: [...baseline.invoices, ...scenario.invoices],
    notes: [...baseline.notes, ...scenario.notes],
    payments: [...baseline.payments, ...scenario.payments],
  });
}
