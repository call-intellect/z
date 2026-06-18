import { Header } from "@/components/site/header";
import { HeroOverlay } from "@/components/site/hero-overlay";
import { ProblemSolution } from "@/components/site/problem-solution";
import { SummaryBlock } from "@/components/site/summary-block";
import { Footer } from "@/components/site/footer";
import {
  blockCommunication,
  blockKnowledge,
  blockGoals,
} from "@/components/site/blocks-data";

export default function Home() {
  return (
    <>
      <Header />
      <main className="flex-1">
        <section id="top" className="mx-auto max-w-5xl px-4 pt-28 sm:pt-32">
          <HeroOverlay />
        </section>

        <div id="communication" className="mt-20 scroll-mt-24 border-t pt-16">
          <ProblemSolution data={blockCommunication} />
        </div>

        <div id="knowledge" className="mt-20 scroll-mt-24 border-t pt-16">
          <ProblemSolution data={blockKnowledge} />
        </div>

        <div id="goals" className="mt-20 scroll-mt-24 border-t pt-16">
          <ProblemSolution data={blockGoals} />
        </div>

        <div id="summary" className="mt-20 scroll-mt-24 border-t pt-16">
          <SummaryBlock />
        </div>
      </main>
      <Footer />
    </>
  );
}
