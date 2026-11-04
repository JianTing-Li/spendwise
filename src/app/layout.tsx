import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "SpendWise · Payment review",
  description: "Synthetic vendor-payment investigation prototype",
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
