import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { getApiBaseUrl } from "../services/apiBaseUrl";

export default function NoChromeChallengePage() {
  const { slug } = useParams();
  const src = useMemo(
    () => `${getApiBaseUrl()}/challenge/${slug}`,
    [slug]
  );

  return (
    <main className="h-screen w-screen bg-black">
      <iframe title="Challenge Page" src={src} className="h-full w-full border-0" />
    </main>
  );
}
