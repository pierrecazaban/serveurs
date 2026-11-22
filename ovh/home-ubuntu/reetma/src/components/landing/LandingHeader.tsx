import { Menu, X } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import reetmaLogo from "@/assets/reetma-logo.png";
import { trackClick } from "@/lib/track";
import { SCHOOL_PATHS } from "@/lib/school/lang";

const navItems = [
  { label: "Services", href: "#expertise" },
  { label: "Method", href: "#method" },
  { label: "School", href: "/school" },

];

export function LandingHeader({ topOffset = 0 }: { topOffset?: number }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isLandingPage = ["/", "/index", "/platform"].includes(location.pathname);
  const isInnerPage = !isLandingPage;
  const useDarkMode = true;

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleHashClick = useCallback((href: string) => {
    setIsMenuOpen(false);
    if (isLandingPage) {
      const el = document.querySelector(href);
      el?.scrollIntoView({ behavior: "instant" });
    } else {
      navigate("/");
      setTimeout(() => {
        const el = document.querySelector(href);
        el?.scrollIntoView({ behavior: "instant" });
      }, 300);
    }
  }, [isLandingPage, navigate]);

  return (
    <header
      className={`fixed left-0 right-0 z-50 transition-all duration-500 ${(scrolled || isInnerPage) ? "shadow-sm backdrop-blur-md" : ""}`}
      style={{
        background: (scrolled || isInnerPage) ? "rgba(255,255,255,0.95)" : "transparent",
        height: 80,
        top: topOffset,
      }}
    >
      <div className="h-full flex items-center justify-between px-0">
        <Link to="/" onClick={() => { setIsMenuOpen(false); window.scrollTo(0, 0); }} className="flex items-center shrink-0 ml-4">
          <img
            src={reetmaLogo}
            alt="Reetma"
            className="h-11 w-auto transition-all duration-500"
            style={{
              filter: (!isInnerPage && !scrolled)
                ? "none"
                : "none"
            }}
          />
        </Link>

        <nav className="hidden md:flex items-center gap-10">
          {navItems.map((item) =>
            item.href.startsWith("/") ? (
              <Link
                key={item.label}
                to={item.href}
                className={`text-sm font-medium transition-colors ${useDarkMode ? "text-[#3A4F4A] hover:text-[#305D55]" : "text-white/80 hover:text-white"}`}
              >
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                onClick={() => handleHashClick(item.href)}
                className={`text-sm font-medium transition-colors ${useDarkMode ? "text-[#3A4F4A] hover:text-[#305D55]" : "text-white/80 hover:text-white"}`}
              >
                {item.label}
              </button>
            )
          )}
        </nav>

        <div className="hidden md:flex items-center gap-4">
          <Link
            to={SCHOOL_PATHS.en.book}
            onClick={() => trackClick("book_call")}
            className="text-sm font-semibold px-6 py-2.5 text-white transition-all hover:opacity-90"
            style={{ background: "#F28A4B" }}
          >
            Book a call
          </Link>
        </div>

        <button
          className="md:hidden p-2"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
        >
          {isMenuOpen ? (
            <X className={`w-6 h-6 ${useDarkMode ? "text-[#3A4F4A]" : "text-white"}`} />
          ) : (
            <Menu className={`w-6 h-6 ${useDarkMode ? "text-[#3A4F4A]" : "text-white"}`} />
          )}
        </button>
      </div>

      {isMenuOpen && (
        <div className="md:hidden absolute top-[80px] left-0 right-0 bg-white shadow-lg py-6 px-6">
          <nav className="flex flex-col gap-3">
            {navItems.map((item) =>
              item.href.startsWith("/") ? (
                <Link key={item.label} to={item.href} onClick={() => setIsMenuOpen(false)} className="text-sm font-medium py-2 text-[#3A4F4A]">
                  {item.label}
                </Link>
              ) : (
                <button key={item.label} onClick={() => { handleHashClick(item.href); setIsMenuOpen(false); }} className="text-sm font-medium py-2 text-[#3A4F4A] text-left">
                  {item.label}
                </button>
              )
            )}
            <Link
              to={SCHOOL_PATHS.en.book}
              onClick={() => { setIsMenuOpen(false); trackClick("book_call"); }}
              className="w-full py-3 px-4 text-sm font-bold text-white text-center"
              style={{ background: "#F28A4B" }}
            >
              Book a call
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
