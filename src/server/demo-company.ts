import { CompanyId } from "../contracts";

/** Reject unknown/duplicate selectors; omitted selector preserves the legacy API. */
export function requestCompany(request: Request) {
  const values = new URL(request.url).searchParams.getAll("company");
  if (values.length > 1) throw new Error("invalid_company");
  return CompanyId.parse(values[0] ?? "roast");
}
