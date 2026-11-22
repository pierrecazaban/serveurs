import { Seo } from "@/components/Seo";
import { Hero } from "@/components/landing/sections/Hero";
import { Stats } from "@/components/landing/sections/Stats";
import { Problems } from "@/components/landing/sections/Problems";
import { Team } from "@/components/landing/sections/Team";
import { Expertise } from "@/components/landing/sections/Expertise";
import { AIPlatform } from "@/components/landing/sections/AIPlatform";
import { Methodology } from "@/components/landing/sections/Methodology";
import { Trust } from "@/components/landing/sections/Trust";
import { FAQ } from "@/components/landing/sections/FAQ";
import { FinalCTA } from "@/components/landing/sections/FinalCTA";
import { Partners } from "@/components/landing/sections/Partners";

export default function Landing() {
  return (
    <div className="overflow-x-hidden">
      <Seo
        title="Reetma | Technology consulting in agentic AI, data and cloud"
        description="Reetma maps your processes, then designs, builds and runs the AI agents, data pipelines and cloud infrastructure that automate them."
        path="/"
      />
      <Hero />
      <Partners />
      <Stats />
      <Problems />
      <Team />
      <Expertise />
      <AIPlatform />
      <Methodology />
      <Trust />
      <FAQ />
      <FinalCTA />
    </div>
  );
}
