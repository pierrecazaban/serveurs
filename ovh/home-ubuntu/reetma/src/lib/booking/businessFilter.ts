// Business-only filter of the booking calendar, mirrored from api/_bookingFilter.js for instant feedback in the form.
// The server's verdict is the one that counts: keep both files in sync (same lists, same verdicts, checked by a test).
// Matching is on whole words or phrases of the normalized text, never on raw substrings ("HEC" ≠ "Hecla").
import universities from "@/data/universities.json";

type UniversityRow = { name: string; short_name: string; email_domains: string[] };

// Words and phrases that only name a school, a degree or a student organization: refused anywhere in the name.
const EDUCATION_TERMS = [
  "university", "universities", "univ", "universite", "universites", "universidad", "universidades", "universidade",
  "universitat", "universitaet", "universiteit", "universita", "universitet", "uniwersytet", "unibertsitatea",
  "universitario", "universitaria", "universitarios", "universitarias",
  "college", "colleges", "colegio", "school", "schools", "ecole", "ecoles", "escuela", "escola", "hochschule",
  "hogeschool", "liceo", "lycee", "lycees", "campus", "faculty", "faculte", "facultes", "facultad", "fac",
  "student", "students", "etudiant", "etudiante", "etudiants", "etudiantes", "estudiante", "estudiantes",
  "alumno", "alumnos", "alumna", "alumnas", "alumni", "alumnus", "undergrad", "undergraduate", "phd candidate",
  "doctorant", "doctorante", "doctorants", "doctorantes", "mba", "emba", "iut", "iae", "bts", "dut",
  "prepa", "prepas", "cpge", "hypokhagne", "khagne", "bde", "junior entreprise", "junior entreprises",
  "junior enterprise", "junior enterprises", "polytechnique", "polytechnic", "politecnico", "politecnica",
  "institute of technology", "sciences po", "insa", "sorbonne", "hec", "essec", "escp", "edhec", "emlyon", "em lyon",
  "em normandie", "em strasbourg", "grenoble em", "skema", "neoma", "kedge", "audencia", "essca", "inseec", "epita",
  "epitech", "efrei", "esiee", "ensae", "ensai", "ensam", "supelec", "sup elec", "centralesupelec", "supaero",
  "sup aero", "isae", "ipag", "excelia", "arts et metiers", "telecom paris", "paris dauphine", "mines paristech",
  "ponts paristech",
  "ens lyon", "ens paris", "ens ulm", "ens rennes", "ens cachan", "dauphine psl", "centrale lille", "centrale lyon",
  "centrale nantes", "centrale marseille", "centrale mediterranee", "centrale paris", "polytech angers",
  "polytech annecy", "polytech clermont", "polytech dijon", "polytech grenoble", "polytech lille", "polytech lyon",
  "polytech marseille", "polytech montpellier", "polytech nancy", "polytech nantes", "polytech nice", "polytech orleans",
  "polytech paris", "polytech sorbonne", "polytech tours", "insead", "science po", "sc po", "tbs education",
  "isc paris", "ebs paris", "esc clermont", "pantheon assas", "paris 2 assas", "upec", "ulille", "uni lille", "ulco",
  "uphf", "upjv", "catho lille", "la catho", "junia hei", "junia isen", "junia isa", "isen", "mines paris",
  "mines de paris", "mines nancy", "mines saint etienne", "mines ales", "mines albi", "enpc", "normale sup",
  "telecom paristech", "telecom sudparis", "imt atlantique", "utc compiegne", "ece paris", "esilv", "bureau des eleves",
  "eleve ingenieur", "eleve ingenieure", "eleves ingenieurs", "lyceen", "lyceenne", "lyceens", "lyceennes", "thesard",
  "thesarde", "thesards", "thesardes", "master 1", "master 2", "mastere", "licence pro", "licence professionnelle",
  "fin d etudes", "memoire de master", "projet tutore", "junior conseil", "esade", "bocconi", "epfl", "eth zurich",
  "ku leuven", "tu delft", "tu munchen", "tu munich", "uni mannheim", "whu", "berkeley haas", "studentin",
  "studentinnen", "studierende", "studente", "studenti", "studenten", "estudante", "estudantes",
  // Other names students give the schools of universities.json (not "Icade": a listed French real-estate company).
  "san diego state", "san jose state", "san francisco state", "cal state long beach", "csu long beach",
  "long beach state", "cal state fullerton", "csu fullerton", "cal state northridge", "csu northridge", "ucsd", "ucsb",
  "ucsc", "carnegie mellon", "gwu", "wustl", "umich", "umass boston", "umass lowell", "umass dartmouth",
  "umass isenberg", "umass chan", "umass global", "complutense",
  "loyola andalucia", "loyola marymount", "loyola maryland", "loyola new orleans",
  // Student wording with PhD and Polytech, which otherwise only count as the whole name (PHD Media is a business).
  "phd in", "phd en", "phd at", "phd researcher", "phd fellow", "phd program", "phd programme", "polytech network",
  "reseau polytech",
];

