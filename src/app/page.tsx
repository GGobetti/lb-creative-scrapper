import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-6">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold text-foreground">Scraper Monitor</h1>
        <p className="text-muted-foreground">Monitore os jobs do seu scraper Telegram</p>
        <Link
          href="/dashboard/monitor"
          className="inline-block mt-6 px-6 py-3 bg-primary text-primary-foreground font-bold rounded-lg hover:opacity-90 transition-opacity"
        >
          Abrir Dashboard
        </Link>
      </div>
    </div>
  );
}
