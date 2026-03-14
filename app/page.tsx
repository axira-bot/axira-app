export default function Home() {
  return (
    <div className="min-h-screen bg-app">
      <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-16">
        <h1
          className="text-4xl font-semibold tracking-tight text-app"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Axira Trading FZE
        </h1>
        <p className="mt-2 text-lg font-medium text-accent">
          Dashboard
        </p>
      </main>
    </div>
  );
}