// School names that are also places, people's names, common words or brands ("Arizona State Credit Union",
// "Johns Hopkins HealthCare", "UMass Memorial Health", "Le Dauphiné Libéré", "Pharmacie Centrale", "PHD Media",
// "Gem Consulting", "Oxford Instruments"), short names with one of their schools ("Yale SOM", "Michigan Ross" ≠
// "Michigan Ross Consulting LLC"), and short names of 1 or 2 letters with the city or campus of a school known by
// them ("UW Seattle", "BU Boston", "UB Barcelona", "UA Tuscaloosa"): like the ambiguous short names below, they only
// count as the whole company name, with school context or with a word of student life.
const WHOLE_NAME_TERMS = [
  "arizona state", "florida state", "kansas state", "louisiana state", "north carolina state", "pennsylvania state",
  "washington state", "johns hopkins", "george washington", "brigham young", "southern methodist", "carlos iii",
  "rey juan carlos", "pompeu fabra", "uci", "ucr", "ucd", "dauphine", "centrale", "phd", "polytech", "eleve", "eleves",
  "gem", "bsb", "isg", "psl", "ens", "ecl", "l x", "pfe", "uni", "u lille", "paris nanterre", "paris saclay", "lse",
  "lbs", "hbs", "penn", "wharton", "penn wharton", "oxford", "cambridge", "chicago booth", "hsg", "st gallen",
  "42 paris", "lille 1", "lille 2", "lille 3", "tamu", "va tech", "erasmus", "umass", "loyola sevilla",
  "loyola cordoba", "loyola law", "loyola business", "villanova law", "villanova business", "villanova engineering",
  "villanova nursing", "umass med", "umass medical", "umass law", "umass business", "umass online", "umass engineering",
  "umass nursing", "umass worcester",
  "yale som", "yale law", "duke fuqua", "duke law", "columbia gsb", "columbia law", "columbia sipa", "cornell tech",
  "cornell johnson", "cornell law", "michigan ross", "michigan law", "northwestern kellogg", "northwestern law",
  "northwestern medill", "notre dame mendoza", "notre dame law", "georgetown mcdonough", "georgetown law",
  "emory goizueta", "emory law", "vanderbilt owen", "vanderbilt law", "dartmouth tuck", "fordham gabelli",
  "fordham law", "bu questrom", "bu law", "bc carroll", "bc law", "ie business", "ie law", "ie madrid", "ie segovia",
  "gw law", "uw foster", "uf warrington", "syracuse whitman", "syracuse newhouse", "indiana kelley", "wake forest law",
  "bc boston", "bc chestnut hill", "bu boston", "gw dc", "gw washington dc", "gw foggy bottom", "uf gainesville",
  "uw seattle", "uw bothell", "uw tacoma", "ua alicante", "ua alacant", "ua tuscaloosa", "ua tucson", "ua fayetteville",
  "ub barcelona", "ub buffalo", "um murcia", "um ann arbor", "um coral gables", "ur logrono", "ur la rioja",
  "ur rochester", "us sevilla", "us seville", "uv valencia",
];

// Short names that are also places, people's names, common words or brands ("Duke Energy", "Buffalo Grill",
// "Pharmacie Notre-Dame", "American Express", "US Foods", "Loyola Press"): they only count as the whole company name,
// with school context or with a word of student life. Short names of 1 or 2 characters are treated the same way.
const AMBIGUOUS_SHORT_NAMES = [
  "alabama", "alaska", "american", "arizona", "arkansas", "auburn", "baruch", "baylor", "binghamton", "brandeis",
  "brown", "buffalo", "cincinnati", "clemson", "cmc", "columbia", "cornell", "dartmouth", "delaware", "denver",
  "depaul", "drexel", "duke", "emory", "fordham", "george mason", "georgetown", "hawaii", "houston", "howard",
  "hunter", "idaho", "indiana", "iowa", "kansas", "kentucky", "lehigh", "louisville", "loyola", "marquette", "miami",
  "michigan", "mondragon", "montana", "nebraska", "north dakota", "northeastern", "northwestern", "notre dame",
  "oklahoma", "oregon", "pitt", "pomona", "princeton", "purdue", "rice", "rochester", "santa clara",
  "south carolina", "south dakota", "stevens", "stony brook", "syracuse", "temple", "tennessee", "uab", "ual",
  "uco", "uhu", "uma", "upc", "upm", "url", "usd", "utah", "vanderbilt", "villanova", "wake forest", "wesleyan",
  "wyoming", "yale",
];

