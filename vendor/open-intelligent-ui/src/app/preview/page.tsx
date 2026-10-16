import { notFound } from "next/navigation";
import { Preview } from "./preview";

// A development page that renders one OpenUI Lang program handed in by a test
// script (window.__OPENUI_PROGRAM__), for the benchmark's screenshots.
export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ theme?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { theme } = await searchParams;
  return <Preview theme={theme === "dark" ? "dark" : "light"} />;
}
