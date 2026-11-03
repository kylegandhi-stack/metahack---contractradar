/**
 * Public-domain U.S. Navy imagery (17 U.S.C. §105), hotlinked from the official DoD media server.
 * DoD release terms: credit the photographer; no implied endorsement. Credits render in the hero.
 *  - Sea Hunter (ACTUV) unmanned vessel underway, Portland, Ore., Apr 7, 2016.
 *    U.S. Navy photo by John F. Williams/Released. https://www.navy.mil/Resources/Photo-Gallery/igphoto/2001513076/
 *  - Virginia-class submarine USS Colorado (SSN 788), Thames River, Groton, Conn., Sep 8, 2020.
 *    U.S. Navy photo by John Narewski. https://allhands.navy.mil/Media/Gallery/igphoto/2002503045/
 */
export const HERO_IMAGES = [
  {
    src: "https://media.defense.gov/2016/Apr/10/2001513076/1638/1092/0/160407-N-PO203-598A.JPG",
    label: "Sea Hunter (ACTUV)",
    credit: "U.S. Navy photo by John F. Williams",
    position: "50% 60%",
  },
  {
    src: "https://media.defense.gov/2020/Sep/22/2002503045/1638/1092/0/200908-N-UM744-001.JPG",
    label: "USS Colorado (SSN 788)",
    credit: "U.S. Navy photo by John Narewski",
    position: "30% 55%",
  },
] as const;

export function HeroBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {HERO_IMAGES.map((img, i) => (
        <div
          key={img.src}
          className="hero-frame absolute inset-0 bg-cover"
          style={{ backgroundImage: `url("${img.src}")`, backgroundPosition: img.position, animationDelay: `${i * -9}s` }}
        />
      ))}
      {/* Darken, tint and fade into the page */}
      <div className="absolute inset-0 bg-background/70" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-background/30" />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/60" />
      <div className="hero-scanlines absolute inset-0" />
    </div>
  );
}

export function HeroCredit() {
  return (
    <p className="label text-[9.5px] leading-relaxed text-dim">
      Imagery: {HERO_IMAGES.map((img) => `${img.label} — ${img.credit}`).join(" · ")}. Public domain. No DoD endorsement implied.
    </p>
  );
}