// Words that only fit the school around such a name ("Duke '26", "Princeton Class of 2027", "Duke U", "Yale grad",
// "Polytech 4A"); a class year (2 digits or 19xx/20xx) counts too. A namesake business has another word ("Duke Energy").
const SCHOOL_CONTEXT_WORDS = [
  "class", "of", "u", "uni", "grad", "grads", "alum", "alums", "freshman", "sophomore", "msc", "bsc", "mphil", "phd",
  "1a", "2a", "3a", "4a", "5a",
];
// Degree words that count as school context before such a name only ("Master Duke"): after it, they are part of a
// business's name ("Gem Master", "UV Master").
const DEGREE_PREFIXES = ["master", "masters", "bachelor"];
// Words of student life: with one of them, every school name counts anywhere in the company name ("Duke Investment
// Club", "Yale Entrepreneurial Society", "Cornell Hyperloop", "Purdue Space Program", "Club Finance Dauphine"). Only
// words that still mean students next to a place or a brand: not "club", "team", "society", "association" or
// "robotics" alone ("Miami Beach Club", "The Brown Team", "American Cancer Society" and "US Robotics" are not students).
const STUDENT_LIFE_TERMS = [
  "investment club", "investing club", "investment society", "consulting club", "consulting society", "finance club",
  "finance society", "fintech club", "fintech society", "economics club", "economics society", "trading club",
  "marketing club", "entrepreneurship", "entrepreneurs club", "entrepreneurs society", "entrepreneurial society",
  "startup club", "startups club", "venture club", "ventures club", "venture capital club", "venture community",
  "tech club", "tech society", "ai club", "ai society", "data science club", "coding club", "blockchain club",
  "robotics club", "robotics team", "robotics society", "debate club", "debate society", "debate team",
  "debating society", "model un", "model united nations", "fraternity", "sorority", "hackers", "hackathon", "hack club",
  "hyperloop", "rocketry", "solar car", "formula sae", "fsae", "baja sae", "space program", "space programme",
  "entrepreneuriat", "club entrepreneurs", "club entrepreneuriat", "club finance", "club investissement",
  "club d investissement", "club conseil", "club robotique", "club ia", "club tech", "bureau des sports",
  "bureau des arts",
];

// Email labels of student mailboxes (etu.univ-lille.fr, student.uliege.be, edu.ieseg.fr…).
const STUDENT_LABELS = new Set([
  "etu", "etud", "etudiant", "etudiants", "etudiante", "etudiantes", "student", "students", "stud", "studenti", "stu",
  "edu", "alumni", "alumnos", "alumno", "alumnes", "alu", "alum", "estudiante", "estudiantes", "estudiants", "estudiantat",
  "campus",
]);
// Words that make a domain label a university's (univ-lille.fr, sorbonne-universite.fr…).
const UNIVERSITY_LABEL_WORDS = new Set([
  "univ", "universite", "university", "universidad", "universidade", "universitat", "universita", "universiteit",
  "universitet", "universitaet",
]);
// Email domains of schools that universities.json does not list (French schools first), with their subdomains; not the
// alumni services (polytechnique.org, ponts.org), whose lifelong addresses are mostly graduates' (founders, executives).
const SCHOOL_DOMAINS = [
  "sciencespo.fr", "hec.fr", "edhec.com", "kedgebs.com", "neoma-bs.fr", "neoma-bs.com", "audencia.com", "em-lyon.com",
  "escp.eu", "tbs-education.fr", "tbs-education.org", "grenoble-em.com", "montpellier-bs.com", "rennes-sb.com",
  "bsb-education.com", "essca.eu", "essca.fr", "inseec.com", "ipag.fr", "iscparis.com", "psbedu.paris",
  "excelia-group.com", "dauphine.eu", "psl.eu", "student-cs.fr", "centralesupelec.fr", "centralelille.fr",
  "centrale-lille.fr", "ec-lyon.fr", "ec-nantes.fr", "centrale-marseille.fr", "centrale-med.fr", "insa-lyon.fr",
  "insa-toulouse.fr", "insa-rennes.fr", "insa-strasbourg.fr", "insa-rouen.fr", "insa-cvl.fr", "insa-hdf.fr", "epita.fr",
  "epitech.eu", "efrei.net", "efrei.fr", "esiee.fr", "ensae.fr", "ensai.fr", "telecom-paris.fr", "telecom-sudparis.eu",
  "imt-atlantique.net", "imt-atlantique.fr", "imt-nord-europe.fr", "mines-paristech.fr", "mines-stetienne.fr",
  "mines-ales.fr", "mines-albi.fr", "enpc.fr", "ens.fr", "ens-lyon.fr", "ens-paris-saclay.fr", "ens-rennes.fr",
  "isae-supaero.fr", "ensta-paris.fr", "agroparistech.fr", "utc.fr", "icam.fr",
  "junia.com", "yncrea.fr", "isen.fr", "ece.fr", "devinci.fr", "isep.fr", "epf.fr", "parisnanterre.fr",
  "pantheonsorbonne.fr", "sorbonne-nouvelle.fr", "unistra.fr", "polimi.it", "unibocconi.it", "studbocconi.it",
  "ethz.ch", "epfl.ch", "unil.ch", "unige.ch", "uzh.ch", "unisg.ch", "ulb.be", "ugent.be", "kuleuven.be", "uva.nl",
  "tudelft.nl", "lmu.de", "tum.de", "mytum.de", "utoronto.ca", "mcgill.ca", "hec.ca", "umontreal.ca", "ubc.ca",
  "ucd.ie", "ucdconnect.ie", "tcd.ie", "usp.br", "ul.pt",
];

