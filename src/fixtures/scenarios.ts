import { Faker, en } from "@faker-js/faker";
import { Dataset, type Payment } from "../contracts";

export const FIXTURE_VERSION = "demo-v1";
export const REFERENCE_DATE = "2026-11-01T00:00:00.000Z";
const faker = new Faker({ locale: [en] });
faker.seed(20261101);
faker.setDefaultRefDate(REFERENCE_DATE);
export const businessName = `Example ${faker.company.name()} (fictional)`;
const vendors = [
  { id: "vendor-renewal", name: "Northstar Software", category: "Software" },
  {
    id: "vendor-duplicate",
    name: "Harbor Advisory",
    category: "Professional services",
  },
  { id: "vendor-lookalike", name: "Fieldwork Studio", category: "Design" },
];
function payment(
  id: string,
  vendorId: string,
  date: string,
  amountCents: number,
  invoiceId: string | null,
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
    description: "Synthetic vendor payment",
  };
}
export const baseline = Dataset.parse({
  vendors,
  invoices: [],
  notes: [],
  payments: [
    payment("pay-renewal-sep", "vendor-renewal", "2026-09-15", 100000, null),
    payment("pay-renewal-oct", "vendor-renewal", "2026-10-15", 100000, null),
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
      lineItems: ["Annual software renewal"],
      servicePeriod: "2026-10-01 / 2027-09-30",
    },
    {
      id: "inv-advisory",
      vendorId: "vendor-duplicate",
      number: "HA-101",
      date: "2026-10-05",
      amountCents: 300000,
      currency: "USD",
      lineItems: ["Advisory engagement"],
      servicePeriod: null,
    },
    {
      id: "inv-design-a",
      vendorId: "vendor-lookalike",
      number: "FS-201",
      date: "2026-10-10",
      amountCents: 150000,
      currency: "USD",
      lineItems: ["Website illustrations"],
      servicePeriod: null,
    },
    {
      id: "inv-design-b",
      vendorId: "vendor-lookalike",
      number: "FS-202",
      date: "2026-10-12",
      amountCents: 150000,
      currency: "USD",
      lineItems: ["Event poster design"],
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
    ),
    payment(
      "pay-advisory-a",
      "vendor-duplicate",
      "2026-10-08",
      300000,
      "inv-advisory",
    ),
    payment(
      "pay-advisory-b",
      "vendor-duplicate",
      "2026-10-10",
      300000,
      "inv-advisory",
    ),
    payment(
      "pay-design-a",
      "vendor-lookalike",
      "2026-10-14",
      150000,
      "inv-design-a",
    ),
    payment(
      "pay-design-b",
      "vendor-lookalike",
      "2026-10-16",
      150000,
      "inv-design-b",
    ),
  ],
  notes: [
    {
      id: "note-renewal",
      vendorId: "vendor-renewal",
      date: "2026-10-01",
      text: "Synthetic approval note: annual renewal of $12,000, covering October 2026 through September 2027.",
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
