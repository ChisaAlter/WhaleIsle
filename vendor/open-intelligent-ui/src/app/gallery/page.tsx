import { notFound } from "next/navigation";
import { Gallery } from "./gallery";

// A development page: hand-written programs that exercise every component.
export default async function GalleryPage({ searchParams }: { searchParams: Promise<{ theme?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { theme } = await searchParams;
  return <Gallery theme={theme === "dark" ? "dark" : "light"} />;
}