const FOLD: Record<string, string> = { "œ": "oe", "æ": "ae", "ø": "o", "ß": "ss", "ł": "l", "đ": "d", "ı": "i" };

/**
 * Lowercase, without diacritics, punctuation turned into spaces, single spaces. Styled letters read as plain ones
 * (mathematical bold, full-width), invisible characters never split a word (zero-width space, soft hyphen, control
 * characters), and letters glued to digits are separate words ("IESEG2027" → "ieseg 2027").
 */
export function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/(?![\t-\r])[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "")
    .replace(/[œæøßłđı]/g, (c) => FOLD[c])
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/([a-z])(?=[0-9])/g, "$1 ")
    .replace(/([0-9])(?=[a-z])/g, "$1 ")
    .trim();
}

const compact = (s: string) => s.replace(/ /g, "");
// "and" / "et" read like "&", which normalize() turns into a space ("William and Mary", "Arts & Métiers").
const dropAnd = (s: string) => s.replace(/ (?:and|et)(?= )/g, "");
// An acronym spelled letter by letter is one word: "M.I.T.", "I E S E G", "H-E-C" → "mit", "ieseg", "hec".
const joinLetters = (s: string) => s.replace(/\b[a-z0-9](?: [a-z0-9]\b)+/g, compact);
// A "U" set apart from the school's name: "U-Mass", "U Mich", "Wash U" read as "umass", "umich", "washu".
const joinU = (s: string) => s.replace(/^u (?=[a-z])/, "u").replace(/ u$/, "u");

const rows = universities as UniversityRow[];
const shortNames = rows.map((u) => normalize(u.short_name));
const ambiguous = new Set(AMBIGUOUS_SHORT_NAMES);
const isAmbiguous = (s: string) => compact(s).length <= 2 || ambiguous.has(s);
// Matched as a whole word or phrase anywhere in the company name ("&" also read as "and" / "et").
const ANYWHERE = [
  ...new Set(
    [
      ...EDUCATION_TERMS.map(normalize),
      ...rows.map((u) => normalize(u.name)),
      ...shortNames.filter((s) => !isAmbiguous(s)),
    ].flatMap((term) => [term, dropAnd(term)]),
  ),
].filter(Boolean);
// Phrases and the dataset's distinctive short names without their spaces: "SciencesPo", "UCBerkeley", "IE SEG",
// "U Penn". Single keywords are not compared this way ("K-Edge" is a business, KEDGE a school).
const SQUEEZED_TERMS = new Set(
  [...ANYWHERE.filter((term) => term.includes(" ")), ...shortNames.filter((s) => !isAmbiguous(s))].map(compact),
);
const PHRASES_SQUEEZED = new Set(ANYWHERE.filter((term) => term.includes(" ")).map(compact));
// Matched only as the whole company name, or with nothing but school context around them.
const WHOLE_ONLY = [...new Set([...shortNames.filter(isAmbiguous), ...WHOLE_NAME_TERMS.map(normalize)])];
// Whole-name phrases whose words all have 3+ letters also count without their spaces ("NotreDame '26"); single words
// ("Villa Nova" ≠ Villanova) and phrases with a shorter word ("Vatech" ≠ "Va Tech", "LX" ≠ "l'X") never do.
const SQUEEZABLE = new Set(
  WHOLE_ONLY.filter((term) => term.includes(" ") && term.split(" ").every((w) => w.length >= 3)),
);
const degreePrefix = new Set(DEGREE_PREFIXES);
const STUDENT_LIFE = STUDENT_LIFE_TERMS.map(normalize);
const schoolContext = new Set(SCHOOL_CONTEXT_WORDS);
const isSchoolContext = (word: string) => schoolContext.has(word) || /^(\d{2}|(19|20)\d{2})$/.test(word);
const DOMAINS = [...rows.flatMap((u) => u.email_domains.map((d) => d.toLowerCase())), ...SCHOOL_DOMAINS];

