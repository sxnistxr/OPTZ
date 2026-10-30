import AnalyticsConsent from "../components/AnalyticsConsent.island";
export const head = () => ({ title: "Consent-first analytics · OPTZ" });
export default function MetricsDemo() { return <><h1>Consent-first analytics</h1><p>No tracking request is made before you opt in. This example never stores a browser identity on disk, reads form values or captures URL parameters.</p><AnalyticsConsent /></>; }
