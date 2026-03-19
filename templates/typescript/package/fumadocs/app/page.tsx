import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-4xl font-bold">Documentation</h1>
        <p className="max-w-lg text-lg text-muted-foreground">
          A beautiful documentation site built with Fumadocs.
        </p>
        <Link
          href="/docs"
          className="rounded-lg bg-primary px-6 py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          View Documentation
        </Link>
      </div>
    </main>
  );
}