/**
 * One reading of a normalized company name: does it name a school? In a reading where a "U" set apart was joined to
 * the word next to it (`joined`), a single word only counts alone, with school context or with a word of student life
 * ("Wash U" is WashU, but "Made By U" is not BYU and "U-Nav Systems" is not UNAV); phrases still count anywhere
 * ("U-Mass Amherst Isenberg").
 */
function namesSchool(n: string, joined = false): boolean {
  const squeezed = compact(n);
  if (SQUEEZED_TERMS.has(squeezed) || n.split(" ").some((word) => PHRASES_SQUEEZED.has(word))) return true;
  // The term alone, or with nothing but school context around it ("Duke '26", "Class of 2027, Duke", "Yale U"); a
  // degree word counts before it only ("Master Duke", not "Gem Master").
  const whole = ` ${n.replace(/^the /, "")} `;
  const alone = (term: string) => {
    const at = whole.indexOf(` ${term} `);
    if (at < 0) return false;
    const before = whole.slice(0, at).split(" ").filter(Boolean);
    const after = whole.slice(at + term.length + 1).split(" ").filter(Boolean);
    return before.every((w) => isSchoolContext(w) || degreePrefix.has(w)) && after.every(isSchoolContext);
  };
  const padded = ` ${n} `;
  const has = (term: string) => padded.includes(` ${term} `);
  // A word of student life makes every school name count anywhere ("Duke Investment Club", "U Mich Hackers").
  const studentLife = STUDENT_LIFE.some(has);
  if (ANYWHERE.some((term) => (joined && !term.includes(" ") && !studentLife ? alone(term) : has(term)))) return true;
  return WHOLE_ONLY.some((term) => {
    // Squeezable phrases count without their spaces too ("NotreDame '26").
    if (SQUEEZABLE.has(term) && squeezed === compact(term)) return true;
    const forms = SQUEEZABLE.has(term) ? [term, compact(term)] : [term];
    return forms.some((f) => alone(f) || (studentLife && has(f)));
  });
}

/** True when the company names a school, a university or student life rather than a business. */
export function companyLooksAcademic(company: string): boolean {
  const n = normalize(company);
  if (!n) return false;
  const loose = dropAnd(n);
  // Every reading counts, the plain one too: "texas a m" must still match "Texas A&M".
  const readings = [n, loose, joinLetters(n), joinLetters(loose)];
  return readings.some((r) => namesSchool(r)) || readings.map(joinU).some((r) => namesSchool(r, true));
}

/** True when the email address belongs to a school (free webmail is allowed). */
export function emailLooksAcademic(email: string): boolean {
  const value = String(email ?? "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 0) return false;
  const domain = value.slice(at + 1).replace(/\.+$/, "");
  if (!domain) return false;
  if (DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  if (/\.edu$/.test(domain) || /\.(edu|ac)\.[a-z]{2}$/.test(domain)) return true;
  const labels = domain.split(".");
  const tld = labels[labels.length - 1];
  if (labels.slice(0, -2).some((label) => STUDENT_LABELS.has(label))) return true;
  return labels.slice(0, -1).some((label) => {
    const parts = label.split("-");
    if (parts.some((p) => UNIVERSITY_LABEL_WORDS.has(p))) return true;
    // u-bordeaux.fr, u-paris.fr; uni-hamburg.de, uni-wien.at
    return parts.length > 1 && ((parts[0] === "u" && tld === "fr") || (parts[0] === "uni" && ["de", "at", "ch"].includes(tld)));
  });
}

export type BusinessVerdict = { ok: true } | { ok: false; field: "company" | "email" };

/** { ok: true } for a business, or { ok: false, field } with the field that looks academic. */
export function businessVerdict({ company, email }: { company: string; email: string }): BusinessVerdict {
  if (companyLooksAcademic(company)) return { ok: false, field: "company" };
  if (emailLooksAcademic(email)) return { ok: false, field: "email" };
  return { ok: true };
}
