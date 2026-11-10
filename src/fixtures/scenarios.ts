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
export const baseline = Dataset.parse({
  vendors,
  invoices: [],
  notes: [],
  payments: [
    payment(
      "pay-renewal-sep",
      "vendor-renewal",
      "2026-09-15",
      100000,
      null,
      "Monthly cafe POS terminal usage — September",
    ),
    payment(
      "pay-renewal-oct",
      "vendor-renewal",
      "2026-10-15",
      100000,
      null,
      "Monthly cafe POS terminal usage — October",
    ),
  ],
});
export const scenario = Dataset.parse({
  vendors,
  invoices: [
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
    vendors,
    invoices: scenario.invoices,
    notes: scenario.notes,
    payments: [...baseline.payments, ...scenario.payments],
  });
}
