import { Link } from "react-router-dom";
import { Seo } from "@/components/Seo";

const NotFound = () => {
  return (
    <>
    <Seo title="Page not found | Reetma" description="The page you're looking for doesn't exist or has been moved." path="/404" noindex />
    <div className="min-h-[70vh] flex items-center justify-center px-6 py-24">
      <div className="max-w-lg text-center">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground mb-4">
          Page not found
        </h1>
        <p className="text-base text-muted-foreground mb-8">
          The page you're looking for doesn't exist or has been moved
        </p>
        <Link
          to="/"
          className="inline-flex items-center h-11 px-6 rounded-full text-sm font-medium text-primary-foreground bg-primary hover:opacity-90 transition-opacity"
        >
          Back to Reetma
        </Link>
      </div>
    </div>
    </>
  );
};

export default NotFound;
